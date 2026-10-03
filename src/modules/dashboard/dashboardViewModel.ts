import type { Product, Purchase, QuickServiceCategory, Sale, StockOut, UserRole } from '../../types/models';
import type { ReportRange, ReportSummary } from '../reports/reportService';

const QUICK_SERVICE_LABELS: Record<QuickServiceCategory, string> = {
  photo: 'Photo',
  printing: 'In ấn',
  scan: 'Scan',
  computer: 'Vi tính',
  stationery: 'Văn phòng phẩm',
  other: 'Khác',
};

export type DashboardPreset = 'today' | 'last7' | 'month' | 'quarter' | 'year';

export interface DashboardInventoryItem {
  productId: string;
  sku: string;
  name: string;
  unit?: string;
  stockQuantity: number;
  minStock?: number;
  active: boolean;
}

export type DashboardStockStatus = 'inactive' | 'out' | 'low' | 'ok';

export interface DashboardInventorySummary {
  active: number;
  ok: number;
  low: number;
  out: number;
}

export interface DashboardTopProduct {
  productId: string;
  sku: string;
  name: string;
  quantity: number;
  revenue: number;
  orderCount: number;
}

export interface DashboardActivity {
  id: string;
  type: 'sale' | 'purchase' | 'stockout';
  title: string;
  detail: string;
  createdAt: number;
}

export interface DashboardChartPoint {
  key: string;
  label: string;
  shortLabel: string;
  from: number;
  to: number;
  value: number;
}

export interface DashboardComparison {
  kind: 'percent' | 'new' | 'none';
  label: string;
  value?: number;
  direction: 'up' | 'down' | 'flat';
}

export interface DashboardVisibility {
  financial: boolean;
  revenueChart: boolean;
  topCustomers: boolean;
  reportsAction: boolean;
  operational: boolean;
}

export interface DashboardQuickAction {
  to: string;
  label: string;
  description: string;
  ownerOnly?: boolean;
}

export interface DashboardOwnerMetrics {
  revenue: number;
  grossProfit: number;
  totalRevenue: number;
  productActualGrossProfit: number;
  serviceEstimatedProfit: number;
  combinedProfitEstimate: number;
  completedSales: number;
  expenseTotal: number;
  averageOrder: number;
  soldQuantity: number;
}

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function startOfDay(value: Date) {
  const next = new Date(value);
  next.setHours(0, 0, 0, 0);
  return next;
}

function formatRangeLabel(from: Date, to: Date) {
  const formatter = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const fromLabel = formatter.format(from);
  const toLabel = formatter.format(to);
  return fromLabel === toLabel ? fromLabel : `${fromLabel} – ${toLabel}`;
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function buildDashboardRange(preset: DashboardPreset, now = new Date()): ReportRange {
  const current = new Date(now);
  let from: Date;

  switch (preset) {
    case 'today':
      from = startOfDay(current);
      break;
    case 'last7': {
      const monday = startOfDay(current);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      from = monday;
      break;
    }
    case 'month':
      from = new Date(current.getFullYear(), current.getMonth(), 1);
      break;
    case 'quarter':
      from = new Date(current.getFullYear(), Math.floor(current.getMonth() / 3) * 3, 1);
      break;
    case 'year':
      from = new Date(current.getFullYear(), 0, 1);
      break;
  }

  return { from: from.getTime(), to: current.getTime(), label: formatRangeLabel(from, current) };
}

export function buildPreviousDashboardRange(preset: DashboardPreset, now = new Date()): ReportRange {
  const current = new Date(now);
  let from: Date;
  let to: Date;

  switch (preset) {
    case 'today': {
      const yesterday = addDays(current, -1);
      from = startOfDay(yesterday);
      to = new Date(yesterday);
      to.setHours(23, 59, 59, 999);
      break;
    }
    case 'last7': {
      const currentMonday = startOfDay(current);
      currentMonday.setDate(currentMonday.getDate() - ((currentMonday.getDay() + 6) % 7));
      from = addDays(currentMonday, -7);
      to = new Date(currentMonday.getTime() - 1);
      break;
    }
    case 'month': {
      from = new Date(current.getFullYear(), current.getMonth() - 1, 1);
      to = new Date(current.getFullYear(), current.getMonth(), 1);
      to = new Date(to.getTime() - 1);
      break;
    }
    case 'quarter': {
      const currentQuarterMonth = Math.floor(current.getMonth() / 3) * 3;
      from = new Date(current.getFullYear(), currentQuarterMonth - 3, 1);
      to = new Date(current.getFullYear(), currentQuarterMonth, 1);
      to = new Date(to.getTime() - 1);
      break;
    }
    case 'year': {
      const previousYear = current.getFullYear() - 1;
      from = new Date(previousYear, 0, 1);
      to = new Date(previousYear + 1, 0, 1);
      to = new Date(to.getTime() - 1);
      break;
    }
  }

  return { from: from.getTime(), to: to.getTime(), label: formatRangeLabel(from, to) };
}

export function getDashboardPreviousPeriodLabel(preset: DashboardPreset) {
  switch (preset) {
    case 'today': return 'hôm qua';
    case 'last7': return 'tuần trước';
    case 'month': return 'tháng trước';
    case 'quarter': return 'quý trước';
    case 'year': return 'năm trước';
  }
}

export function getDashboardComparison(currentValue: number, previousValue: number): DashboardComparison {
  const current = finite(currentValue);
  const previous = finite(previousValue);
  if (previous === 0 && current === 0) return { kind: 'none', label: '—', direction: 'flat' };
  if (previous === 0 && current > 0) return { kind: 'new', label: 'Mới', direction: 'up' };
  if (previous === 0) return { kind: 'none', label: '—', direction: 'flat' };
  const value = ((current - previous) / Math.abs(previous)) * 100;
  if (!Number.isFinite(value)) return { kind: 'none', label: '—', direction: 'flat' };
  const rounded = Math.round(value * 10) / 10;
  return {
    kind: 'percent',
    value: rounded,
    label: `${rounded > 0 ? '+' : ''}${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(rounded)}%`,
    direction: rounded > 0 ? 'up' : rounded < 0 ? 'down' : 'flat',
  };
}

export function getDashboardStockStatus(product: DashboardInventoryItem | Product): DashboardStockStatus {
  if (product.active !== true) return 'inactive';
  const stock = finite(product.stockQuantity);
  if (stock <= 0) return 'out';
  if (stock === 1) return 'low';
  return 'ok';
}

export function buildInventorySummary(products: DashboardInventoryItem[]): DashboardInventorySummary {
  const summary: DashboardInventorySummary = { active: 0, ok: 0, low: 0, out: 0 };
  for (const product of products) {
    const status = getDashboardStockStatus(product);
    if (status === 'inactive') continue;
    summary.active += 1;
    summary[status] += 1;
  }
  return summary;
}

export function getStockWarnings(products: DashboardInventoryItem[]) {
  const low = products.filter((product) => getDashboardStockStatus(product) === 'low');
  const out = products.filter((product) => getDashboardStockStatus(product) === 'out');
  return { low, out };
}

export function getSoldQuantity(sales: Sale[]) {
  return sales.reduce((sum, sale) => {
    if (sale.saleKind !== 'product' || sale.status !== 'completed') return sum;
    return sum + sale.items.reduce((itemSum, item) => itemSum + Math.max(0, finite(item.quantity)), 0);
  }, 0);
}

export function buildTopProducts(sales: Sale[], limit = 10): DashboardTopProduct[] {
  const grouped = new Map<string, DashboardTopProduct & { latestAt: number }>();
  const seenOrders = new Map<string, Set<string>>();
  for (const sale of sales) {
    if (sale.saleKind !== 'product' || sale.status !== 'completed') continue;
    for (const item of sale.items) {
      if (!item.productId) continue;
      const current = grouped.get(item.productId) ?? {
        productId: item.productId,
        sku: item.sku || item.productId,
        name: item.name || item.sku || item.productId,
        quantity: 0,
        revenue: 0,
        orderCount: 0,
        latestAt: -Infinity,
      };
      current.quantity += Math.max(0, finite(item.quantity));
      current.revenue += Math.max(0, finite(item.lineTotal, finite(item.quantity) * finite(item.unitPrice)));
      if (finite(sale.createdAt) >= current.latestAt) {
        current.latestAt = finite(sale.createdAt);
        current.sku = item.sku || current.sku;
        current.name = item.name || current.name;
      }
      const orders = seenOrders.get(item.productId) ?? new Set<string>();
      if (!orders.has(sale.id)) {
        orders.add(sale.id);
        current.orderCount += 1;
      }
      seenOrders.set(item.productId, orders);
      grouped.set(item.productId, current);
    }
  }
  return [...grouped.values()]
    .sort((a, b) => b.quantity - a.quantity || b.revenue - a.revenue || a.name.localeCompare(b.name, 'vi'))
    .slice(0, Math.max(0, limit))
    .map(({ latestAt: _latestAt, ...item }) => item);
}

export function buildRecentActivity(sales: Sale[], purchases: Purchase[], stockOuts: StockOut[], limit = 8): DashboardActivity[] {
  const activities: DashboardActivity[] = [];
  for (const sale of sales) {
    if (sale.status !== 'completed') continue;
    if (sale.saleKind === 'quick_service') {
      activities.push({
        id: `sale:${sale.id}`,
        type: 'sale',
        title: `Dịch vụ ${sale.code}`,
        detail: `${QUICK_SERVICE_LABELS[sale.serviceCategory]} · ${sale.customerName ? `Khách: ${sale.customerName}` : 'Khách lẻ'}`,
        createdAt: finite(sale.createdAt),
      });
    } else {
      activities.push({
        id: `sale:${sale.id}`,
        type: 'sale',
        title: `Bán hàng ${sale.code}`,
        detail: sale.customerName ? `Khách: ${sale.customerName}` : 'Khách lẻ',
        createdAt: finite(sale.createdAt),
      });
    }
  }
  for (const purchase of purchases) {
    if (purchase.status !== 'completed') continue;
    activities.push({ id: `purchase:${purchase.id}`, type: 'purchase', title: `Nhập hàng ${purchase.code}`, detail: purchase.supplierName ? `NCC: ${purchase.supplierName}` : `${purchase.items.length} mặt hàng`, createdAt: finite(purchase.createdAt) });
  }
  for (const stockOut of stockOuts) {
    if (stockOut.status !== 'completed') continue;
    activities.push({ id: `stockout:${stockOut.id}`, type: 'stockout', title: `Xuất kho ${stockOut.code}`, detail: `${stockOut.items.length} mặt hàng · ${stockOut.reason}`, createdAt: finite(stockOut.createdAt) });
  }
  return activities.filter((item) => Number.isFinite(item.createdAt) && item.createdAt > 0).sort((a, b) => b.createdAt - a.createdAt).slice(0, Math.max(0, limit));
}

function startOfHour(value: Date) {
  const next = new Date(value);
  next.setMinutes(0, 0, 0);
  return next;
}
function endOfBucket(nextStart: Date, rangeTo: number) { return Math.min(nextStart.getTime() - 1, rangeTo); }
function makePoint(key: string, label: string, shortLabel: string, from: Date, nextStart: Date, rangeTo: number): DashboardChartPoint {
  return { key, label, shortLabel, from: from.getTime(), to: endOfBucket(nextStart, rangeTo), value: 0 };
}

function buildEmptyChartPoints(preset: DashboardPreset, range: ReportRange): DashboardChartPoint[] {
  const points: DashboardChartPoint[] = [];
  const from = new Date(range.from);
  const dayFormatter = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit' });
  const monthFormatter = new Intl.DateTimeFormat('vi-VN', { month: 'short' });
  if (preset === 'today') {
    let cursor = startOfHour(from);
    while (cursor.getTime() <= range.to) {
      const next = new Date(cursor); next.setHours(next.getHours() + 1);
      const hour = cursor.getHours();
      points.push(makePoint(`hour-${hour}`, `${String(hour).padStart(2, '0')}:00`, String(hour), cursor, next, range.to));
      cursor = next;
    }
    return points;
  }
  if (preset === 'last7' || preset === 'month') {
    let cursor = startOfDay(from);
    while (cursor.getTime() <= range.to) {
      const next = new Date(cursor); next.setDate(next.getDate() + 1);
      points.push(makePoint(`day-${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`, dayFormatter.format(cursor), preset === 'last7' ? new Intl.DateTimeFormat('vi-VN', { weekday: 'short' }).format(cursor) : String(cursor.getDate()), cursor, next, range.to));
      cursor = next;
    }
    return points;
  }
  if (preset === 'quarter') {
    let cursor = startOfDay(from); let index = 1;
    while (cursor.getTime() <= range.to) {
      const next = new Date(cursor); next.setDate(next.getDate() + 7);
      const lastVisible = new Date(Math.min(next.getTime() - 1, range.to));
      points.push(makePoint(`week-${index}`, `${dayFormatter.format(cursor)} – ${dayFormatter.format(lastVisible)}`, `T${index}`, cursor, next, range.to));
      cursor = next; index += 1;
    }
    return points;
  }
  let cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cursor.getTime() <= range.to) {
    const next = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    points.push(makePoint(`month-${cursor.getFullYear()}-${cursor.getMonth()}`, monthFormatter.format(cursor), `T${cursor.getMonth() + 1}`, cursor, next, range.to));
    cursor = next;
  }
  return points;
}

export function buildRevenueChart(sales: Sale[], preset: DashboardPreset, range: ReportRange): DashboardChartPoint[] {
  const points = buildEmptyChartPoints(preset, range);
  for (const sale of sales) {
    if (sale.status !== 'completed') continue;
    const timestamp = finite(sale.createdAt, -1);
    if (timestamp < range.from || timestamp > range.to) continue;
    const point = points.find((item) => timestamp >= item.from && timestamp <= item.to);
    if (point) point.value += Math.max(0, Math.round(finite(sale.total)));
  }
  return points;
}

export function getOwnerMetrics(summary: ReportSummary, sales: Sale[]): DashboardOwnerMetrics {
  const completedSales = Math.max(0, Math.round(finite(summary.completedSales)));
  const totalRevenue = Math.round(finite(summary.totalRevenue));
  const productActualGrossProfit = Math.round(finite(summary.productActualGrossProfit));
  const serviceEstimatedProfit = Math.round(finite(summary.serviceEstimatedProfit));
  const combinedProfitEstimate = Math.round(finite(summary.combinedProfitBeforeExpenses));
  return {
    revenue: totalRevenue,
    grossProfit: productActualGrossProfit,
    totalRevenue,
    productActualGrossProfit,
    serviceEstimatedProfit,
    combinedProfitEstimate,
    completedSales,
    expenseTotal: Math.round(finite(summary.expenseTotal)),
    averageOrder: completedSales > 0 ? Math.round(totalRevenue / completedSales) : 0,
    soldQuantity: getSoldQuantity(sales),
  };
}

export function getDashboardVisibility(role: UserRole): DashboardVisibility {
  const owner = role === 'owner';
  return { financial: owner, revenueChart: owner, topCustomers: owner, reportsAction: owner, operational: true };
}

const QUICK_ACTIONS: DashboardQuickAction[] = [
  { to: '/sales', label: 'Bán hàng', description: 'Mở POS và tạo đơn bán.' },
  { to: '/purchases', label: 'Nhập hàng', description: 'Tạo phiếu nhập kho.' },
  { to: '/stockouts', label: 'Xuất hàng', description: 'Xuất nội bộ, hỏng hoặc biếu tặng.' },
  { to: '/stocktakes', label: 'Kiểm kê', description: 'Đối chiếu tồn thực tế.' },
  { to: '/qr-printing', label: 'In tem / QR', description: 'Tạo mã và in tem sản phẩm.' },
  { to: '/reports', label: 'Báo cáo', description: 'Xem báo cáo và backup.', ownerOnly: true },
];
export function getDashboardQuickActions(role: UserRole) { return QUICK_ACTIONS.filter((action) => !action.ownerOnly || role === 'owner'); }
