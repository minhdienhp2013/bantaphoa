import type { Sale } from '../../types/models';
import { normalizeSale } from '../sales/saleNormalizer';

export type BackupInputSchemaVersion = 1 | 2 | 3;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function normalizeBackupSales(
  value: unknown,
  schemaVersion: BackupInputSchemaVersion,
): Record<string, Sale> {
  if (!isPlainRecord(value))
    throw new Error('sales phải là object theo key Firebase.');
  const sales: Record<string, Sale> = {};

  for (const [id, raw] of Object.entries(value)) {
    if (!isPlainRecord(raw)) throw new Error(`sales/${id} không hợp lệ.`);
    if (
      schemaVersion >= 2 &&
      !Object.prototype.hasOwnProperty.call(raw, 'saleKind')
    ) {
      throw new Error(
        `sales/${id} trong backup v${schemaVersion} thiếu saleKind.`,
      );
    }

    const sale = normalizeSale(id, raw);
    if (!sale) throw new Error(`sales/${id} không khớp canonical Sale schema.`);
    if (schemaVersion === 1 && sale.saleKind !== 'product') {
      throw new Error(
        `sales/${id} trong backup v1 phải là legacy Product Sale hợp lệ.`,
      );
    }
    sales[id] = sale;
  }

  return sales;
}
