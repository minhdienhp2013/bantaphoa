import type { AppUser, Product, Stocktake, StocktakeItem } from '../../types/models';

export type StocktakeStatusFilter = 'all' | Stocktake['status'];

export interface StocktakeFilterState {
  query: string;
  status: StocktakeStatusFilter;
  fromDate: string;
  toDate: string;
}

export interface StocktakeTotals {
  itemCount: number;
  systemQuantity: number;
  actualQuantity: number;
  difference: number;
  matchedCount: number;
  shortageCount: number;
  surplusCount: number;
}

export interface StocktakeDetailRow {
  productId: string;
  sku: string;
  name: string;
  unit: string;
  systemQuantity: number;
  actualQuantity: number;
  difference: number;
  result: 'Khớp' | 'Thiếu' | 'Thừa';
  productMissing: boolean;
}

export interface StocktakeActionCapabilities {
  view: boolean;
  edit: boolean;
  continueScan: boolean;
  exportExcel: boolean;
  complete: boolean;
  cancel: boolean;
}

function finite(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function roundQuantity(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function getStocktakeStatusLabel(status: Stocktake['status']) {
  if (status === 'draft') return 'Nháp';
  if (status === 'completed') return 'Đã chốt';
  return 'Đã hủy';
}

export function getDifferenceResult(difference: number): 'Khớp' | 'Thiếu' | 'Thừa' {
  if (difference > 0) return 'Thừa';
  if (difference < 0) return 'Thiếu';
  return 'Khớp';
}

export function getStocktakeTotals(stocktake: Pick<Stocktake, 'items'>): StocktakeTotals {
  const items = Array.isArray(stocktake.items) ? stocktake.items : [];
  return {
    itemCount: items.length,
    systemQuantity: roundQuantity(items.reduce((sum, item) => sum + finite(item.systemQuantity), 0)),
    actualQuantity: roundQuantity(items.reduce((sum, item) => sum + finite(item.actualQuantity), 0)),
    difference: roundQuantity(items.reduce((sum, item) => sum + finite(item.difference), 0)),
    matchedCount: items.filter((item) => finite(item.difference) === 0).length,
    shortageCount: items.filter((item) => finite(item.difference) < 0).length,
    surplusCount: items.filter((item) => finite(item.difference) > 0).length,
  };
}

export function buildStocktakeDetailRows(
  stocktake: Pick<Stocktake, 'items'>,
  products: readonly Product[],
): StocktakeDetailRow[] {
  const productById = new Map(products.map((product) => [product.id, product]));
  const items = Array.isArray(stocktake.items) ? stocktake.items : [];

  return items.map((item: StocktakeItem) => {
    const product = productById.get(item.productId);
    const difference = finite(item.difference);
    return {
      productId: item.productId,
      sku: product?.sku || item.productId,
      name: product?.name || 'Sản phẩm không còn trong danh mục',
      unit: product?.unit || '—',
      systemQuantity: finite(item.systemQuantity),
      actualQuantity: finite(item.actualQuantity),
      difference,
      result: getDifferenceResult(difference),
      productMissing: !product,
    };
  });
}

export function getStocktakeActionCapabilities(status: Stocktake['status']): StocktakeActionCapabilities {
  const isDraft = status === 'draft';
  return {
    view: true,
    edit: isDraft,
    continueScan: isDraft,
    exportExcel: true,
    complete: isDraft,
    cancel: isDraft,
  };
}

function parseLocalDateParts(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) return null;
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

export function filterStocktakes(
  stocktakes: readonly Stocktake[],
  filters: StocktakeFilterState,
): Stocktake[] {
  const needle = filters.query.trim().toLocaleLowerCase('vi');
  const from = getLocalDayBoundary(filters.fromDate, 'start');
  const to = getLocalDayBoundary(filters.toDate, 'end');

  if (from !== null && to !== null && from > to) return [];

  return stocktakes.filter((stocktake) => {
    if (filters.status !== 'all' && stocktake.status !== filters.status) return false;
    if (from !== null && stocktake.createdAt < from) return false;
    if (to !== null && stocktake.createdAt > to) return false;
    if (!needle) return true;
    return [stocktake.code, stocktake.note || '']
      .some((value) => value.toLocaleLowerCase('vi').includes(needle));
  });
}

export function resolveCreatorDisplay(createdBy: string, appUser: AppUser | null | undefined) {
  if (appUser && createdBy === appUser.uid) return appUser.displayName || 'Người dùng';
  if (!createdBy) return 'Người dùng';
  if (createdBy.length <= 12) return `Người dùng (${createdBy})`;
  return `Người dùng (${createdBy.slice(0, 6)}…${createdBy.slice(-4)})`;
}
