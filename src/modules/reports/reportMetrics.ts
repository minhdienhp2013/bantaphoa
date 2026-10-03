import type { Customer, ProductSale, QuickServiceSale, Sale } from '../../types/models';

export interface SalesFinancialSummary {
  totalRevenue: number;
  productRevenue: number;
  productCostOfGoods: number;
  productActualGrossProfit: number;
  serviceRevenue: number;
  serviceEstimatedProfit: number;
  combinedProfitBeforeExpenses: number;
  expenseTotal: number;
  loanInterestExpense: number;
  combinedNetProfitEstimate: number;
  completedSales: number;
}

export interface CustomerReportRow {
  customerId: string;
  customerName: string;
  orderCount: number;
  totalRevenue: number;
  productRevenue: number;
  serviceRevenue: number;
  productCostOfGoods: number;
  productActualGrossProfit: number;
  serviceEstimatedProfit: number;
  combinedProfitEstimate: number;
}

function finite(value: unknown, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function money(value: unknown) {
  return Math.round(finite(value));
}

export function getProductSaleSnapshotCost(sale: ProductSale, warnings: string[] = []) {
  const costTotal = Number(sale.costTotal);
  if (Number.isFinite(costTotal) && costTotal >= 0) return Math.round(costTotal);

  if (
    sale.items.length > 0
    && sale.items.every((item) => Number.isFinite(Number(item.quantity)) && Number.isFinite(Number(item.costPrice)))
  ) {
    warnings.push(`Đơn ${sale.code || sale.id} thiếu costTotal; dùng SaleItem.costPrice snapshot.`);
    return Math.round(
      sale.items.reduce((sum, item) => sum + finite(item.quantity) * finite(item.costPrice), 0),
    );
  }

  warnings.push(`Đơn ${sale.code || sale.id} thiếu snapshot giá vốn; tính 0 thay vì lấy Product.costPrice hiện tại.`);
  return 0;
}

// Compatibility export for older report call sites. The type remains ProductSale-only.
export const getSaleSnapshotCost = getProductSaleSnapshotCost;

export function getQuickServiceEstimatedProfit(sale: QuickServiceSale) {
  return Math.round(sale.total * sale.estimatedProfitRatePercent / 100);
}

export function buildSalesFinancialSummary(
  sales: Sale[],
  expenseTotalInput = 0,
  warnings: string[] = [],
  loanInterestExpenseInput = 0,
): SalesFinancialSummary {
  let productRevenue = 0;
  let productCostOfGoods = 0;
  let serviceRevenue = 0;
  let serviceEstimatedProfit = 0;
  let completedSales = 0;

  for (const sale of sales) {
    if (sale.status !== 'completed') continue;
    completedSales += 1;

    if (sale.saleKind === 'product') {
      productRevenue += money(sale.total);
      productCostOfGoods += getProductSaleSnapshotCost(sale, warnings);
      continue;
    }

    serviceRevenue += money(sale.total);
    serviceEstimatedProfit += getQuickServiceEstimatedProfit(sale);
  }

  const totalRevenue = productRevenue + serviceRevenue;
  const productActualGrossProfit = productRevenue - productCostOfGoods;
  const combinedProfitBeforeExpenses = productActualGrossProfit + serviceEstimatedProfit;
  const expenseTotal = Math.max(0, money(expenseTotalInput));
  const loanInterestExpense = Math.max(0, money(loanInterestExpenseInput));

  return {
    totalRevenue,
    productRevenue,
    productCostOfGoods,
    productActualGrossProfit,
    serviceRevenue,
    serviceEstimatedProfit,
    combinedProfitBeforeExpenses,
    expenseTotal,
    loanInterestExpense,
    combinedNetProfitEstimate: combinedProfitBeforeExpenses - expenseTotal - loanInterestExpense,
    completedSales,
  };
}

export function buildCustomerReportRows(
  sales: Sale[],
  directory: Record<string, Customer>,
  warnings: string[] = [],
): CustomerReportRow[] {
  const rows = new Map<string, CustomerReportRow>();

  for (const sale of sales) {
    if (sale.status !== 'completed') continue;

    const customerId = sale.customerId || '__walk_in__';
    const current = rows.get(customerId) ?? {
      customerId,
      customerName: sale.customerName || directory[customerId]?.name || (customerId === '__walk_in__' ? 'Khách lẻ' : customerId),
      orderCount: 0,
      totalRevenue: 0,
      productRevenue: 0,
      serviceRevenue: 0,
      productCostOfGoods: 0,
      productActualGrossProfit: 0,
      serviceEstimatedProfit: 0,
      combinedProfitEstimate: 0,
    };

    current.orderCount += 1;
    current.totalRevenue += money(sale.total);

    if (sale.saleKind === 'product') {
      const productCost = getProductSaleSnapshotCost(sale, warnings);
      current.productRevenue += money(sale.total);
      current.productCostOfGoods += productCost;
      current.productActualGrossProfit = current.productRevenue - current.productCostOfGoods;
    } else {
      current.serviceRevenue += money(sale.total);
      current.serviceEstimatedProfit += getQuickServiceEstimatedProfit(sale);
    }

    current.combinedProfitEstimate = current.productActualGrossProfit + current.serviceEstimatedProfit;
    rows.set(customerId, current);
  }

  return [...rows.values()].sort(
    (a, b) => b.totalRevenue - a.totalRevenue || a.customerName.localeCompare(b.customerName, 'vi'),
  );
}
