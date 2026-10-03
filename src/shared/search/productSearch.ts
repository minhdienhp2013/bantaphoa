import type { Category, Product } from '../../types/models';
import {
  normalizeSearchCode,
  prepareSearchCandidate,
  prepareSearchQuery,
  type SearchAliases,
  type SearchForms,
} from './searchNormalization';

export type { SearchAliases } from './searchNormalization';

export type ProductSearchMatchKind =
  | 'exact-qr'
  | 'exact-barcode'
  | 'exact-sku'
  | 'exact-name'
  | 'exact-alias'
  | 'code-prefix'
  | 'name-prefix'
  | 'alias-prefix'
  | 'name-token'
  | 'alias-token'
  | 'name-compact'
  | 'alias-compact'
  | 'exact-category'
  | 'category-prefix'
  | 'category-token'
  | 'category-compact'
  | 'fuzzy-name'
  | 'fuzzy-alias';

export interface ProductSearchResult {
  product: Product;
  rank: number;
  kind: ProductSearchMatchKind;
}

export interface SalePriceFilter {
  min?: number;
  max?: number;
  minExclusive?: boolean;
  maxExclusive?: boolean;
}

export interface ProductSearchOptions {
  aliases?: SearchAliases;
  categories?: readonly Category[];
  salePrice?: SalePriceFilter;
  limit?: number;
}

export const DEFAULT_PRODUCT_SEARCH_LIMIT = 10;
export const MAX_PRODUCT_SEARCH_LIMIT = 12;

const DIGIT_PATTERN = /\d/;

function matchesTextPrefix(candidate: SearchForms, query: SearchForms, hasEmbeddedQueryExpansion: boolean) {
  return !hasEmbeddedQueryExpansion && candidate.expanded.startsWith(query.expanded);
}

function matchesTextTokens(candidate: SearchForms, query: SearchForms) {
  if (query.tokens.length === 0) return false;
  const candidateTokens = new Set(candidate.tokens);
  return query.tokens.every((token) => candidateTokens.has(token));
}

function matchesTextCompact(candidate: SearchForms, query: SearchForms) {
  if (query.expandedCompact && candidate.expandedCompact.includes(query.expandedCompact)) {
    return true;
  }

  const queryCompactWasExpanded = query.expandedCompact !== query.compact;
  return !queryCompactWasExpanded && Boolean(query.compact) && candidate.compact.includes(query.compact);
}

function isValidSalePriceBound(value: number | undefined) {
  return value === undefined || (Number.isFinite(value) && value >= 0);
}

function isValidSalePriceFilter(filter: SalePriceFilter | undefined) {
  if (!filter) return true;
  if (!isValidSalePriceBound(filter.min) || !isValidSalePriceBound(filter.max)) return false;
  if (filter.min === undefined || filter.max === undefined) return true;
  if (filter.min > filter.max) return false;
  if (filter.min === filter.max && (filter.minExclusive || filter.maxExclusive)) return false;
  return true;
}

function matchesSalePriceFilter(product: Product, filter: SalePriceFilter | undefined) {
  if (!filter) return true;
  if (!Number.isFinite(product.salePrice) || product.salePrice < 0) return false;

  if (filter.min !== undefined) {
    if (filter.minExclusive ? product.salePrice <= filter.min : product.salePrice < filter.min) return false;
  }
  if (filter.max !== undefined) {
    if (filter.maxExclusive ? product.salePrice >= filter.max : product.salePrice > filter.max) return false;
  }
  return true;
}

function fuzzyDistanceLimit(token: string) {
  if (token.length < 4 || DIGIT_PATTERN.test(token)) return null;
  return token.length <= 7 ? 1 : 2;
}

function boundedAdjacentTranspositionDistance(left: string, right: string, maxDistance: number) {
  if (left === right) return 0;
  if (Math.abs(left.length - right.length) > maxDistance) return maxDistance + 1;

  const overflow = maxDistance + 1;
  const distance = Array.from({ length: left.length + 1 }, () => Array<number>(right.length + 1).fill(overflow));

  for (let index = 0; index <= left.length; index += 1) {
    distance[index][0] = Math.min(index, overflow);
  }
  for (let index = 0; index <= right.length; index += 1) {
    distance[0][index] = Math.min(index, overflow);
  }

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      let nextDistance = Math.min(
        distance[leftIndex - 1][rightIndex] + 1,
        distance[leftIndex][rightIndex - 1] + 1,
        distance[leftIndex - 1][rightIndex - 1] + substitutionCost,
      );

      if (
        leftIndex > 1
        && rightIndex > 1
        && left[leftIndex - 1] === right[rightIndex - 2]
        && left[leftIndex - 2] === right[rightIndex - 1]
      ) {
        nextDistance = Math.min(nextDistance, distance[leftIndex - 2][rightIndex - 2] + 1);
      }

      distance[leftIndex][rightIndex] = Math.min(nextDistance, overflow);
    }
  }

  return distance[left.length][right.length];
}

function matchesBoundedFuzzyTokens(candidate: SearchForms, query: SearchForms) {
  if (query.tokens.length === 0 || candidate.tokens.length === 0) return false;

  const usedCandidateIndexes = new Set<number>();
  const unmatchedQueryTokens: string[] = [];

  for (const queryToken of query.tokens) {
    const exactCandidateIndex = candidate.tokens.findIndex(
      (candidateToken, index) => !usedCandidateIndexes.has(index) && candidateToken === queryToken,
    );

    if (exactCandidateIndex >= 0) {
      usedCandidateIndexes.add(exactCandidateIndex);
    } else {
      unmatchedQueryTokens.push(queryToken);
      if (unmatchedQueryTokens.length > 1) return false;
    }
  }

  if (unmatchedQueryTokens.length !== 1) return false;

  const typoToken = unmatchedQueryTokens[0];
  const maxDistance = fuzzyDistanceLimit(typoToken);
  if (maxDistance === null) return false;

  return candidate.tokens.some((candidateToken, index) => {
    if (usedCandidateIndexes.has(index) || DIGIT_PATTERN.test(candidateToken)) return false;
    return boundedAdjacentTranspositionDistance(typoToken, candidateToken, maxDistance) <= maxDistance;
  });
}

function getProductSearchRank(
  product: Product,
  query: string,
  aliases?: SearchAliases,
  categoryFormsById?: ReadonlyMap<string, SearchForms>,
): Omit<ProductSearchResult, 'product'> | null {
  const codeQuery = normalizeSearchCode(query);
  if (!codeQuery) return null;

  const qr = normalizeSearchCode(product.qrCode);
  const barcode = normalizeSearchCode(product.barcode);
  const sku = normalizeSearchCode(product.sku);
  if (qr && qr === codeQuery) return { rank: 1, kind: 'exact-qr' };
  if (barcode && barcode === codeQuery) return { rank: 2, kind: 'exact-barcode' };
  if (sku && sku === codeQuery) return { rank: 3, kind: 'exact-sku' };

  const queryForms = prepareSearchQuery(query, aliases);
  const nameForms = prepareSearchCandidate(product.name);
  const aliasForms = (product.aliases ?? [])
    .map((alias) => prepareSearchCandidate(alias))
    .filter((forms) => Boolean(forms.normalized));

  if (nameForms.expanded === queryForms.expanded) return { rank: 4, kind: 'exact-name' };
  if (aliasForms.some((forms) => forms.expanded === queryForms.expanded)) {
    return { rank: 5, kind: 'exact-alias' };
  }

  if ((qr && qr.startsWith(codeQuery)) || (barcode && barcode.startsWith(codeQuery)) || sku.startsWith(codeQuery)) {
    return { rank: 6, kind: 'code-prefix' };
  }

  const hasEmbeddedQueryExpansion =
    queryForms.expanded === queryForms.normalized && queryForms.expandedCompact !== queryForms.compact;
  if (matchesTextPrefix(nameForms, queryForms, hasEmbeddedQueryExpansion)) {
    return { rank: 7, kind: 'name-prefix' };
  }
  if (aliasForms.some((forms) => matchesTextPrefix(forms, queryForms, hasEmbeddedQueryExpansion))) {
    return { rank: 8, kind: 'alias-prefix' };
  }

  if (matchesTextTokens(nameForms, queryForms)) {
    return { rank: 9, kind: 'name-token' };
  }
  if (aliasForms.some((forms) => matchesTextTokens(forms, queryForms))) {
    return { rank: 10, kind: 'alias-token' };
  }

  if (matchesTextCompact(nameForms, queryForms)) {
    return { rank: 11, kind: 'name-compact' };
  }
  if (aliasForms.some((forms) => matchesTextCompact(forms, queryForms))) {
    return { rank: 12, kind: 'alias-compact' };
  }

  const categoryForms = product.categoryId ? categoryFormsById?.get(product.categoryId) : undefined;
  if (!categoryForms) return null;

  if (categoryForms.expanded === queryForms.expanded) {
    return { rank: 13, kind: 'exact-category' };
  }
  if (matchesTextPrefix(categoryForms, queryForms, hasEmbeddedQueryExpansion)) {
    return { rank: 14, kind: 'category-prefix' };
  }
  if (matchesTextTokens(categoryForms, queryForms)) {
    return { rank: 15, kind: 'category-token' };
  }
  if (matchesTextCompact(categoryForms, queryForms)) {
    return { rank: 16, kind: 'category-compact' };
  }

  return null;
}

function getProductFuzzyRank(
  product: Product,
  queryForms: SearchForms,
): Omit<ProductSearchResult, 'product'> | null {
  const nameForms = prepareSearchCandidate(product.name);
  if (matchesBoundedFuzzyTokens(nameForms, queryForms)) {
    return { rank: 17, kind: 'fuzzy-name' };
  }

  const aliasMatches = (product.aliases ?? []).some((alias) => {
    const aliasForms = prepareSearchCandidate(alias);
    return Boolean(aliasForms.normalized) && matchesBoundedFuzzyTokens(aliasForms, queryForms);
  });
  if (aliasMatches) return { rank: 18, kind: 'fuzzy-alias' };

  return null;
}

function compareProductSearchResults(left: ProductSearchResult, right: ProductSearchResult) {
  if (left.rank !== right.rank) return left.rank - right.rank;
  const skuOrder = left.product.sku.localeCompare(right.product.sku, 'vi', { numeric: true });
  if (skuOrder) return skuOrder;
  const nameOrder = left.product.name.localeCompare(right.product.name, 'vi');
  if (nameOrder) return nameOrder;
  return left.product.id.localeCompare(right.product.id, 'vi', { numeric: true });
}

function finalizeSearchResults(results: ProductSearchResult[], safeLimit: number) {
  return results.sort(compareProductSearchResults).slice(0, safeLimit);
}

export function searchProducts(
  products: readonly Product[],
  query: string,
  options: ProductSearchOptions = {},
): ProductSearchResult[] {
  if (!isValidSalePriceFilter(options.salePrice)) return [];

  const requestedLimit = options.limit ?? DEFAULT_PRODUCT_SEARCH_LIMIT;
  const safeLimit = Math.max(1, Math.min(MAX_PRODUCT_SEARCH_LIMIT, Math.floor(requestedLimit) || DEFAULT_PRODUCT_SEARCH_LIMIT));
  const categoryFormsById = options.categories
    ? new Map(options.categories.map((category) => [category.id, prepareSearchCandidate(category.name)] as const))
    : undefined;
  const eligibleProducts = products.filter((product) => matchesSalePriceFilter(product, options.salePrice));

  const directResults = eligibleProducts
    .map((product) => {
      const match = getProductSearchRank(product, query, options.aliases, categoryFormsById);
      return match ? { product, ...match } : null;
    })
    .filter((result): result is ProductSearchResult => result !== null);

  if (directResults.length > 0) {
    return finalizeSearchResults(directResults, safeLimit);
  }

  const queryForms = prepareSearchQuery(query, options.aliases);
  const fuzzyResults = eligibleProducts
    .map((product) => {
      const match = getProductFuzzyRank(product, queryForms);
      return match ? { product, ...match } : null;
    })
    .filter((result): result is ProductSearchResult => result !== null);

  return finalizeSearchResults(fuzzyResults, safeLimit);
}
