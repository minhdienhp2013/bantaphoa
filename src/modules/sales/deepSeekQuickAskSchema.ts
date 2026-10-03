export type DeepSeekQuickAskIntent =
  | 'SEARCH_PRODUCT'
  | 'CHECK_PRICE'
  | 'CHECK_STOCK'
  | 'ADD_TO_CART'
  | 'OTHER';

export interface DeepSeekQuickAskHints {
  intent: DeepSeekQuickAskIntent;
  productQuery: string;
  normalizedCandidates: string[];
  sizeHint: string | null;
  colorHint: string | null;
  quantity: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  minPriceExclusive: boolean;
  maxPriceExclusive: boolean;
  inStockOnly: boolean;
}

const MAX_NORMALIZED_CANDIDATES = 5;
const MAX_NORMALIZED_CANDIDATE_LENGTH = 200;

const INTENTS = new Set<DeepSeekQuickAskIntent>([
  'SEARCH_PRODUCT',
  'CHECK_PRICE',
  'CHECK_STOCK',
  'ADD_TO_CART',
  'OTHER',
]);

function cleanNullableText(value: unknown, maxLength: number) {
  if (value === null) return null;
  if (typeof value !== 'string') return undefined;
  const cleaned = value.replace(/\s+/gu, ' ').trim();
  if (!cleaned || cleaned.length > maxLength) return undefined;
  return cleaned;
}

function parseNormalizedCandidates(value: unknown) {
  if (!Array.isArray(value)) return undefined;

  const seen = new Set<string>();
  const normalizedCandidates: string[] = [];

  for (const item of value) {
    if (typeof item !== 'string') return undefined;
    const cleaned = item.replace(/\s+/gu, ' ').trim();
    if (!cleaned || cleaned.length > MAX_NORMALIZED_CANDIDATE_LENGTH) return undefined;

    const dedupeKey = cleaned.toLocaleLowerCase('vi');
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    normalizedCandidates.push(cleaned);
    if (normalizedCandidates.length >= MAX_NORMALIZED_CANDIDATES) break;
  }

  return normalizedCandidates;
}

function parseNullableMoney(value: unknown) {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || !Number.isInteger(value)) {
    return undefined;
  }
  return value;
}

export function parseDeepSeekQuickAskHints(value: unknown): DeepSeekQuickAskHints | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;

  if (typeof raw.intent !== 'string' || !INTENTS.has(raw.intent as DeepSeekQuickAskIntent)) return null;
  if (typeof raw.productQuery !== 'string') return null;

  const productQuery = raw.productQuery.replace(/\s+/gu, ' ').trim();
  if (productQuery.length > 200) return null;
  if (raw.intent !== 'OTHER' && !productQuery) return null;

  const normalizedCandidates = parseNormalizedCandidates(raw.normalizedCandidates);
  if (typeof normalizedCandidates === 'undefined') return null;

  const sizeHint = cleanNullableText(raw.sizeHint, 80);
  const colorHint = cleanNullableText(raw.colorHint, 80);
  if (typeof sizeHint === 'undefined' || typeof colorHint === 'undefined') return null;

  let quantity: number | null = null;
  if (raw.quantity !== null) {
    if (typeof raw.quantity !== 'number' || !Number.isInteger(raw.quantity) || raw.quantity <= 0 || raw.quantity > 9999) {
      return null;
    }
    quantity = raw.quantity;
  }

  const minPrice = parseNullableMoney(raw.minPrice);
  const maxPrice = parseNullableMoney(raw.maxPrice);
  if (typeof minPrice === 'undefined' || typeof maxPrice === 'undefined') return null;
  if (minPrice !== null && maxPrice !== null && minPrice > maxPrice) return null;

  if (typeof raw.minPriceExclusive !== 'boolean') return null;
  if (typeof raw.maxPriceExclusive !== 'boolean') return null;
  if (typeof raw.inStockOnly !== 'boolean') return null;

  if (
    minPrice !== null
    && maxPrice !== null
    && minPrice === maxPrice
    && (raw.minPriceExclusive || raw.maxPriceExclusive)
  ) {
    return null;
  }

  return {
    intent: raw.intent as DeepSeekQuickAskIntent,
    productQuery,
    normalizedCandidates,
    sizeHint,
    colorHint,
    quantity,
    minPrice,
    maxPrice,
    minPriceExclusive: raw.minPriceExclusive,
    maxPriceExclusive: raw.maxPriceExclusive,
    inStockOnly: raw.inStockOnly,
  };
}
