import { endAt, get, orderByChild, query, ref, startAt } from 'firebase/database';
import { db } from '../../firebase/client';
import {
  REFERENCE_CACHE_TTL_MS,
  readThroughReferenceCache,
} from '../../shared/data/referenceDataCache';
import type { Debt, Expense, Loan, Product, Purchase, Sale, StockOut, UserRole } from '../../types/models';
import { buildSalesFinancialSummary, loadReport, type ReportBundle, type ReportRange } from '../reports/reportService';
import { normalizeSale } from '../sales/saleNormalizer';
import type { DashboardInventoryItem } from './dashboardViewModel';
import {
  buildDebtAgingSummary,
  buildLoanSummary,
  type DebtAgingSummary,
  type LoanSummary,
} from '../debts/debtMetrics';

export interface DashboardOperationalBundle {
  sales: Sale[];
  purchases: Purchase[];
  stockOuts: StockOut[];
  inventory: DashboardInventoryItem[];
}

export interface DashboardOwnerDebtSnapshot {
  receivable: DebtAgingSummary;
  payable: DebtAgingSummary;
  loans: LoanSummary;
}

export interface DashboardOwnerBundle extends DashboardOperationalBundle {
  role: 'owner';
  currentReport: ReportBundle;
  previousReport: ReportBundle;
  debtSnapshot: DashboardOwnerDebtSnapshot;
}

export interface DashboardStaffBundle extends DashboardOperationalBundle {
  role: 'staff';
  debtSnapshot?: DashboardOwnerDebtSnapshot;
}

export type DashboardDataBundle = DashboardOwnerBundle | DashboardStaffBundle;

function requireDatabase() {
  if (!db) throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  return db;
}

function asArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (value && typeof value === 'object') return Object.values(value as Record<string, T>);
  return [];
}

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

async function readProducts(): Promise<Product[]> {
  const raw = await readThroughReferenceCache<Record<string, Product>>(
    'products',
    REFERENCE_CACHE_TTL_MS.products,
    async () => {
      const snapshot = await get(ref(requireDatabase(), 'products'));
      return snapshot.exists() ? snapshot.val() as Record<string, Product> : {};
    },
  );

  return Object.entries(raw).map(([id, product]) => ({
    ...product,
    id: product.id || id,
    stockQuantity: finite(product.stockQuantity),
    stockVersion: finite(product.stockVersion),
  }));
}

async function readRangeByChild<T extends { id: string }>(
  path: string,
  child: 'createdAt' | 'expenseDate',
  range: ReportRange,
): Promise<T[]> {
  const snapshot = await get(query(
    ref(requireDatabase(), path),
    orderByChild(child),
    startAt(range.from),
    endAt(range.to),
  ));
  if (!snapshot.exists()) return [];
  const raw = snapshot.val() as Record<string, T>;
  return Object.entries(raw).map(([id, item]) => ({ ...item, id: item.id || id }));
}

async function readCreatedRange<T extends { id: string; createdAt: number }>(path: string, range: ReportRange): Promise<T[]> {
  const rows = await readRangeByChild<T>(path, 'createdAt', range);
  return rows.sort((a, b) => finite(b.createdAt) - finite(a.createdAt));
}

async function readSaleLedger(path: 'sales' | 'quickServiceSales', range: ReportRange): Promise<Sale[]> {
  const snapshot = await get(query(
    ref(requireDatabase(), path),
    orderByChild('createdAt'),
    startAt(range.from),
    endAt(range.to),
  ));
  if (!snapshot.exists()) return [];

  const raw = snapshot.val() as Record<string, unknown>;
  return Object.entries(raw)
    .flatMap(([id, value]) => {
      const sale = normalizeSale(id, value);
      return sale ? [sale] : [];
    });
}

async function readSalesRange(range: ReportRange): Promise<Sale[]> {
  const [productSales, quickServiceSales] = await Promise.all([
    readSaleLedger('sales', range),
    readSaleLedger('quickServiceSales', range),
  ]);
  return [...productSales, ...quickServiceSales].sort((a, b) => finite(b.createdAt) - finite(a.createdAt));
}

function normalizePurchases(purchases: Purchase[]) {
  return purchases.map((purchase) => ({
    ...purchase,
    items: asArray<Purchase['items'][number]>(purchase.items),
  }));
}

function normalizeStockOuts(stockOuts: StockOut[]) {
  return stockOuts.map((stockOut) => ({
    ...stockOut,
    items: asArray<StockOut['items'][number]>(stockOut.items),
  }));
}

function inventoryFromProducts(products: Product[]): DashboardInventoryItem[] {
  return products.map((product) => ({
    productId: product.id,
    sku: product.sku || product.id,
    name: product.name || product.sku || product.id,
    ...(product.unit ? { unit: product.unit } : {}),
    stockQuantity: finite(product.stockQuantity),
    ...(typeof product.minStock === 'number' ? { minStock: product.minStock } : {}),
    active: product.active === true,
  }));
}

function inventoryFromReport(report: ReportBundle): DashboardInventoryItem[] {
  return report.inventory.map((item) => ({
    productId: item.productId,
    sku: item.sku,
    name: item.name,
    ...(item.unit ? { unit: item.unit } : {}),
    stockQuantity: finite(item.stockQuantity),
    ...(typeof item.minStock === 'number' ? { minStock: item.minStock } : {}),
    active: item.active === true,
  }));
}

async function loadStaffDashboard(
  range: ReportRange,
  includeDebtSnapshot: boolean,
): Promise<DashboardStaffBundle> {
  const [products, salesRaw, purchasesRaw, stockOutsRaw, debtSnapshot] = await Promise.all([
    readProducts(),
    readSalesRange(range),
    readCreatedRange<Purchase>('purchases', range),
    readCreatedRange<StockOut>('stockOuts', range),
    includeDebtSnapshot ? readDebtSnapshot() : Promise.resolve(undefined),
  ]);

  const sales = salesRaw
    .filter((sale) => sale.status === 'completed')
    .sort((a, b) => b.createdAt - a.createdAt);
  const purchases = normalizePurchases(purchasesRaw).filter((purchase) => purchase.status === 'completed');
  const stockOuts = normalizeStockOuts(stockOutsRaw).filter((stockOut) => stockOut.status === 'completed');

  return {
    role: 'staff',
    sales,
    purchases,
    stockOuts,
    inventory: inventoryFromProducts(products),
    ...(debtSnapshot ? { debtSnapshot } : {}),
  };
}

async function readDebtSnapshot(): Promise<DashboardOwnerDebtSnapshot> {
  const [debtSnapshot, loanSnapshot] = await Promise.all([
    get(ref(requireDatabase(), 'debts')),
    get(ref(requireDatabase(), 'loans')),
  ]);
  const debts = debtSnapshot.exists()
    ? Object.entries(debtSnapshot.val() as Record<string, Debt>).map(([id, debt]) => ({ ...debt, id: debt.id || id } as Debt))
    : [];
  const loans = loanSnapshot.exists()
    ? Object.entries(loanSnapshot.val() as Record<string, Loan>).map(([id, loan]) => ({ ...loan, id: loan.id || id }))
    : [];
  return {
    receivable: buildDebtAgingSummary(debts, 'receivable'),
    payable: buildDebtAgingSummary(debts, 'payable'),
    loans: buildLoanSummary(loans),
  };
}

async function loadDashboardComparisonReport(range: ReportRange): Promise<ReportBundle> {
  const [salesRaw, expensesRaw] = await Promise.all([
    readSalesRange(range),
    readRangeByChild<Expense>('expenses', 'expenseDate', range),
  ]);

  const sales = salesRaw
    .filter((sale) => sale.status === 'completed')
    .sort((a, b) => b.createdAt - a.createdAt);
  const expenses = expensesRaw
    .filter((expense) => expense.status === 'completed')
    .sort((a, b) => finite(b.expenseDate) - finite(a.expenseDate));
  const expenseTotal = expenses.reduce((sum, expense) => sum + Math.max(0, Math.round(finite(expense.amount))), 0);
  const warnings: string[] = [];
  const financial = buildSalesFinancialSummary(sales, expenseTotal, warnings);

  return {
    range,
    summary: {
      ...financial,
      purchaseTotal: 0,
      stockOutValue: 0,
      inventoryQuantity: 0,
      inventoryValue: 0,
      lowStockCount: 0,
      outOfStockCount: 0,
      loanPrincipalCashOutflow: 0,
    },
    sales: sales.map((sale) => ({ ...sale, creatorName: '' })),
    expenses,
    purchases: [],
    stockOuts: [],
    movements: [],
    inventory: [],
    customers: [],
    suppliers: [],
    warnings,
  };
}

async function loadOwnerDashboard(currentRange: ReportRange, previousRange: ReportRange): Promise<DashboardOwnerBundle> {
  const [currentReport, previousReport, debtSnapshot] = await Promise.all([
    loadReport(currentRange, {
      includeDebtFinance: false,
      includeMovements: false,
      includeSupplierDirectory: false,
    }),
    loadDashboardComparisonReport(previousRange),
    readDebtSnapshot(),
  ]);

  return {
    role: 'owner',
    currentReport,
    previousReport,
    debtSnapshot,
    sales: currentReport.sales,
    purchases: currentReport.purchases,
    stockOuts: currentReport.stockOuts,
    inventory: inventoryFromReport(currentReport),
  };
}

export function loadDashboardData(
  role: UserRole,
  currentRange: ReportRange,
  previousRange: ReportRange,
  includeDebtSnapshot = false,
): Promise<DashboardDataBundle> {
  return role === 'owner'
    ? loadOwnerDashboard(currentRange, previousRange)
    : loadStaffDashboard(currentRange, includeDebtSnapshot);
}
