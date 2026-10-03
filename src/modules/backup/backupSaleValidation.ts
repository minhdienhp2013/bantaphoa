import type { ProductSale, QuickServiceSale, Sale } from '../../types/models';
import { normalizeSale } from '../sales/saleNormalizer';

export type BackupInputSchemaVersion = 1 | 2 | 3;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeBackupSales(
  value: unknown,
  schemaVersion: BackupInputSchemaVersion,
): Record<string, Sale> {
  if (!isPlainRecord(value)) throw new Error('sales phải là object theo key Firebase.');
  const sales: Record<string, Sale> = {};

  for (const [id, raw] of Object.entries(value)) {
    if (!isPlainRecord(raw)) throw new Error(`sales/${id} không hợp lệ.`);
    if (schemaVersion >= 2 && !Object.prototype.hasOwnProperty.call(raw, 'saleKind')) {
      throw new Error(`sales/${id} trong backup v${schemaVersion} thiếu saleKind.`);
    }

    const sale = normalizeSale(id, raw);
    if (!sale) throw new Error(`sales/${id} không khớp canonical Sale schema.`);
    if (schemaVersion === 1 && sale.saleKind !== 'product') {
      throw new Error(`sales/${id} trong backup v1 phải là legacy Product Sale hợp lệ.`);
    }
    sales[id] = sale;
  }

  return sales;
}

export function normalizeBackupLedgers(
  salesValue: unknown,
  quickServiceSalesValue: unknown,
  schemaVersion: BackupInputSchemaVersion,
): {
  sales: Record<string, ProductSale>;
  quickServiceSales: Record<string, QuickServiceSale>;
} {
  const productSales: Record<string, ProductSale> = {};
  const quickServiceSales: Record<string, QuickServiceSale> = {};

  const legacyOrCurrentSales = normalizeBackupSales(salesValue, schemaVersion);
  for (const [id, sale] of Object.entries(legacyOrCurrentSales)) {
    if (schemaVersion === 3 && sale.saleKind !== 'product') {
      throw new Error(`sales/${id} trong backup v3 chỉ được chứa Product Sale.`);
    }
    if (sale.saleKind === 'product') productSales[id] = sale;
    else quickServiceSales[id] = sale;
  }

  if (schemaVersion < 3) {
    if (quickServiceSalesValue != null && isPlainRecord(quickServiceSalesValue) && Object.keys(quickServiceSalesValue).length > 0) {
      throw new Error(`backup v${schemaVersion} không hỗ trợ quickServiceSales riêng.`);
    }
    return { sales: productSales, quickServiceSales };
  }

  if (!isPlainRecord(quickServiceSalesValue)) {
    throw new Error('quickServiceSales phải là object theo key Firebase.');
  }
  for (const [id, raw] of Object.entries(quickServiceSalesValue)) {
    if (!isPlainRecord(raw) || !Object.prototype.hasOwnProperty.call(raw, 'saleKind')) {
      throw new Error(`quickServiceSales/${id} trong backup v3 không hợp lệ.`);
    }
    const sale = normalizeSale(id, raw);
    if (!sale || sale.saleKind !== 'quick_service') {
      throw new Error(`quickServiceSales/${id} phải là Quick Service Sale hợp lệ.`);
    }
    if (quickServiceSales[id]) throw new Error(`Trùng id Quick Service Sale ${id}.`);
    quickServiceSales[id] = sale;
  }

  return { sales: productSales, quickServiceSales };
}
