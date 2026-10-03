import type { AppUser, Purchase, PurchaseItem, Supplier } from '../../types/models';

export type PurchaseStatusFilter = 'all' | Purchase['status'];
export type PurchaseSourceLoadState = 'pending' | 'ready' | 'error';

export interface PurchaseDataLoadState {
  purchases: PurchaseSourceLoadState;
  products: PurchaseSourceLoadState;
  suppliers: PurchaseSourceLoadState;
}

export interface PurchaseFilterState {
  query: string;
  status: PurchaseStatusFilter;
  supplierId: string;
  fromDate: string;
  toDate: string;
  onlyMine: boolean;
  currentUserId?: string;
}

export interface PurchaseTotals {
  itemCount: number;
  totalQuantity: number;
  total: number;
}

export interface PurchaseActionCapabilities {
  view: boolean;
  exportExcel: boolean;
  print: boolean;
  copy: boolean;
  cancel: boolean;
}

export interface PurchasePagination<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalPages: number;
  totalRows: number;
}

function finite(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundQuantity(value: number) {
  return Math.round(value * 1000) / 1000;
}

function normalize(value: string) {
  return value.trim().toLocaleLowerCase('vi');
}

function getItems(purchase: Pick<Purchase, 'items'>): PurchaseItem[] {
  return Array.isArray(purchase.items) ? purchase.items : [];
}

export function isPurchaseDataLoading(state: PurchaseDataLoadState) {
  return state.purchases === 'pending' || state.products === 'pending' || state.suppliers === 'pending';
}

export function getPurchaseStatusLabel(status: Purchase['status']) {
  return status === 'completed' ? 'Đã nhập hàng' : 'Đã hủy';
}

export function buildPurchaseDetailRows(purchase: Pick<Purchase, 'items'>): PurchaseItem[] {
  return getItems(purchase).map((item) => ({
    productId: item.productId,
    sku: item.sku,
    name: item.name,
    quantity: finite(item.quantity),
    unitCost: Math.round(finite(item.unitCost)),
    lineTotal: Math.round(finite(item.lineTotal)),
  }));
}

export function getPurchaseTotals(purchase: Pick<Purchase, 'items' | 'total'>): PurchaseTotals {
  const items = getItems(purchase);
  return {
    itemCount: items.length,
    totalQuantity: roundQuantity(items.reduce((sum, item) => sum + finite(item.quantity), 0)),
    total: Math.round(finite(purchase.total)),
  };
}

export function getPurchaseActionCapabilities(status: Purchase['status']): PurchaseActionCapabilities {
  const completed = status === 'completed';
  return {
    view: true,
    exportExcel: true,
    print: completed,
    copy: true,
    cancel: completed,
  };
}

function parseLocalDateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { year, month, day };
}

export function getLocalDayBoundary(value: string, boundary: 'start' | 'end'): number | null {
  if (!value) return null;
  const parts = parseLocalDateParts(value);
  if (!parts) return null;
  const { year, month, day } = parts;
  return boundary === 'start'
    ? new Date(year, month - 1, day, 0, 0, 0, 0).getTime()
    : new Date(year, month - 1, day, 23, 59, 59, 999).getTime();
}

export function resolveSupplierCode(purchase: Pick<Purchase, 'supplierId'>, suppliers: readonly Supplier[]) {
  if (!purchase.supplierId) return '—';
  return suppliers.find((supplier) => supplier.id === purchase.supplierId)?.code || '—';
}

export function filterPurchases(
  purchases: readonly Purchase[],
  suppliers: readonly Supplier[],
  filters: PurchaseFilterState,
): Purchase[] {
  const needle = normalize(filters.query);
  const from = getLocalDayBoundary(filters.fromDate, 'start');
  const to = getLocalDayBoundary(filters.toDate, 'end');
  if (from !== null && to !== null && from > to) return [];

  const supplierCodeById = new Map(suppliers.map((supplier) => [supplier.id, supplier.code]));

  return purchases.filter((purchase) => {
    if (filters.status !== 'all' && purchase.status !== filters.status) return false;
    if (filters.supplierId && purchase.supplierId !== filters.supplierId) return false;
    if (filters.onlyMine && (!filters.currentUserId || purchase.createdBy !== filters.currentUserId)) return false;
    if (from !== null && purchase.createdAt < from) return false;
    if (to !== null && purchase.createdAt > to) return false;
    if (!needle) return true;

    const supplierCode = purchase.supplierId ? supplierCodeById.get(purchase.supplierId) || '' : '';
    return [purchase.code, purchase.supplierName || '', purchase.note || '', supplierCode]
      .some((value) => normalize(value).includes(needle));
  }).sort((left, right) => Number(left.status === 'cancelled') - Number(right.status === 'cancelled'));
}

export function paginatePurchases<T>(rows: readonly T[], requestedPage: number, pageSize: number): PurchasePagination<T> {
  const safePageSize = [5, 10, 20].includes(pageSize) ? pageSize : 10;
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / safePageSize));
  const page = Math.min(Math.max(1, Math.floor(requestedPage) || 1), totalPages);
  const start = (page - 1) * safePageSize;
  return {
    items: rows.slice(start, start + safePageSize),
    page,
    pageSize: safePageSize,
    totalPages,
    totalRows,
  };
}

export function resolveCreatorDisplay(createdBy: string, appUser: AppUser | null | undefined) {
  if (appUser && createdBy === appUser.uid) return appUser.displayName || 'Người dùng';
  if (!createdBy) return 'Người dùng';
  if (createdBy.length <= 12) return `Người dùng (${createdBy})`;
  return `Người dùng (${createdBy.slice(0, 6)}…${createdBy.slice(-4)})`;
}

export function buildPrintingInitialQuantities(purchase: Pick<Purchase, 'items'>): Record<string, number> {
  return Object.fromEntries(getItems(purchase).map((item) => [item.productId, item.quantity]));
}
