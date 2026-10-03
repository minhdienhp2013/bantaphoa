export type FrogQuickAskIntent =
  | 'SEARCH_PRODUCT'
  | 'CHECK_PRICE'
  | 'CHECK_STOCK'
  | 'ADD_TO_CART'
  | 'OTHER';

export interface FrogQuickAskHints {
  intent: FrogQuickAskIntent;
  productQuery: string;
  sizeHint: string | null;
  colorHint: string | null;
  quantity: number | null;
}

const INTENTS = new Set<FrogQuickAskIntent>([
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

function cleanOptionalNullableText(value: unknown, maxLength: number) {
  if (typeof value === 'undefined') return null;
  return cleanNullableText(value, maxLength);
}

export function parseFrogQuickAskHints(value: unknown): FrogQuickAskHints | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (typeof raw.intent !== 'string' || !INTENTS.has(raw.intent as FrogQuickAskIntent)) return null;
  if (typeof raw.productQuery !== 'string') return null;

  const productQuery = raw.productQuery.replace(/\s+/gu, ' ').trim();
  if (!productQuery || productQuery.length > 200) return null;

  const sizeHint = cleanOptionalNullableText(raw.sizeHint, 80);
  const colorHint = cleanOptionalNullableText(raw.colorHint, 80);
  if (typeof sizeHint === 'undefined' || typeof colorHint === 'undefined') return null;

  let quantity: number | null = null;
  if (raw.quantity != null) {
    if (typeof raw.quantity !== 'number' || !Number.isInteger(raw.quantity) || raw.quantity <= 0 || raw.quantity > 9999) {
      return null;
    }
    quantity = raw.quantity;
  }

  return {
    intent: raw.intent as FrogQuickAskIntent,
    productQuery,
    sizeHint,
    colorHint,
    quantity,
  };
}
