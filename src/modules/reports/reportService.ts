import { endAt, get, orderByChild, query, ref, startAt } from 'firebase/database';
import { db } from '../../firebase/client';
import {
  REFERENCE_CACHE_TTL_MS,
  readThroughReferenceCache,
} from '../../shared/data/referenceDataCache';
import type {
  AppUser,
  Customer,
  Debt,
  DebtPaymentEvent,
  Expense,
  Loan,
  LoanPaymentEvent,
  Product,
  Purchase,
  Sale,
  StockMovement,
  StockOut,
  Supplier,
} from '../../types/models';
import { requireNormalizedSale } from '../sales/saleNormalizer';
import {
  buildCustomerReportRows,
  buildSalesFinancialSummary,
} from './reportMetrics';
import {
  buildDebtAgingSummary,
  buildLoanSummary,
  type DebtAgingSummary,
  type LoanSummary,
} from '../debts/debtMetrics';

export {
  buildCustomerReportRows,
  buildSalesFinancialSummary,
  getProductSaleSnapshotCost,
  getQuickServiceEstimatedProfit,
  getSaleSnapshotCost,
} from './reportMetrics';
export type { CustomerReportRow } from './reportMetrics';

export type ReportPreset = 'today' | 'yesterday' | 'week' | 'month' | 'quarter' | 'year' | 'custom';

export interface ReportRange {
  from: number;
  to: number;
  label: string;
}

export interface ReportSummary {
  totalRevenue: number;
  productRevenue: number;
  productCostOfGoods: number;
  productActualGrossProfit: number;
  serviceRevenue: number;
  serviceEstimatedProfit: number;
  combinedProfitBeforeExpenses: number;
  expenseTotal: number;
  loanInterestExpense: number;
  loanPrincipalCashOutflow: number;
  combinedNetProfitEstimate: number;
  completedSales: number;
  purchaseTotal: number;
  stockOutValue: number;
  inventoryQuantity: number;
  inventoryValue: number;
  lowStockCount: number;
  outOfStockCount: number;
}

export interface InventoryReportRow {
  productId: string;
  sku: string;
  name: string;
  unit?: string;
  stockQuantity: number;
  minStock?: number;
  status: 'out' | 'low' | 'ok';
  currentUnitCost: number;
  currentInventoryValue: number;
  active: boolean;
}

export interface SupplierReportRow {
  supplierId: string;
  supplierName: string;
  purchaseCount: number;
  purchaseTotal: number;
}

export interface DebtFinanceReport {
  receivable: DebtAgingSummary;
  payable: DebtAgingSummary;
  loans: LoanSummary;
  debtPayments: DebtPaymentEvent[];
  loanPayments: LoanPaymentEvent[];
  receivableCollectedNet: number;
  payablePaidNet: number;
  loanPrincipalPaidNet: number;
  loanInterestPaidNet: number;
}

export interface LoadReportOptions {
  includeDebtFinance?: boolean;
  includeUserDirectory?: boolean;
  includeMovements?: boolean;
  includeSupplierDirectory?: boolean;
  currentUser?: Pick<AppUser, 'uid' | 'displayName'>;
}

export type ReportSale = Sale & {
  creatorName: string;
};

export interface ReportBundle {
  range: ReportRange;
  summary: ReportSummary;
  sales: ReportSale[];
  expenses: Expense[];
  purchases: Purchase[];
  stockOuts: StockOut[];
  movements: StockMovement[];
  inventory: InventoryReportRow[];
  customers: import('./reportMetrics').CustomerReportRow[];
  suppliers: SupplierReportRow[];
  debtFinance?: DebtFinanceReport;
  warnings: string[];
}

function requireDatabase() {
  if (!db) throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  return db;
}

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

function dateLabel(date: Date) {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short' }).format(date);
}

function rangeLabel(from: Date, to: Date) {
  return `${dateLabel(from)} – ${dateLabel(to)}`;
}

export function buildPresetRange(preset: Exclude<ReportPreset, 'custom'>, now = new Date()): ReportRange {
  const current = new Date(now);
  let from: Date;
  let to: Date;

  switch (preset) {
    case 'today':
      from = startOfDay(current);
      to = endOfDay(current);
      break;
    case 'yesterday': {
      const day = new Date(current);
      day.setDate(day.getDate() - 1);
      from = startOfDay(day);
      to = endOfDay(day);
      break;
    }
    case 'week': {
      const monday = new Date(current);
      monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
      from = startOfDay(monday);
      to = endOfDay(current);
      break;
    }
    case 'month':
      from = new Date(current.getFullYear(), current.getMonth(), 1);
      to = endOfDay(current);
      break;
    case 'quarter':
      from = new Date(current.getFullYear(), Math.floor(current.getMonth() / 3) * 3, 1);
      to = endOfDay(current);
      break;
    case 'year':
      from = new Date(current.getFullYear(), 0, 1);
      to = endOfDay(current);
      break;
  }

  return { from: from.getTime(), to: to.getTime(), label: rangeLabel(from, to) };
}

export function buildCustomRange(fromDate: string, toDate: string): ReportRange {
  if (!fromDate || !toDate) throw new Error('Vui lòng chọn đủ ngày bắt đầu và ngày kết thúc.');
  const from = new Date(`${fromDate}T00:00:00`);
  const to = new Date(`${toDate}T23:59:59.999`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    throw new Error('Khoảng ngày không hợp lệ.');
  }
  if (from.getTime() > to.getTime()) throw new Error('Ngày bắt đầu không được sau ngày kết thúc.');
  return { from: from.getTime(), to: to.getTime(), label: rangeLabel(from, to) };
}

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function money(value: unknown) {
  return Math.round(finite(value));
}

function inRange(value: unknown, range: ReportRange) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) && timestamp >= range.from && timestamp <= range.to;
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') return Object.values(value as Record<string, T>);
  return [];
}

async function readRecord<T>(path: string): Promise<Record<string, T>> {
  const snapshot = await get(ref(requireDatabase(), path));
  if (!snapshot.exists()) return {};
  const value = snapshot.val() as unknown;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, T>
    : {};
}

function readCachedRecord<T>(path: string, cacheKey: string, ttlMs: number) {
  return readThroughReferenceCache<Record<string, T>>(
    cacheKey,
    ttlMs,
    () => readRecord<T>(path),
  );
}

async function readRecordRange<T>(
  path: string,
  orderField: 'createdAt' | 'expenseDate',
  range: ReportRange,
): Promise<Record<string, T>> {
  const snapshot = await get(query(
    ref(requireDatabase(), path),
    orderByChild(orderField),
    startAt(range.from),
    endAt(range.to),
  ));
  if (!snapshot.exists()) return {};
  const value = snapshot.val() as unknown;
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, T>
    : {};
}

function normalizeSalesRecord(value: Record<string, unknown>, path: string): Sale[] {
  return Object.entries(value).map(([id, raw]) => requireNormalizedSale(id, raw, `${path}/${id}`));
}

const INVENTORY_STATUS_ORDER: Record<InventoryReportRow['status'], number> = {
  out: 0,
  low: 1,
  ok: 2,
};

function inventoryRows(products: Record<string, Product>): InventoryReportRow[] {
  return Object.entries(products)
    .map(([id, product]) => {
      const stockQuantity = finite(product.stockQuantity);
      const minStock = Number.isFinite(Number(product.minStock)) ? Number(product.minStock) : undefined;
      const currentUnitCost = Math.max(0, money(product.costPrice));
      const status: InventoryReportRow['status'] = stockQuantity <= 0
        ? 'out'
        : typeof minStock === 'number' && stockQuantity <= minStock
          ? 'low'
          : 'ok';

      return {
        productId: product.id || id,
        sku: product.sku || id,
        name: product.name || product.sku || id,
        ...(product.unit ? { unit: product.unit } : {}),
        stockQuantity,
        ...(typeof minStock === 'number' ? { minStock } : {}),
        status,
        currentUnitCost,
        currentInventoryValue: Math.round(stockQuantity * currentUnitCost),
        active: product.active !== false,
      };
    })
    .sort(
      (a, b) => INVENTORY_STATUS_ORDER[a.status] - INVENTORY_STATUS_ORDER[b.status]
        || a.name.localeCompare(b.name, 'vi'),
    );
}

function stockOutValue(record: StockOut) {
  return Math.round(
    asArray<StockOut['items'][number]>(record.items)
      .reduce((sum, item) => sum + finite(item.quantity) * finite(item.costPrice), 0),
  );
}

function supplierRows(purchases: Purchase[], directory: Record<string, Supplier>): SupplierReportRow[] {
  const map = new Map<string, SupplierReportRow>();
  for (const purchase of purchases) {
    const id = purchase.supplierId || '__none__';
    const current = map.get(id) ?? {
      supplierId: id,
      supplierName: purchase.supplierName || directory[id]?.name || (id === '__none__' ? 'Không gắn nhà cung cấp' : id),
      purchaseCount: 0,
      purchaseTotal: 0,
    };
    current.purchaseCount += 1;
    current.purchaseTotal += money(purchase.total);
    map.set(id, current);
  }
  return [...map.values()].sort(
    (a, b) => b.purchaseTotal - a.purchaseTotal || a.supplierName.localeCompare(b.supplierName, 'vi'),
  );
}

export async function loadReportMovements(range: ReportRange): Promise<StockMovement[]> {
  const raw = await readRecordRange<StockMovement>('stockMovements', 'createdAt', range);
  return Object.entries(raw)
    .map(([id, item]) => ({ ...item, id: item.id || id }))
    .filter((item) => inRange(item.createdAt, range))
    .sort((a, b) => b.createdAt - a.createdAt);
}

export async function loadReport(
  range: ReportRange,
  options: LoadReportOptions = {},
): Promise<ReportBundle> {
  const [
    salesRaw,
    quickServiceSalesRaw,
    expensesRaw,
    purchasesRaw,
    stockOutsRaw,
    movementsRaw,
    products,
    customers,
    suppliers,
    debtsRaw,
    debtPaymentsRaw,
    loansRaw,
    loanPaymentsRaw,
    users,
  ] = await Promise.all([
    readRecordRange<unknown>('sales', 'createdAt', range),
    readRecordRange<unknown>('quickServiceSales', 'createdAt', range),
    readRecordRange<Expense>('expenses', 'expenseDate', range),
    readRecordRange<Purchase>('purchases', 'createdAt', range),
    readRecordRange<StockOut>('stockOuts', 'createdAt', range),
    options.includeMovements === false
      ? Promise.resolve({} as Record<string, StockMovement>)
      : readRecordRange<StockMovement>('stockMovements', 'createdAt', range),
    readCachedRecord<Product>('products', 'products', REFERENCE_CACHE_TTL_MS.products),
    readCachedRecord<Customer>('customers', 'customers', REFERENCE_CACHE_TTL_MS.customers),
    options.includeSupplierDirectory === false
      ? Promise.resolve({} as Record<string, Supplier>)
      : readCachedRecord<Supplier>('suppliers', 'suppliers', REFERENCE_CACHE_TTL_MS.suppliers),
    options.includeDebtFinance ? readRecord<Debt>('debts') : Promise.resolve({} as Record<string, Debt>),
    options.includeDebtFinance ? readRecordRange<DebtPaymentEvent>('debtPayments', 'createdAt', range) : Promise.resolve({} as Record<string, DebtPaymentEvent>),
    options.includeDebtFinance ? readRecord<Loan>('loans') : Promise.resolve({} as Record<string, Loan>),
    options.includeDebtFinance ? readRecordRange<LoanPaymentEvent>('loanPayments', 'createdAt', range) : Promise.resolve({} as Record<string, LoanPaymentEvent>),
    options.includeUserDirectory
      ? options.currentUser?.uid
        ? readCachedRecord<AppUser>(
            'users',
            `users:${options.currentUser.uid}`,
            REFERENCE_CACHE_TTL_MS.users,
          )
        : readRecord<AppUser>('users')
      : Promise.resolve({} as Record<string, AppUser>),
  ]);

  const warnings: string[] = [];
  const sales: ReportSale[] = [
    ...normalizeSalesRecord(salesRaw, 'sales'),
    ...normalizeSalesRecord(quickServiceSalesRaw, 'quickServiceSales'),
  ]
    .filter((sale) => sale.status === 'completed' && inRange(sale.createdAt, range))
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((sale) => {
      const accountName = users[sale.createdBy]?.displayName?.trim();
      const currentUserName = options.currentUser?.uid === sale.createdBy
        ? options.currentUser.displayName.trim()
        : '';
      return {
        ...sale,
        creatorName: accountName || currentUserName || `UID: ${sale.createdBy.slice(0, 8)}…`,
      };
    });
  const expenses = Object.entries(expensesRaw)
    .map(([id, item]) => ({ ...item, id: item.id || id }))
    .filter((item) => item.status === 'completed' && inRange(item.expenseDate, range))
    .sort((a, b) => b.expenseDate - a.expenseDate);
  const purchases = Object.entries(purchasesRaw)
    .map(([id, item]) => ({ ...item, id: item.id || id, items: asArray<Purchase['items'][number]>(item.items) }))
    .filter((item) => item.status === 'completed' && inRange(item.createdAt, range))
    .sort((a, b) => b.createdAt - a.createdAt);
  const stockOuts = Object.entries(stockOutsRaw)
    .map(([id, item]) => ({ ...item, id: item.id || id, items: asArray<StockOut['items'][number]>(item.items) }))
    .filter((item) => item.status === 'completed' && inRange(item.createdAt, range))
    .sort((a, b) => b.createdAt - a.createdAt);
  const movements = Object.entries(movementsRaw)
    .map(([id, item]) => ({ ...item, id: item.id || id }))
    .filter((item) => inRange(item.createdAt, range))
    .sort((a, b) => b.createdAt - a.createdAt);

  const expenseTotal = expenses.reduce((sum, item) => sum + Math.max(0, money(item.amount)), 0);

  const debts = Object.entries(debtsRaw)
    .map(([id, item]) => ({ ...item, id: item.id || id } as Debt));
  const debtPayments = Object.entries(debtPaymentsRaw)
    .map(([id, item]) => ({ ...item, id: item.id || id }))
    .filter((item) => inRange(item.createdAt, range))
    .sort((a, b) => b.createdAt - a.createdAt);
  const loans = Object.entries(loansRaw)
    .map(([id, item]) => ({ ...item, id: item.id || id }));
  const loanPayments = Object.entries(loanPaymentsRaw)
    .map(([id, item]) => ({ ...item, id: item.id || id }))
    .filter((item) => inRange(item.createdAt, range))
    .sort((a, b) => b.createdAt - a.createdAt);

  const signedDebtPayment = (item: DebtPaymentEvent) =>
    (item.eventType === 'reversal' ? -1 : 1) * Math.max(0, money(item.amount));
  const signedLoanPrincipal = (item: LoanPaymentEvent) =>
    (item.eventType === 'reversal' ? -1 : 1) * Math.max(0, money(item.principalAmount));
  const signedLoanInterest = (item: LoanPaymentEvent) =>
    (item.eventType === 'reversal' ? -1 : 1) * Math.max(0, money(item.interestAmount));

  const receivableCollectedNet = debtPayments
    .filter((item) => item.debtKind === 'receivable')
    .reduce((sum, item) => sum + signedDebtPayment(item), 0);
  const payablePaidNet = debtPayments
    .filter((item) => item.debtKind === 'payable')
    .reduce((sum, item) => sum + signedDebtPayment(item), 0);
  const loanPrincipalPaidNet = loanPayments.reduce((sum, item) => sum + signedLoanPrincipal(item), 0);
  const loanInterestPaidNet = loanPayments.reduce((sum, item) => sum + signedLoanInterest(item), 0);

  const financial = buildSalesFinancialSummary(
    sales,
    expenseTotal,
    warnings,
    Math.max(0, loanInterestPaidNet),
  );
  const inventory = inventoryRows(products);
  const activeInventory = inventory.filter((item) => item.active);

  return {
    range,
    summary: {
      ...financial,
      purchaseTotal: purchases.reduce((sum, item) => sum + money(item.total), 0),
      stockOutValue: stockOuts.reduce((sum, item) => sum + stockOutValue(item), 0),
      inventoryQuantity: activeInventory.reduce((sum, item) => sum + item.stockQuantity, 0),
      inventoryValue: activeInventory.reduce((sum, item) => sum + item.currentInventoryValue, 0),
      lowStockCount: activeInventory.filter((item) => item.status === 'low').length,
      outOfStockCount: activeInventory.filter((item) => item.status === 'out').length,
      loanPrincipalCashOutflow: Math.max(0, loanPrincipalPaidNet),
    },
    sales,
    expenses,
    purchases,
    stockOuts,
    movements,
    inventory,
    customers: buildCustomerReportRows(sales, customers, warnings),
    suppliers: supplierRows(purchases, suppliers),
    ...(options.includeDebtFinance ? {
      debtFinance: {
        receivable: buildDebtAgingSummary(debts, 'receivable'),
        payable: buildDebtAgingSummary(debts, 'payable'),
        loans: buildLoanSummary(loans),
        debtPayments,
        loanPayments,
        receivableCollectedNet,
        payablePaidNet,
        loanPrincipalPaidNet,
        loanInterestPaidNet,
      },
    } : {}),
    warnings: [...new Set(warnings)],
  };
}
