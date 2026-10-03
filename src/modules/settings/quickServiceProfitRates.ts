import type { QuickServiceCategory, QuickServiceProfitRatesPercent } from '../../types/models';

export const QUICK_SERVICE_CATEGORIES: readonly QuickServiceCategory[] = [
  'photo',
  'printing',
  'scan',
  'computer',
  'stationery',
  'other',
] as const;

export const QUICK_SERVICE_CATEGORY_LABELS: Readonly<Record<QuickServiceCategory, string>> = {
  photo: 'Photocopy',
  printing: 'In & ép',
  scan: 'Scan',
  computer: 'Vi tính',
  stationery: 'Văn phòng phẩm',
  other: 'Khác',
};

export const DEFAULT_QUICK_SERVICE_PROFIT_RATES_PERCENT: Readonly<Record<QuickServiceCategory, number>> = {
  photo: 70,
  printing: 65,
  scan: 80,
  computer: 50,
  stationery: 20,
  other: 30,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertValidRate(value: unknown, category: QuickServiceCategory): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100) {
    throw new Error(`Tỷ lệ lợi nhuận ước tính ${QUICK_SERVICE_CATEGORY_LABELS[category]} phải là số nguyên từ 0 đến 100%.`);
  }
  return Number(value);
}

function assertExactCanonicalRateKeys(value: Record<string, unknown>) {
  const keys = Object.keys(value);
  const unknownKeys = keys.filter(
    (key) => !QUICK_SERVICE_CATEGORIES.includes(key as QuickServiceCategory),
  );
  if (unknownKeys.length > 0) {
    throw new Error(`Cấu hình tỷ lệ dịch vụ có khóa không hỗ trợ: ${unknownKeys.join(', ')}.`);
  }

  const missingKeys = QUICK_SERVICE_CATEGORIES.filter(
    (category) => !Object.prototype.hasOwnProperty.call(value, category),
  );
  if (missingKeys.length > 0 || keys.length !== QUICK_SERVICE_CATEGORIES.length) {
    throw new Error(`Cấu hình tỷ lệ dịch vụ phải có đủ đúng 6 khóa: ${QUICK_SERVICE_CATEGORIES.join(', ')}.`);
  }
}

export function resolveQuickServiceProfitRates(
  value: unknown,
): Record<QuickServiceCategory, number> {
  if (value == null) return { ...DEFAULT_QUICK_SERVICE_PROFIT_RATES_PERCENT };
  if (!isRecord(value)) throw new Error('Cấu hình tỷ lệ lợi nhuận dịch vụ không hợp lệ.');

  assertExactCanonicalRateKeys(value);

  return Object.fromEntries(
    QUICK_SERVICE_CATEGORIES.map((category) => [category, assertValidRate(value[category], category)]),
  ) as Record<QuickServiceCategory, number>;
}

export function validateQuickServiceProfitRatesForWrite(
  value: QuickServiceProfitRatesPercent,
): Record<QuickServiceCategory, number> {
  return resolveQuickServiceProfitRates(value);
}
