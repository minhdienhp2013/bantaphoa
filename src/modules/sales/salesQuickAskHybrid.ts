import { searchProducts, type ProductSearchResult, type SalePriceFilter } from '../../shared/search/productSearch';
import { prepareSearchQuery } from '../../shared/search/searchNormalization';
import type { Category, Product } from '../../types/models';
import { requestLocalFrog } from './localFrogClient';
import {
  buildSalesSpeechCandidates,
  rankSalesAiFallbackCandidates,
  sortSearchResultsWithLearning,
  type SalesAiLearningEvidence,
} from './salesAiLearningSearch';
import type { FrogQuickAskHints } from './localFrogSchema';
import {
  resolveSalesLocalPhonetics,
  type SalesApprovedPhoneticMapping,
  type SalesLocalResolution,
} from './salesLocalPhoneticResolver';
import { buildSalesLearningSignature } from './salesLearningSignature';
import {
  decideSalesEvidence,
  rankLocalSalesCandidates,
  summarizeEvidenceCandidates,
} from './salesSearchEvidence';
import { parseSalesChatQuery, type SalesChatIntent } from './salesChatParser';
import {
  answerSalesChatProduct,
  runSalesChat,
  type SalesChatCandidate,
  type SalesChatResult,
} from './salesChatSearch';

export interface HybridSearchTelemetry {
  normalizedQuery: string;
  normalizedSignature: string;
  phoneticVariants: string[];
  normalizedCandidates: string[];
  localPhoneticResolved: boolean;
  learnedMappingHit: boolean;
  deepSeekCalled: boolean;
  ambiguous: boolean;
  candidates: Array<{
    productId: string;
    rank: number;
    score?: number;
    evidenceTier?: string;
  }>;
  explanations: Array<{ source: string; target: string; kind: 'spoken-model' | 'phonetic' | 'learned'; confidence: number }>;
}

export interface HybridSalesChatResult extends SalesChatResult {
  source: 'deterministic' | 'local' | 'frog' | 'deepseek' | 'fallback';
  aiNotice?: string;
  requestedAddToCart?: {
    quantity: number;
    productId?: string;
  };
  requestedMarketCompare?: boolean;
  resolvedProductId?: string;
  telemetry?: HybridSearchTelemetry;
}

interface HybridAiHints extends FrogQuickAskHints {
  normalizedCandidates?: string[];
  minPrice?: number | null;
  maxPrice?: number | null;
  minPriceExclusive?: boolean;
  maxPriceExclusive?: boolean;
  inStockOnly?: boolean;
}

type HybridInterpreterResult =
  | { ok: true; hints: HybridAiHints }
  | { ok: false; reason: string };

type HybridInterpreter = (query: string) => Promise<HybridInterpreterResult>;
type LearningEvidenceLoader = (normalizedSignature: string) => Promise<SalesAiLearningEvidence>;

interface RunHybridSalesChatOptions {
  interpret?: HybridInterpreter;
  aiSource?: 'frog' | 'deepseek';
  contextProduct?: Product;
  getLearningEvidence?: LearningEvidenceLoader;
  approvedMappings?: readonly SalesApprovedPhoneticMapping[];
}

const EXACT_FAST_PATH_KINDS = new Set([
  'exact-qr',
  'exact-barcode',
  'exact-sku',
  'exact-name',
  'exact-alias',
]);

function isFuzzy(result: ProductSearchResult) {
  return result.kind === 'fuzzy-name' || result.kind === 'fuzzy-alias';
}

export function isMarketPriceQuery(query: string) {
  return /(?:trên\s*mạng|tren\s*mang|internet|trên\s*web|tren\s*web|\bweb\b|online|google|shopee|lazada)/iu.test(query);
}

function stripInternetMarketTerms(query: string) {
  return query
    .replace(/(?:kiếm|kiem|tìm|tim)\s+(?:giá\s+|gia\s+)?(?:ở\s+|o\s+)?(?:trên\s+)?(?:mạng|internet|web|online|google|shopee|lazada)/giu, ' ')
    .replace(/(?:trên\s*mạng|tren\s*mang|internet|trên\s*web|tren\s*web|\bweb\b|online|google|shopee|lazada)/giu, ' ')
    .replace(/(?:và|va)?\s*so\s*sánh\s*giá/giu, ' ')
    .replace(/(?:và|va)?\s*so\s*sanh\s*gia/giu, ' ')
    .replace(/giá\s*thị\s*trường|gia\s*thi\s*truong/giu, ' ')
    .replace(/^(?:tìm|tim|kiếm|kiem)\s+(?:giá|gia)\s+/iu, ' ')
    .replace(/(?:giá|gia)\s+(?:bao\s*nhiêu|bao\s*nhieu)/giu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function isDeicticMarketReference(query: string) {
  return /(?:(?:mẫu|mau)(?:\s+[^\s,.!?;:]+){0,3}\s+(?:này|nay)|(?:hàng|hang|sản\s*phẩm|san\s*pham|cái|cai|mặt\s*hàng|mat\s*hang)\s+(?:này|nay))/iu.test(query);
}

function resolveMarketProductDeterministically(
  products: readonly Product[],
  categories: readonly Category[],
  query: string,
  contextProduct?: Product,
) {
  if (
    contextProduct?.active === true
    && isDeicticMarketReference(query)
  ) {
    return contextProduct;
  }

  const cleaned = stripInternetMarketTerms(query);
  if (!cleaned) return undefined;

  const parsed = parseSalesChatQuery(cleaned);
  const productQuery = parsed.productQuery || cleaned;
  const matches = searchProducts(
    products.filter((product) => product.active === true),
    productQuery,
    { categories, limit: 5 },
  );
  const exactMatches = matches.filter((match) => EXACT_FAST_PATH_KINDS.has(match.kind));
  if (exactMatches.length === 1) return exactMatches[0].product;
  if (matches.length === 1 && !isFuzzy(matches[0])) return matches[0].product;
  return undefined;
}

function deterministicSearch(
  products: readonly Product[],
  query: string,
  categories: readonly Category[],
) {
  const parsed = parseSalesChatQuery(query);
  if (!parsed.productQuery) return { parsed, matches: [] as ProductSearchResult[] };

  const active = products.filter((product) => product.active === true);
  const eligible = parsed.intent === 'listInStock'
    ? active.filter((product) => Number(product.stockQuantity) > 0)
    : active;
  const matches = searchProducts(eligible, parsed.productQuery, {
    categories,
    limit: 12,
    ...(parsed.salePrice ? { salePrice: parsed.salePrice } : {}),
  });
  return { parsed, matches };
}

function canUseDeterministicFastPath(
  intent: SalesChatIntent,
  matches: readonly ProductSearchResult[],
) {
  if (matches.length === 0) return false;

  if (matches.some((match) => EXACT_FAST_PATH_KINDS.has(match.kind))) return true;
  if (intent === 'listAll' || intent === 'listInStock') {
    return !matches.some(isFuzzy);
  }
  if (
    intent === 'find'
    || intent === 'price'
    || intent === 'stockQuantity'
    || intent === 'availability'
  ) {
    return matches.length === 1 && !isFuzzy(matches[0]);
  }

  return false;
}

function mapAiIntent(hints: HybridAiHints, rawQuery: string): SalesChatIntent {
  if (hints.intent === 'CHECK_PRICE') return 'price';
  if (hints.intent === 'CHECK_STOCK') {
    return /(?:bao\s+nhiêu|bao\s+nhieu|bao\s+cái|bao\s+cai|còn\s+mấy|con\s+may|mấy\s+(?:cái|cai|ram|chiếc|chiec|bộ|bo))/iu.test(rawQuery)
      ? 'stockQuantity'
      : 'availability';
  }
  return 'find';
}

function buildHintQueries(hints: HybridAiHints) {
  const queryParts = [hints.productQuery, hints.sizeHint, hints.colorHint].filter(
    (part): part is string => Boolean(part?.trim()),
  );
  const full = queryParts.join(' ').replace(/\s+/gu, ' ').trim();
  const rawQueries = [
    ...(hints.normalizedCandidates ?? []),
    hints.productQuery,
    full,
  ];

  const seen = new Set<string>();
  const queries: string[] = [];
  for (const raw of rawQueries) {
    const cleaned = raw?.replace(/\s+/gu, ' ').trim();
    if (!cleaned) continue;
    const forms = prepareSearchQuery(cleaned);
    const dedupeKey = forms.expandedCompact || forms.compact || forms.normalized;
    if (!dedupeKey || seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    queries.push(cleaned);
    if (queries.length >= 5) break;
  }

  return queries;
}

function productMatchesSalePrice(product: Product, filter: SalePriceFilter | undefined) {
  if (!filter) return true;
  const price = Number(product.salePrice);
  if (!Number.isFinite(price) || price < 0) return false;
  if (typeof filter.min === 'number') {
    if (filter.minExclusive ? price <= filter.min : price < filter.min) return false;
  }
  if (typeof filter.max === 'number') {
    if (filter.maxExclusive ? price >= filter.max : price > filter.max) return false;
  }
  return true;
}

function buildAiSalePriceFilter(
  hints: HybridAiHints,
  deterministicFilter?: SalePriceFilter,
): SalePriceFilter | undefined {
  const hasAiMin = typeof hints.minPrice === 'number';
  const hasAiMax = typeof hints.maxPrice === 'number';
  if (!hasAiMin && !hasAiMax) return deterministicFilter;

  return {
    ...(hasAiMin ? {
      min: hints.minPrice as number,
      ...(hints.minPriceExclusive ? { minExclusive: true } : {}),
    } : {}),
    ...(hasAiMax ? {
      max: hints.maxPrice as number,
      ...(hints.maxPriceExclusive ? { maxExclusive: true } : {}),
    } : {}),
  };
}

function searchWithHints(
  products: readonly Product[],
  categories: readonly Category[],
  rawQuery: string,
  hints: HybridAiHints,
  learningEvidence: SalesAiLearningEvidence,
) {
  const parsedRaw = parseSalesChatQuery(rawQuery);
  let active = products.filter((product) => product.active === true);
  if (hints.inStockOnly === true) {
    active = active.filter((product) => Number(product.stockQuantity) > 0);
  }

  const salePrice = buildAiSalePriceFilter(hints, parsedRaw.salePrice);
  const salePriceOption = salePrice ? { salePrice } : {};
  active = active.filter((product) => productMatchesSalePrice(product, salePrice));

  const aggregated = new Map<string, { result: ProductSearchResult; candidateIndex: number }>();
  const queries = buildHintQueries(hints);

  queries.forEach((query, candidateIndex) => {
    const candidateMatches = searchProducts(active, query, {
      categories,
      limit: 12,
      ...salePriceOption,
    });

    for (const result of candidateMatches) {
      const current = aggregated.get(result.product.id);
      if (
        !current
        || result.rank < current.result.rank
        || (result.rank === current.result.rank && candidateIndex < current.candidateIndex)
      ) {
        aggregated.set(result.product.id, { result, candidateIndex });
      }
    }
  });

  let matches = sortSearchResultsWithLearning(
    [...aggregated.values()]
      .sort((left, right) => {
        if (left.result.rank !== right.result.rank) return left.result.rank - right.result.rank;
        if (left.candidateIndex !== right.candidateIndex) return left.candidateIndex - right.candidateIndex;
        return 0;
      })
      .map(({ result }) => result),
    learningEvidence,
  );

  if (matches.length === 0) {
    matches = rankSalesAiFallbackCandidates(
      active,
      categories,
      [rawQuery, ...queries, ...buildSalesSpeechCandidates(rawQuery)],
      learningEvidence,
    );
  }

  const narrowByHint = (current: readonly ProductSearchResult[], hint: string | null) => {
    const cleaned = hint?.trim();
    if (!cleaned || current.length === 0) return [...current];
    return searchProducts(current.map((match) => match.product), cleaned, {
      categories,
      limit: 12,
    });
  };

  if (hints.sizeHint) matches = narrowByHint(matches, hints.sizeHint);
  if (hints.colorHint) matches = narrowByHint(matches, hints.colorHint);

  return matches.slice(0, 5);
}

function toCandidates(matches: readonly ProductSearchResult[]): SalesChatCandidate[] {
  return matches.map(({ product, kind }) => ({ product, matchKind: kind }));
}

function aiResultToSalesChat(
  products: readonly Product[],
  categories: readonly Category[],
  rawQuery: string,
  hints: HybridAiHints,
  source: 'frog' | 'deepseek',
  contextProduct: Product | undefined,
  learningEvidence: SalesAiLearningEvidence,
): HybridSalesChatResult {
  const marketRequested = isMarketPriceQuery(rawQuery);
  const canUseContext = marketRequested
    && isDeicticMarketReference(rawQuery)
    && contextProduct?.active === true;

  if (hints.intent === 'OTHER') {
    if (canUseContext && contextProduct) {
      return {
        query: rawQuery.trim(),
        intent: 'price',
        message: `Đã chọn ${contextProduct.name}. Đang tìm giá thị trường trên web…`,
        candidates: [],
        fuzzySuggestion: false,
        source,
        requestedMarketCompare: true,
        resolvedProductId: contextProduct.id,
      };
    }
    const fallback = runSalesChat(products, rawQuery, categories);
    return fallbackWithCandidates(products, categories, rawQuery, fallback, learningEvidence);
  }

  const matches = searchWithHints(products, categories, rawQuery, hints, learningEvidence);
  const intent = mapAiIntent(hints, rawQuery);
  const quantity = hints.quantity ?? 1;

  if (matches.length === 0) {
    if (canUseContext && contextProduct) {
      return {
        query: rawQuery.trim(),
        intent: 'price',
        message: `Đã chọn ${contextProduct.name}. Đang tìm giá thị trường trên web…`,
        candidates: [],
        fuzzySuggestion: false,
        source,
        requestedMarketCompare: true,
        resolvedProductId: contextProduct.id,
      };
    }
    const fallback = runSalesChat(products, rawQuery, categories);
    return fallbackWithCandidates(products, categories, rawQuery, fallback, learningEvidence);
  }

  const fuzzy = matches.some(isFuzzy);

  if (marketRequested) {
    if (matches.length === 1 && !fuzzy) {
      const product = matches[0].product;
      return {
        query: rawQuery.trim(),
        intent: 'price',
        message: `Đã xác định ${product.name}. Đang tìm giá thị trường trên web…`,
        candidates: [],
        fuzzySuggestion: false,
        source,
        requestedMarketCompare: true,
        resolvedProductId: product.id,
      };
    }

    return {
      query: rawQuery.trim(),
      intent: 'price',
      message: `Tìm thấy ${matches.length} sản phẩm có thể phù hợp. Hãy chọn mẫu cần so sánh giá thị trường.`,
      candidates: toCandidates(matches),
      fuzzySuggestion: fuzzy,
      source,
      requestedMarketCompare: true,
    };
  }
  if (hints.intent === 'ADD_TO_CART') {
    if (matches.length === 1 && !fuzzy) {
      const product = matches[0].product;
      return {
        query: rawQuery.trim(),
        intent,
        message: `Thêm ${quantity} × ${product.name} vào hóa đơn?`,
        candidates: [],
        fuzzySuggestion: false,
        source,
        requestedAddToCart: { quantity, productId: product.id },
      };
    }
    return {
      query: rawQuery.trim(),
      intent,
      message: `Tìm thấy ${matches.length} sản phẩm có thể phù hợp. Hãy chọn sản phẩm để xác nhận thêm ${quantity} vào hóa đơn.`,
      candidates: toCandidates(matches),
      fuzzySuggestion: fuzzy,
      source,
      requestedAddToCart: { quantity },
    };
  }

  if (matches.length === 1 && !fuzzy) {
    return {
      query: rawQuery.trim(),
      intent,
      message: answerSalesChatProduct(matches[0].product, intent),
      candidates: [],
      fuzzySuggestion: false,
      source,
      resolvedProductId: matches[0].product.id,
    };
  }

  return {
    query: rawQuery.trim(),
    intent,
    message: fuzzy
      ? `Tìm thấy ${matches.length} gợi ý gần. Hãy chọn sản phẩm cần xem.`
      : `Tìm thấy ${matches.length} sản phẩm phù hợp. Hãy chọn sản phẩm cần xem.`,
    candidates: toCandidates(matches),
    fuzzySuggestion: fuzzy,
    source,
  };
}

function parseLocalQuantityToken(value: string | undefined) {
  if (!value) return 1;
  if (/^\d{1,4}$/u.test(value)) {
    const parsed = Number(value);
    return parsed > 0 ? parsed : 1;
  }

  const normalized = prepareSearchQuery(value).normalized;
  const numberWords: Readonly<Record<string, number>> = {
    mot: 1,
    hai: 2,
    ba: 3,
    bon: 4,
    tu: 4,
    nam: 5,
    sau: 6,
    bay: 7,
    tam: 8,
    chin: 9,
    muoi: 10,
  };
  return numberWords[normalized] ?? 1;
}

function parseLocalAddToCartCommand(query: string) {
  const normalized = prepareSearchQuery(query).normalized;
  const match = /^(?:cho|them|lay)\s+(?:(\d{1,4}|mot|hai|ba|bon|tu|nam|sau|bay|tam|chin|muoi)\s+)?(.+?)\s+(?:vao\s+(?:hoa\s+don|gio)|them\s+vao\s+(?:hoa\s+don|gio))$/u.exec(normalized);
  if (!match) return null;
  const productQuery = match[2]?.trim();
  if (!productQuery) return null;
  return {
    quantity: parseLocalQuantityToken(match[1]),
    productQuery,
  };
}

function basicTelemetry(query: string, productQuery: string): HybridSearchTelemetry {
  const normalizedQuery = prepareSearchQuery(productQuery || query).normalized;
  return {
    normalizedQuery,
    normalizedSignature: normalizedQuery,
    phoneticVariants: [],
    normalizedCandidates: [],
    localPhoneticResolved: false,
    learnedMappingHit: false,
    deepSeekCalled: false,
    ambiguous: false,
    candidates: [],
    explanations: [],
  };
}

function localTelemetry(
  resolution: SalesLocalResolution,
  normalizedSignature: string,
  ranked: ReturnType<typeof rankLocalSalesCandidates>,
  ambiguous: boolean,
): HybridSearchTelemetry {
  return {
    normalizedQuery: resolution.normalizedQuery,
    normalizedSignature,
    phoneticVariants: resolution.candidates,
    normalizedCandidates: resolution.candidates,
    localPhoneticResolved: resolution.transformations.length > 0,
    learnedMappingHit: resolution.transformations.some((item) => item.kind === 'learned'),
    deepSeekCalled: false,
    ambiguous,
    candidates: summarizeEvidenceCandidates(ranked),
    explanations: resolution.transformations.map((item) => ({
      source: item.source,
      target: item.target,
      kind: item.kind,
      confidence: item.confidence,
    })),
  };
}

function withAiTelemetry(
  base: HybridSearchTelemetry,
  result: HybridSalesChatResult,
  hints: HybridAiHints,
) {
  return {
    ...result,
    telemetry: {
      ...base,
      deepSeekCalled: true,
      ambiguous: result.candidates.length > 1,
      normalizedCandidates: buildHintQueries(hints),
      candidates: result.candidates.slice(0, 5).map((candidate, index) => ({
        productId: candidate.product.id,
        rank: index,
      })),
    },
  } satisfies HybridSalesChatResult;
}

function fallbackWithCandidates(
  products: readonly Product[],
  categories: readonly Category[],
  query: string,
  base: SalesChatResult,
  learningEvidence: SalesAiLearningEvidence,
): HybridSalesChatResult {
  const inspected = deterministicSearch(products, query, categories);
  if (inspected.matches.length > 0) {
    const rankedDirect = sortSearchResultsWithLearning(inspected.matches, learningEvidence).slice(0, 5);
    const fuzzy = rankedDirect.some(isFuzzy);
    return {
      query: query.trim(),
      intent: inspected.parsed.intent,
      message: fuzzy
        ? `Tìm thấy ${rankedDirect.length} gợi ý gần. Hãy chọn sản phẩm cần xem.`
        : `Tìm thấy ${rankedDirect.length} sản phẩm phù hợp. Hãy chọn sản phẩm cần xem.`,
      candidates: toCandidates(rankedDirect),
      fuzzySuggestion: fuzzy,
      source: 'fallback',
    };
  }

  if (!/Không tìm thấy sản phẩm phù hợp\./u.test(base.message)) {
    return { ...base, source: 'fallback' };
  }

  const parsed = parseSalesChatQuery(query);
  const ranked = rankSalesAiFallbackCandidates(
    products,
    categories,
    [parsed.productQuery || query, ...buildSalesSpeechCandidates(query)],
    learningEvidence,
  );
  if (ranked.length === 0) return { ...base, source: 'fallback' };

  return {
    query: query.trim(),
    intent: parsed.intent,
    message: `Có thể bạn muốn tìm một trong ${ranked.length} sản phẩm gần nhất dưới đây.`,
    candidates: toCandidates(ranked),
    fuzzySuggestion: true,
    source: 'fallback',
  };
}

export async function runHybridSalesChat(
  products: readonly Product[],
  query: string,
  categories: readonly Category[] = [],
  options: RunHybridSalesChatOptions = {},
): Promise<HybridSalesChatResult> {
  const deterministic = runSalesChat(products, query, categories);
  const inspected = deterministicSearch(products, query, categories);
  const marketRequested = isMarketPriceQuery(query);
  const localAdd = parseLocalAddToCartCommand(query);

  const marketCleaned = marketRequested ? stripInternetMarketTerms(query) : '';
  const marketParsed = marketCleaned ? parseSalesChatQuery(marketCleaned) : null;
  const localProductQuery = localAdd?.productQuery
    ?? marketParsed?.productQuery
    ?? inspected.parsed.productQuery
    ?? query;
  const deterministicTelemetry = basicTelemetry(query, localProductQuery);

  if (marketRequested) {
    const resolvedMarketProduct = resolveMarketProductDeterministically(
      products,
      categories,
      query,
      options.contextProduct,
    );
    if (resolvedMarketProduct) {
      return {
        query: query.trim(),
        intent: 'price',
        message: `Đã xác định ${resolvedMarketProduct.name}. Chỉ bây giờ mới tìm giá trên Internet theo yêu cầu của bạn…`,
        candidates: [],
        fuzzySuggestion: false,
        source: 'deterministic',
        requestedMarketCompare: true,
        resolvedProductId: resolvedMarketProduct.id,
        telemetry: {
          ...deterministicTelemetry,
          candidates: [{ productId: resolvedMarketProduct.id, rank: 0 }],
        },
      };
    }
  }

  if (!marketRequested && !localAdd && canUseDeterministicFastPath(inspected.parsed.intent, inspected.matches)) {
    const exactMatch = inspected.matches.find((match) => EXACT_FAST_PATH_KINDS.has(match.kind));
    const resolvedProductId = exactMatch?.product.id
      ?? (inspected.matches.length === 1 ? inspected.matches[0].product.id : undefined);
    return {
      ...deterministic,
      source: 'deterministic',
      ...(resolvedProductId ? { resolvedProductId } : {}),
      telemetry: {
        ...deterministicTelemetry,
        candidates: inspected.matches.slice(0, 5).map((match, index) => ({
          productId: match.product.id,
          rank: index,
        })),
      },
    };
  }

  const resolution = resolveSalesLocalPhonetics(
    products,
    categories,
    localProductQuery,
    options.approvedMappings ?? [],
  );
  const signature = buildSalesLearningSignature(resolution);

  let learningEvidence: SalesAiLearningEvidence = {};
  if (options.getLearningEvidence && signature.normalizedSignature) {
    try {
      learningEvidence = await options.getLearningEvidence(signature.normalizedSignature);
    } catch {
      learningEvidence = {};
    }
  }

  const eligibleProducts = inspected.parsed.intent === 'listInStock'
    ? products.filter((product) => Number(product.stockQuantity) > 0)
    : products;
  const rankedLocal = rankLocalSalesCandidates(
    eligibleProducts,
    categories,
    resolution,
    learningEvidence,
    {
      ...(inspected.parsed.salePrice ? { salePrice: inspected.parsed.salePrice } : {}),
    },
  );
  const localDecision = decideSalesEvidence(rankedLocal);
  const telemetry = localTelemetry(
    resolution,
    signature.normalizedSignature,
    rankedLocal,
    localDecision.status === 'ambiguous',
  );

  if (localDecision.status === 'resolved' && rankedLocal[0]) {
    const product = rankedLocal[0].result.product;
    if (marketRequested) {
      return {
        query: query.trim(),
        intent: 'price',
        message: `Đã xác định ${product.name}. Đang tìm giá thị trường trên web…`,
        candidates: [],
        fuzzySuggestion: false,
        source: 'local',
        requestedMarketCompare: true,
        resolvedProductId: product.id,
        telemetry,
      };
    }

    if (localAdd) {
      return {
        query: query.trim(),
        intent: 'find',
        message: `Thêm ${localAdd.quantity} × ${product.name} vào hóa đơn?`,
        candidates: [],
        fuzzySuggestion: false,
        source: 'local',
        requestedAddToCart: { quantity: localAdd.quantity, productId: product.id },
        resolvedProductId: product.id,
        telemetry,
      };
    }

    return {
      query: query.trim(),
      intent: inspected.parsed.intent,
      message: answerSalesChatProduct(product, inspected.parsed.intent),
      candidates: [],
      fuzzySuggestion: false,
      source: 'local',
      resolvedProductId: product.id,
      telemetry,
    };
  }

  const hasLearnedEvidence = Object.keys(learningEvidence).length > 0;
  const boundedLocalAmbiguity = localDecision.status === 'ambiguous'
    && (resolution.transformations.length > 0 || hasLearnedEvidence);

  if (boundedLocalAmbiguity) {
    const matches = rankedLocal.slice(0, 5).map((candidate) => candidate.result);
    return {
      query: query.trim(),
      intent: inspected.parsed.intent,
      message: localAdd
        ? `Tìm thấy ${matches.length} sản phẩm gần nhau. Hãy chọn sản phẩm để xác nhận thêm ${localAdd.quantity} vào hóa đơn.`
        : `Tìm thấy ${matches.length} sản phẩm gần nhau. Hãy chọn đúng sản phẩm.`,
      candidates: toCandidates(matches),
      fuzzySuggestion: true,
      source: 'local',
      ...(localAdd ? { requestedAddToCart: { quantity: localAdd.quantity } } : {}),
      telemetry: { ...telemetry, ambiguous: true },
    };
  }

  const interpret: HybridInterpreter = options.interpret ?? requestLocalFrog;
  const ai = await interpret(query);
  if (!ai.ok) {
    if (rankedLocal.length > 0) {
      const matches = rankedLocal.slice(0, 5).map((candidate) => candidate.result);
      return {
        query: query.trim(),
        intent: inspected.parsed.intent,
        message: `AI chưa sẵn sàng. Có ${matches.length} gợi ý local gần nhất; hãy chọn đúng sản phẩm.`,
        candidates: toCandidates(matches),
        fuzzySuggestion: true,
        source: 'fallback',
        ...(localAdd ? { requestedAddToCart: { quantity: localAdd.quantity } } : {}),
        telemetry: { ...telemetry, ambiguous: matches.length > 1 },
        aiNotice: options.aiSource === 'deepseek'
          ? 'AI chưa sẵn sàng — đang dùng tìm kiếm local.'
          : 'AI cục bộ chưa sẵn sàng — đang dùng tìm kiếm local.',
      };
    }

    const fallback = fallbackWithCandidates(products, categories, query, deterministic, learningEvidence);
    return {
      ...fallback,
      telemetry: { ...telemetry, deepSeekCalled: true, ambiguous: fallback.candidates.length > 1 },
      aiNotice: options.aiSource === 'deepseek'
        ? 'AI chưa sẵn sàng — đang dùng tìm kiếm thường.'
        : 'AI cục bộ chưa sẵn sàng — đang dùng tìm kiếm thường.',
    };
  }

  const aiResult = aiResultToSalesChat(
    products,
    categories,
    query,
    ai.hints,
    options.aiSource ?? 'frog',
    options.contextProduct,
    learningEvidence,
  );

  const aiQueries = buildHintQueries(ai.hints);
  const aiResolution = resolveSalesLocalPhonetics(
    products,
    categories,
    aiQueries[0] ?? ai.hints.productQuery ?? localProductQuery,
    options.approvedMappings ?? [],
  );
  const aiSignature = buildSalesLearningSignature(aiResolution);

  return withAiTelemetry(
    {
      ...telemetry,
      normalizedQuery: aiResolution.normalizedQuery || telemetry.normalizedQuery,
      normalizedSignature: aiSignature.normalizedSignature || telemetry.normalizedSignature,
      phoneticVariants: aiResolution.candidates,
      explanations: [
        ...telemetry.explanations,
        ...aiResolution.transformations.map((item) => ({
          source: item.source,
          target: item.target,
          kind: item.kind,
          confidence: item.confidence,
        })),
      ],
    },
    aiResult,
    ai.hints,
  );
}

