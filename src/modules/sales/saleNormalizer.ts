import type {
  PaymentMethod,
  ProductSale,
  QuickServiceCategory,
  QuickServiceSale,
  Sale,
  SaleItem,
} from '../../types/models';

const PRODUCT_STATUSES = new Set(['completed', 'cancelled', 'refunded']);
const QUICK_STATUSES = new Set(['completed', 'cancelled']);
const PRODUCT_PAYMENT_METHODS = new Set<PaymentMethod>(['cash', 'bank_transfer', 'other']);
const QUICK_PAYMENT_METHODS = new Set(['cash', 'bank_transfer']);
const QUICK_CATEGORIES = new Set<QuickServiceCategory>([
  'photo',
  'printing',
  'scan',
  'computer',
  'stationery',
  'other',
]);

const PRODUCT_ALLOWED_FIELDS = new Set([
  'id', 'code', 'saleKind', 'customerId', 'customerName', 'items', 'subtotal', 'discount', 'total',
  'costTotal', 'profit', 'paymentMethod', 'note', 'status', 'createdBy', 'createdAt', 'updatedAt',
]);
const QUICK_ALLOWED_FIELDS = new Set([
  'id', 'code', 'saleKind', 'serviceCategory', 'estimatedProfitRatePercent', 'customerId', 'customerName',
  'subtotal', 'discount', 'total', 'paymentMethod', 'note', 'status', 'createdBy', 'createdAt', 'updatedAt',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasOnlyFields(value: Record<string, unknown>, allowed: Set<string>) {
  return Object.keys(value).every((key) => allowed.has(key));
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function optionalString(value: unknown): string | undefined | null {
  if (value == null) return undefined;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isIntegerMoney(value: unknown, allowNegative = false): value is number {
  return Number.isSafeInteger(value) && (allowNegative || Number(value) >= 0);
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

function isFractionalQuantity(value: unknown): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return false;
  return Math.round(value * 1000) / 1000 === value;
}

function normalizeItems(value: unknown): SaleItem[] | null {
  const raw = Array.isArray(value)
    ? value
    : isRecord(value)
      ? Object.values(value)
      : null;
  if (!raw || raw.length === 0) return null;

  const items: SaleItem[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) return null;
    if (!hasOnlyFields(entry, new Set(['productId', 'sku', 'name', 'quantity', 'unitPrice', 'costPrice', 'lineTotal']))) return null;
    if (!isNonEmptyString(entry.productId) || !isNonEmptyString(entry.sku) || !isNonEmptyString(entry.name)) return null;
    if (!isFractionalQuantity(entry.quantity)) return null;
    if (!isIntegerMoney(entry.unitPrice) || !isIntegerMoney(entry.costPrice) || !isIntegerMoney(entry.lineTotal)) return null;
    if (Math.round(Number(entry.quantity) * Number(entry.unitPrice)) !== entry.lineTotal) return null;
    items.push({
      productId: entry.productId,
      sku: entry.sku,
      name: entry.name,
      quantity: entry.quantity,
      unitPrice: entry.unitPrice,
      costPrice: entry.costPrice,
      lineTotal: entry.lineTotal,
    });
  }
  return items;
}

function baseFields(id: string, value: Record<string, unknown>) {
  if (value.id !== id || !isNonEmptyString(value.code) || !isNonEmptyString(value.createdBy)) return null;
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.updatedAt)) return null;
  if (!isIntegerMoney(value.subtotal) || !isIntegerMoney(value.discount) || !isIntegerMoney(value.total)) return null;
  if (value.total !== value.subtotal - value.discount || value.discount > value.subtotal) return null;

  const customerId = optionalString(value.customerId);
  const customerName = optionalString(value.customerName);
  const note = optionalString(value.note);
  if (customerId === null || customerName === null || note === null) return null;
  if (Boolean(customerId) !== Boolean(customerName)) return null;

  return {
    id,
    code: value.code,
    subtotal: value.subtotal,
    discount: value.discount,
    total: value.total,
    createdBy: value.createdBy,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    ...(customerId ? { customerId } : {}),
    ...(customerName ? { customerName } : {}),
    ...(note ? { note } : {}),
  };
}

function normalizeProductSale(id: string, value: Record<string, unknown>): ProductSale | null {
  if (!hasOnlyFields(value, PRODUCT_ALLOWED_FIELDS)) return null;
  if (value.saleKind != null && value.saleKind !== 'product') return null;
  if (!PRODUCT_STATUSES.has(String(value.status))) return null;
  if (value.paymentMethod != null && !PRODUCT_PAYMENT_METHODS.has(value.paymentMethod as PaymentMethod)) return null;
  if (!isIntegerMoney(value.costTotal) || !isIntegerMoney(value.profit, true)) return null;

  const base = baseFields(id, value);
  const items = normalizeItems(value.items);
  if (!base || !items) return null;

  const expectedCostTotal = items.reduce((sum, item) => sum + Math.round(item.quantity * item.costPrice), 0);
  if (value.costTotal !== expectedCostTotal || value.profit !== base.total - value.costTotal) return null;

  return {
    ...base,
    saleKind: 'product',
    items,
    costTotal: value.costTotal,
    profit: value.profit,
    status: value.status as ProductSale['status'],
    ...(value.paymentMethod ? { paymentMethod: value.paymentMethod as PaymentMethod } : {}),
  };
}

function normalizeQuickServiceSale(id: string, value: Record<string, unknown>): QuickServiceSale | null {
  if (!hasOnlyFields(value, QUICK_ALLOWED_FIELDS)) return null;
  if (value.saleKind !== 'quick_service') return null;
  if (!QUICK_CATEGORIES.has(value.serviceCategory as QuickServiceCategory)) return null;
  if (!QUICK_STATUSES.has(String(value.status))) return null;
  if (!QUICK_PAYMENT_METHODS.has(String(value.paymentMethod))) return null;
  if (!Number.isSafeInteger(value.estimatedProfitRatePercent) || Number(value.estimatedProfitRatePercent) < 0 || Number(value.estimatedProfitRatePercent) > 100) return null;
  if (value.discount !== 0 || !isIntegerMoney(value.subtotal) || Number(value.subtotal) <= 0 || value.total !== value.subtotal) return null;

  const base = baseFields(id, value);
  if (!base) return null;

  return {
    ...base,
    saleKind: 'quick_service',
    serviceCategory: value.serviceCategory as QuickServiceCategory,
    estimatedProfitRatePercent: Number(value.estimatedProfitRatePercent),
    paymentMethod: value.paymentMethod as QuickServiceSale['paymentMethod'],
    discount: 0,
    status: value.status as QuickServiceSale['status'],
  };
}

export function normalizeSale(id: string, value: unknown): Sale | null {
  if (!isRecord(value)) return null;
  if (value.saleKind === 'quick_service') return normalizeQuickServiceSale(id, value);
  if (value.saleKind === 'product' || value.saleKind == null) return normalizeProductSale(id, value);
  return null;
}

export function requireNormalizedSale(id: string, value: unknown, label = 'Đơn bán'): Sale {
  const sale = normalizeSale(id, value);
  if (!sale) throw new Error(`${label} có dữ liệu không hợp lệ.`);
  return sale;
}
