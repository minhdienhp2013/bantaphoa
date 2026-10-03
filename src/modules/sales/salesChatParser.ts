import type { SalePriceFilter } from '../../shared/search/productSearch';

export type SalesChatIntent =
  | 'find'
  | 'stockQuantity'
  | 'availability'
  | 'listInStock'
  | 'listAll'
  | 'price';

export interface ParsedSalesChatQuery {
  intent: SalesChatIntent;
  productQuery: string;
  salePrice?: SalePriceFilter;
}

type MoneyMatch = {
  amount: number;
  source: string;
};

const MONEY_PATTERN = /(\d+(?:[.,]\d+)?)\s*(triệu|trieu|tr|nghìn|nghin|ngàn|ngan|k)\b/iu;

function normalizeForIntent(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .toLocaleLowerCase('vi-VN');
}

function parseMoneyMatch(value: string): MoneyMatch | null {
  const match = MONEY_PATTERN.exec(value);
  if (!match) return null;

  const numericValue = Number(match[1].replace(',', '.'));
  const normalizedUnit = normalizeForIntent(match[2]);
  const multiplier = normalizedUnit === 'trieu' || normalizedUnit === 'tr' ? 1_000_000 : 1_000;
  const amount = Math.round(numericValue * multiplier);
  if (!Number.isFinite(amount) || amount < 0) return null;
  return { amount, source: match[0] };
}

function findPriceFilter(value: string): { filter?: SalePriceFilter; source?: string } {
  const range = /(?:từ|tu)\s+(.+?)\s+(?:đến|den|tới|toi)\s+(.+)/iu.exec(value);
  if (range) {
    const min = parseMoneyMatch(range[1]);
    const max = parseMoneyMatch(range[2]);
    if (min && max) {
      return {
        filter: { min: min.amount, max: max.amount },
        source: range[0].slice(0, range[0].indexOf(max.source) + max.source.length),
      };
    }
  }

  const patterns: Array<{
    pattern: RegExp;
    build: (amount: number) => SalePriceFilter;
  }> = [
    { pattern: /(?:trên|tren|hơn|hon)\s+(.+)/iu, build: (min) => ({ min, minExclusive: true }) },
    { pattern: /(?:từ|tu)\s+(.+)/iu, build: (min) => ({ min }) },
    { pattern: /(?:dưới|duoi|nhỏ hơn|nho hon)\s+(.+)/iu, build: (max) => ({ max, maxExclusive: true }) },
    { pattern: /(?:tối đa|toi da|không quá|khong qua)\s+(.+)/iu, build: (max) => ({ max }) },
  ];

  for (const { pattern, build } of patterns) {
    const match = pattern.exec(value);
    if (!match) continue;
    const money = parseMoneyMatch(match[1]);
    if (!money) continue;
    return {
      filter: build(money.amount),
      source: match[0].slice(0, match[0].indexOf(money.source) + money.source.length),
    };
  }

  return {};
}

function detectIntent(value: string, hasPriceFilter: boolean): SalesChatIntent {
  const normalized = normalizeForIntent(value);
  if (/\bcon\s+bao\s+nhieu\b/u.test(normalized)) return 'stockQuantity';
  if (/\b(?:co\s+)?con\s+hang\s+khong\b/u.test(normalized)) return 'availability';
  if (/\bcon\s+(?:nhung\s+)?loai\s+nao\b/u.test(normalized)) return 'listInStock';
  if (/\bco\s+(?:nhung\s+)?loai\s+nao\b/u.test(normalized)) return 'listAll';
  if (/\bgia\s+bao\s+nhieu\b/u.test(normalized) || hasPriceFilter) return 'price';
  return 'find';
}

function cleanProductQuery(value: string, priceSource?: string) {
  let cleaned = value;
  if (priceSource) cleaned = cleaned.replace(priceSource, ' ');

  cleaned = cleaned
    .replace(/^\s*(?:tìm|tim|kiếm|kiem)\s+/iu, '')
    .replace(/(?:có|co)?\s*còn\s+hàng\s+không|(?:co\s+)?con\s+hang\s+khong/giu, ' ')
    .replace(/còn\s+bao\s+nhiêu|con\s+bao\s+nhieu/giu, ' ')
    .replace(/còn\s+(?:những\s+)?loại\s+nào|con\s+(?:nhung\s+)?loai\s+nao/giu, ' ')
    .replace(/có\s+(?:những\s+)?loại\s+nào|co\s+(?:nhung\s+)?loai\s+nao/giu, ' ')
    .replace(/giá\s+bao\s+nhiêu|gia\s+bao\s+nhieu/giu, ' ')
    .replace(/[?!.]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();

  return cleaned;
}

export function parseSalesChatQuery(value: string): ParsedSalesChatQuery {
  const normalizedInput = value.replace(/\s+/gu, ' ').trim();
  const price = findPriceFilter(normalizedInput);
  const intent = detectIntent(normalizedInput, Boolean(price.filter));
  const productQuery = cleanProductQuery(normalizedInput, price.source);

  return {
    intent,
    productQuery,
    ...(price.filter ? { salePrice: price.filter } : {}),
  };
}
