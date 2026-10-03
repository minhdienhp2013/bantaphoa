import type { Category, Product } from '../../types/models';
import type { ProductSearchResult } from '../../shared/search/productSearch';
import { prepareSearchCandidate, prepareSearchQuery } from '../../shared/search/searchNormalization';

export interface SalesAiLearningEvidenceEntry {
  productId: string;
  score: number;
  addToCartCount: number;
  removeSoonCount: number;
  lastEventAt: number;
  selectionCount?: number;
  correctionWinCount?: number;
  correctionLossCount?: number;
  sessionCount?: number;
  confidence?: number;
  conflict?: boolean;
}

export type SalesAiLearningEvidence = Readonly<Record<string, SalesAiLearningEvidenceEntry>>;

const MAX_SPEECH_CANDIDATES = 5;
const MAX_FALLBACK_RESULTS = 5;
const MODEL_TOKEN_PATTERN = /^[a-z]{1,4}\d{2,4}[a-z0-9]*$/u;
const DIGIT_PATTERN = /\d/u;

function uniquePush(target: string[], seen: Set<string>, value: string) {
  const cleaned = value.replace(/\s+/gu, ' ').trim();
  if (!cleaned) return;
  const forms = prepareSearchQuery(cleaned);
  const key = forms.expandedCompact || forms.compact || forms.normalized;
  if (!key || seen.has(key)) return;
  seen.add(key);
  target.push(cleaned);
}

export function buildSalesSpeechCandidates(query: string) {
  const normalized = prepareSearchQuery(query).normalized;
  return normalized ? [normalized] : [];
}

export function normalizeSalesAiLearningQuery(query: string) {
  return prepareSearchQuery(query).normalized;
}

export function buildSalesAiLearningKey(query: string) {
  const normalized = normalizeSalesAiLearningQuery(query);
  let hash = 0x811c9dc5;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `q_${(hash >>> 0).toString(16).padStart(8, '0')}_${normalized.length}`;
}

function editDistanceWithinOne(left: string, right: string) {
  if (left === right) return true;
  if (left.length < 4 || right.length < 4) return false;
  if (DIGIT_PATTERN.test(left) || DIGIT_PATTERN.test(right)) return false;
  if (Math.abs(left.length - right.length) > 1) return false;

  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;
  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (left.length > right.length) leftIndex += 1;
    else if (right.length > left.length) rightIndex += 1;
    else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }
  if (leftIndex < left.length || rightIndex < right.length) edits += 1;
  return edits <= 1;
}

function collectProductFields(product: Product, categoryName?: string) {
  return [
    product.name,
    product.sku,
    ...(product.aliases ?? []),
    ...(categoryName ? [categoryName] : []),
  ]
    .map((value) => prepareSearchCandidate(value))
    .filter((forms) => Boolean(forms.normalized));
}

function contiguousPhraseMatches(queryTokens: readonly string[], candidateTokens: readonly string[]) {
  if (queryTokens.length < 2 || candidateTokens.length < 2) return 0;
  let count = 0;
  for (let index = 0; index < queryTokens.length - 1; index += 1) {
    const left = queryTokens[index];
    const right = queryTokens[index + 1];
    if (left.length < 2 || right.length < 2) continue;
    for (let candidateIndex = 0; candidateIndex < candidateTokens.length - 1; candidateIndex += 1) {
      if (candidateTokens[candidateIndex] === left && candidateTokens[candidateIndex + 1] === right) {
        count += 1;
        break;
      }
    }
  }
  return count;
}

function scoreCandidateAgainstProduct(query: string, product: Product, categoryName?: string) {
  const queryForms = prepareSearchQuery(query);
  if (!queryForms.tokens.length) return null;

  const fields = collectProductFields(product, categoryName);
  const allCandidateTokens = [...new Set(fields.flatMap((forms) => forms.tokens))];
  const modelTokens = queryForms.tokens.filter((token) => MODEL_TOKEN_PATTERN.test(token));
  const exactModelMatches = modelTokens.filter((token) => allCandidateTokens.includes(token)).length;

  const exactTokenMatches = queryForms.tokens.filter((token) => allCandidateTokens.includes(token)).length;
  const phraseMatches = Math.max(0, ...fields.map((forms) => contiguousPhraseMatches(queryForms.tokens, forms.tokens)));

  let fuzzyMatches = 0;
  for (const queryToken of queryForms.tokens) {
    if (allCandidateTokens.includes(queryToken)) continue;
    if (allCandidateTokens.some((candidateToken) => editDistanceWithinOne(queryToken, candidateToken))) {
      fuzzyMatches += 1;
    }
  }

  const unmatched = Math.max(0, queryForms.tokens.length - exactTokenMatches - fuzzyMatches);
  const hasStrongSignal = exactModelMatches > 0 || phraseMatches > 0 || exactTokenMatches >= 2;
  if (!hasStrongSignal) return null;

  const score = (exactModelMatches * 70)
    + (phraseMatches * 30)
    + (exactTokenMatches * 8)
    + (fuzzyMatches * 3)
    - (unmatched * 2);

  return score;
}

function learningBoost(entry: SalesAiLearningEvidenceEntry | undefined, now = Date.now()) {
  if (!entry) return 0;
  const ageMs = Math.max(0, now - Number(entry.lastEventAt || 0));
  const decay = Math.pow(0.5, ageMs / (90 * 24 * 60 * 60 * 1000));
  const confidenceBoost = typeof entry.confidence === 'number'
    ? Math.max(0, Math.min(1, entry.confidence)) * 15
    : 0;
  const raw = (Number.isFinite(entry.score) ? entry.score : 0) + confidenceBoost;
  return Math.max(-8, Math.min(15, raw * decay));
}

export function sortSearchResultsWithLearning(
  results: readonly ProductSearchResult[],
  evidence: SalesAiLearningEvidence = {},
) {
  return [...results].sort((left, right) => {
    if (left.rank !== right.rank) return left.rank - right.rank;
    const learningOrder = learningBoost(evidence[right.product.id]) - learningBoost(evidence[left.product.id]);
    if (learningOrder) return learningOrder;
    const skuOrder = left.product.sku.localeCompare(right.product.sku, 'vi', { numeric: true });
    if (skuOrder) return skuOrder;
    const nameOrder = left.product.name.localeCompare(right.product.name, 'vi');
    if (nameOrder) return nameOrder;
    return left.product.id.localeCompare(right.product.id, 'vi', { numeric: true });
  });
}

export function rankSalesAiFallbackCandidates(
  products: readonly Product[],
  categories: readonly Category[],
  queries: readonly string[],
  evidence: SalesAiLearningEvidence = {},
): ProductSearchResult[] {
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name] as const));
  const uniqueQueries: string[] = [];
  const seenQueries = new Set<string>();

  for (const raw of [...queries, ...queries.flatMap(buildSalesSpeechCandidates)]) {
    uniquePush(uniqueQueries, seenQueries, raw);
    if (uniqueQueries.length >= 8) break;
  }

  const ranked = products
    .filter((product) => product.active === true)
    .map((product) => {
      let textScore = Number.NEGATIVE_INFINITY;
      for (const query of uniqueQueries) {
        const score = scoreCandidateAgainstProduct(
          query,
          product,
          product.categoryId ? categoryNameById.get(product.categoryId) : undefined,
        );
        if (typeof score === 'number') textScore = Math.max(textScore, score);
      }

      const learned = evidence[product.id];
      const boost = learningBoost(learned);
      const hasTextSignal = Number.isFinite(textScore);
      const hasLearningSignal = Boolean(learned && learned.score > 0);
      if (!hasTextSignal && !hasLearningSignal) return null;

      const score = (hasTextSignal ? textScore : 18) + boost;
      return {
        product,
        score,
        learningScore: learned?.score ?? 0,
      };
    })
    .filter((item): item is { product: Product; score: number; learningScore: number } => item !== null)
    .sort((left, right) => {
      if (left.score !== right.score) return right.score - left.score;
      if (left.learningScore !== right.learningScore) return right.learningScore - left.learningScore;
      const skuOrder = left.product.sku.localeCompare(right.product.sku, 'vi', { numeric: true });
      if (skuOrder) return skuOrder;
      return left.product.name.localeCompare(right.product.name, 'vi');
    })
    .slice(0, MAX_FALLBACK_RESULTS)
    .map(({ product }) => ({
      product,
      rank: 19,
      kind: 'fuzzy-name' as const,
    }));

  return ranked;
}
