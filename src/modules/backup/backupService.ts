import { get, ref } from 'firebase/database';
import * as XLSX from 'xlsx';
import { db } from '../../firebase/client';
import type {
  BackupEnvelope,
  Product,
  ProductSale,
  QuickServiceSale,
  StockOperationReceipt,
} from '../../types/models';
import { normalizeSale } from '../sales/saleNormalizer';
import { normalizeBackupLedgers, type BackupInputSchemaVersion } from './backupSaleValidation';

export const BACKUP_SCHEMA_VERSION = 3 as const;
export const SUPPORTED_BACKUP_SCHEMA_VERSIONS = [1, 2, 3] as const;
export type RestoreMode = 'merge' | 'replace';
type BackupData = BackupEnvelope['data'];
type BackupKey = keyof BackupData;
type RawBackupSchemaVersion = BackupInputSchemaVersion;

export const BACKUP_DATA_KEYS: BackupKey[] = [
  'products', 'categories', 'customers', 'suppliers', 'sales', 'quickServiceSales', 'purchases', 'debts', 'debtPayments', 'loans', 'loanPayments', 'stockOuts',
  'stockMovements', 'stockOperations', 'stocktakes', 'expenses', 'salesAiLearning', 'salesAiLearningComponents', 'salesAiLearningEvents', 'settings',
];

const COLLECTION_KEYS: Exclude<BackupKey, 'settings'>[] = [
  'products', 'categories', 'customers', 'suppliers', 'sales', 'quickServiceSales', 'purchases', 'debts', 'debtPayments', 'loans', 'loanPayments', 'stockOuts',
  'stockMovements', 'stockOperations', 'stocktakes', 'expenses', 'salesAiLearning', 'salesAiLearningComponents', 'salesAiLearningEvents',
];

export interface RestoreNodePreview {
  key: BackupKey;
  backupCount: number;
  currentCount: number;
  inserts: number;
  updates: number;
  deletes: number;
}

export interface RestorePreview {
  mode: RestoreMode;
  nodes: RestoreNodePreview[];
  blockers: string[];
  targetProjectId: string;
  targetDatabaseUrl: string;
}

function requireDatabase() {
  if (!db) throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  return db;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

async function readPath(path: string): Promise<unknown> {
  const snapshot = await get(ref(requireDatabase(), path));
  return snapshot.exists() ? snapshot.val() as unknown : null;
}

function normalizeProducts(value: unknown): Record<string, Product> {
  if (!isPlainRecord(value)) return {};
  const result: Record<string, Product> = {};
  for (const [id, raw] of Object.entries(value)) {
    if (!isPlainRecord(raw)) continue;
    const product = raw as unknown as Product;
    result[id] = {
      ...product,
      id: product.id || id,
      stockQuantity: Number(product.stockQuantity) || 0,
      stockVersion: Number.isFinite(Number(product.stockVersion)) ? Number(product.stockVersion) : 0,
    };
  }
  return result;
}

function normalizeCurrentLedgersForExport(
  salesValue: unknown,
  quickServiceSalesValue: unknown,
): { sales: Record<string, ProductSale>; quickServiceSales: Record<string, QuickServiceSale> } {
  const sales: Record<string, ProductSale> = {};
  const quickServiceSales: Record<string, QuickServiceSale> = {};

  if (salesValue != null && !isPlainRecord(salesValue)) throw new Error('sales hiện tại không hợp lệ để tạo backup.');
  for (const [id, raw] of Object.entries(isPlainRecord(salesValue) ? salesValue : {})) {
    const sale = normalizeSale(id, raw);
    if (!sale) throw new Error(`sales/${id} không hợp lệ; từ chối tạo backup v3 không đầy đủ.`);
    if (sale.saleKind === 'product') sales[id] = sale;
    else quickServiceSales[id] = sale;
  }

  if (quickServiceSalesValue != null && !isPlainRecord(quickServiceSalesValue)) {
    throw new Error('quickServiceSales hiện tại không hợp lệ để tạo backup.');
  }
  for (const [id, raw] of Object.entries(isPlainRecord(quickServiceSalesValue) ? quickServiceSalesValue : {})) {
    const sale = normalizeSale(id, raw);
    if (!sale || sale.saleKind !== 'quick_service') {
      throw new Error(`quickServiceSales/${id} không hợp lệ; từ chối tạo backup v3 không đầy đủ.`);
    }
    if (quickServiceSales[id]) throw new Error(`Trùng id Quick Service Sale ${id} khi tạo backup.`);
    quickServiceSales[id] = sale;
  }

  return { sales, quickServiceSales };
}

export async function createBackupEnvelope(): Promise<BackupEnvelope> {
  const values = await Promise.all(BACKUP_DATA_KEYS.map((key) => readPath(key)));
  const raw = Object.fromEntries(BACKUP_DATA_KEYS.map((key, index) => [key, values[index]])) as Record<BackupKey, unknown>;
  const ledgers = normalizeCurrentLedgersForExport(raw.sales, raw.quickServiceSales);
  const data: BackupData = {
    products: normalizeProducts(raw.products),
    sales: ledgers.sales,
    quickServiceSales: ledgers.quickServiceSales,
    stockOperations: {},
  };

  for (const key of BACKUP_DATA_KEYS) {
    if (key === 'products' || key === 'sales' || key === 'quickServiceSales') continue;
    const value = raw[key];
    if (key === 'settings') {
      if (isPlainRecord(value)) data.settings = value as unknown as BackupData['settings'];
      continue;
    }
    (data as Record<string, unknown>)[key] = isPlainRecord(value) ? value : {};
  }

  if (!data.stockOperations) data.stockOperations = {};
  return { schemaVersion: BACKUP_SCHEMA_VERSION, exportedAt: Date.now(), data };
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function downloadBackupJson(envelope: BackupEnvelope) {
  const stamp = new Date(envelope.exportedAt).toISOString().replace(/[:.]/g, '-');
  downloadBlob(`backup-ban-hang-${stamp}.json`, new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json;charset=utf-8' }));
}

function sheetRows(value: unknown, excludedFields: readonly string[] = []): Record<string, string | number | boolean>[] {
  if (!isPlainRecord(value)) return [];
  const excluded = new Set(excludedFields);
  return Object.entries(value).map(([key, raw]) => {
    if (!isPlainRecord(raw)) return { id: key, value: typeof raw === 'number' ? raw : String(raw ?? '') };
    const row: Record<string, string | number | boolean> = { id: key };
    for (const [field, fieldValue] of Object.entries(raw)) {
      if (excluded.has(field)) continue;
      if (typeof fieldValue === 'number' || typeof fieldValue === 'string' || typeof fieldValue === 'boolean') row[field] = fieldValue;
      else if (fieldValue == null) row[field] = '';
      else row[field] = JSON.stringify(fieldValue);
    }
    return row;
  });
}

export function exportBusinessDataExcel(envelope: BackupEnvelope) {
  const workbook = XLSX.utils.book_new();
  for (const key of BACKUP_DATA_KEYS) {
    const value = envelope.data[key];
    const rows = key === 'settings' && isPlainRecord(value)
      ? [{ id: 'settings', ...Object.fromEntries(Object.entries(value).map(([field, raw]) => [field, typeof raw === 'object' && raw !== null ? JSON.stringify(raw) : raw ?? ''])) } as Record<string, string | number | boolean>]
      : sheetRows(value, key === 'products' ? ['imageKey', 'imageUpdatedAt'] : []);
    const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ info: 'Không có dữ liệu' }]);
    XLSX.utils.book_append_sheet(workbook, sheet, key.slice(0, 31));
  }
  XLSX.writeFile(workbook, `du-lieu-chinh-${new Date(envelope.exportedAt).toISOString().slice(0, 10)}.xlsx`, { compression: true });
}

function findSensitiveKey(value: unknown, path = 'root'): string | null {
  if (!isPlainRecord(value) && !Array.isArray(value)) return null;
  const entries = Array.isArray(value) ? value.map((item, index) => [String(index), item] as const) : Object.entries(value);
  for (const [key, child] of entries) {
    const compact = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (/(password|privatekey|serviceaccount|refreshtoken|idtoken|accesstoken|credential|clientsecret)/.test(compact)) return `${path}.${key}`;
    const nested = findSensitiveKey(child, `${path}.${key}`);
    if (nested) return nested;
  }
  return null;
}

function assertCollection(value: unknown, label: string) {
  if (!isPlainRecord(value)) throw new Error(`${label} phải là object theo key Firebase.`);
}

function validateProducts(value: unknown) {
  assertCollection(value, 'products');
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isPlainRecord(raw)) throw new Error(`products/${id} không hợp lệ.`);
    const quantity = Number(raw.stockQuantity);
    const version = raw.stockVersion == null ? 0 : Number(raw.stockVersion);
    if (!Number.isFinite(quantity) || quantity < 0) throw new Error(`products/${id}.stockQuantity không hợp lệ.`);
    if (!Number.isInteger(version) || version < 0) throw new Error(`products/${id}.stockVersion không hợp lệ.`);
  }
}

function validateOperations(value: unknown) {
  assertCollection(value, 'stockOperations');
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!isPlainRecord(raw)) throw new Error(`stockOperations/${id} không hợp lệ.`);
    const receipt = raw as unknown as StockOperationReceipt;
    if (
      receipt.id !== id
      || !receipt.type
      || !receipt.referenceType
      || !receipt.referenceId
      || !receipt.actorUid
      || !Number.isFinite(Number(receipt.createdAt))
    ) {
      throw new Error(`stockOperations/${id} thiếu field bắt buộc hoặc id không khớp.`);
    }
  }
}

function parseSchemaVersion(value: unknown): RawBackupSchemaVersion {
  if (value === 1 || value === 2 || value === 3) return value;
  throw new Error('schemaVersion không hỗ trợ. Chỉ nhận backup v1, v2 hoặc v3.');
}

export function parseAndValidateBackup(text: string): BackupEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error('File không phải JSON hợp lệ.');
  }

  if (!isPlainRecord(parsed)) throw new Error('Backup phải là JSON object.');
  const schemaVersion = parseSchemaVersion(parsed.schemaVersion);
  if (!Number.isFinite(Number(parsed.exportedAt)) || Number(parsed.exportedAt) <= 0) throw new Error('exportedAt không hợp lệ.');
  if (!isPlainRecord(parsed.data)) throw new Error('Backup thiếu data.');

  const unknownTop = Object.keys(parsed).filter((key) => !['schemaVersion', 'exportedAt', 'data'].includes(key));
  if (unknownTop.length) throw new Error(`Backup có field cấp cao không được phép: ${unknownTop.join(', ')}.`);
  const unknownData = Object.keys(parsed.data).filter((key) => !BACKUP_DATA_KEYS.includes(key as BackupKey));
  if (unknownData.length) throw new Error(`Backup có node ngoài schema: ${unknownData.join(', ')}.`);
  if (!Object.prototype.hasOwnProperty.call(parsed.data, 'stockOperations')) {
    throw new Error('Backup thiếu stockOperations; từ chối restore để không làm mất idempotency receipt.');
  }

  const sensitive = findSensitiveKey(parsed);
  if (sensitive) throw new Error(`Backup chứa field có dấu hiệu credential/secret tại ${sensitive}; từ chối restore.`);

  for (const key of COLLECTION_KEYS) assertCollection(parsed.data[key] ?? {}, key);
  validateProducts(parsed.data.products ?? {});
  validateOperations(parsed.data.stockOperations);
  if (parsed.data.settings != null && !isPlainRecord(parsed.data.settings)) throw new Error('settings không hợp lệ.');

  const normalizedLedgers = normalizeBackupLedgers(
    parsed.data.sales ?? {},
    parsed.data.quickServiceSales ?? {},
    schemaVersion,
  );
  const normalizedData = {
    ...parsed.data,
    sales: normalizedLedgers.sales,
    quickServiceSales: normalizedLedgers.quickServiceSales,
  } as unknown as BackupData;

  return {
    schemaVersion: BACKUP_SCHEMA_VERSION,
    exportedAt: Number(parsed.exportedAt),
    data: normalizedData,
  };
}

function sameValue(a: unknown, b: unknown) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function countRecord(value: unknown) {
  return isPlainRecord(value) ? Object.keys(value).length : 0;
}

export async function previewRestore(envelope: BackupEnvelope, mode: RestoreMode): Promise<RestorePreview> {
  const currentValues = await Promise.all(BACKUP_DATA_KEYS.map((key) => readPath(key)));
  const nodes = BACKUP_DATA_KEYS.map((key, index): RestoreNodePreview => {
    const backupValue = envelope.data[key];
    const currentValue = currentValues[index];
    if (key === 'settings') {
      const hasBackup = isPlainRecord(backupValue);
      const hasCurrent = isPlainRecord(currentValue);
      return {
        key,
        backupCount: hasBackup ? 1 : 0,
        currentCount: hasCurrent ? 1 : 0,
        inserts: hasBackup && !hasCurrent ? 1 : 0,
        updates: hasBackup && hasCurrent && !sameValue(backupValue, currentValue) ? 1 : 0,
        deletes: mode === 'replace' && !hasBackup && hasCurrent ? 1 : 0,
      };
    }
    const backupRecord = isPlainRecord(backupValue) ? backupValue : {};
    const currentRecord = isPlainRecord(currentValue) ? currentValue : {};
    let inserts = 0;
    let updates = 0;
    for (const [id, value] of Object.entries(backupRecord)) {
      if (!(id in currentRecord)) inserts += 1;
      else if (!sameValue(value, currentRecord[id])) updates += 1;
    }
    const deletes = mode === 'replace'
      ? Object.keys(currentRecord).filter((id) => !(id in backupRecord)).length
      : 0;
    return { key, backupCount: countRecord(backupRecord), currentCount: countRecord(currentRecord), inserts, updates, deletes };
  });

  return {
    mode,
    nodes,
    blockers: [
      'Rules hiện tại chỉ cho tạo stockOperations khi receipt.actorUid bằng UID đang đăng nhập; không thể bảo toàn receipt lịch sử của actor khác.',
      'Rules Product chỉ cho product mới có stockQuantity = 0 và yêu cầu CAS stockVersion khi đổi tồn; không thể ghi trực tiếp snapshot tồn/version của backup.',
      'Rules hiện tại không cho xóa Product và stockOperations là create-only; chế độ replace không thể thực hiện đúng ngữ nghĩa an toàn từ client.',
      'Do các ràng buộc trên, ghi restore bị khóa cho đến khi AI trung tâm duyệt cơ chế Rules/restore đặc quyền phù hợp.',
    ],
    targetProjectId: String(import.meta.env.VITE_FIREBASE_PROJECT_ID || '(chưa cấu hình)'),
    targetDatabaseUrl: String(import.meta.env.VITE_FIREBASE_DATABASE_URL || '(chưa cấu hình)'),
  };
}

export async function restoreBackup(
  _envelope: BackupEnvelope,
  _mode: RestoreMode,
  _actorUid: string,
  confirmation: string,
): Promise<never> {
  if (confirmation !== 'KHOI PHUC') throw new Error('Cần nhập chính xác “KHOI PHUC” trước khi ghi restore.');
  throw new Error('Restore đang bị khóa an toàn: Security Rules hiện tại không thể bảo toàn stockVersion + stockOperations khi khôi phục từ trình duyệt. Không có dữ liệu nào được ghi.');
}
