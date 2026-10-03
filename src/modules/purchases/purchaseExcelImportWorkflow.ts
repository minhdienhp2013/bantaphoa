import type { Product } from '../../types/models';
import { normalizeSearchCode } from '../../shared/search/searchNormalization';
import { createProduct, type ProductInput } from '../products/productService';
import type { PurchaseExcelImportRow } from './purchaseExcelImport';
import {
  buildPurchaseExcelNewProductConsensus,
  getPurchaseExcelCurrentCatalogConflict,
} from './purchaseExcelImportNewProduct';

export interface PurchaseExcelCreateProgress {
  createdProductsBySku: Record<string, Product>;
}

export interface PurchaseExcelCreateFailure {
  sku: string;
  rowNumbers: number[];
  message: string;
}

export interface PurchaseExcelCreateResult {
  progress: PurchaseExcelCreateProgress;
  failures: PurchaseExcelCreateFailure[];
  createdProducts: Product[];
}

export function createEmptyPurchaseExcelProgress(): PurchaseExcelCreateProgress {
  return { createdProductsBySku: {} };
}

function cloneProgress(progress?: PurchaseExcelCreateProgress): PurchaseExcelCreateProgress {
  return { createdProductsBySku: { ...(progress?.createdProductsBySku ?? {}) } };
}

function productKey(row: PurchaseExcelImportRow) {
  return normalizeSearchCode(row.effectiveSku);
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Lỗi không xác định.');
}

export async function createConfirmedPurchaseExcelProducts(input: {
  rows: readonly PurchaseExcelImportRow[];
  selectedNewRowNumbers: ReadonlySet<number>;
  actorUid: string;
  currentProducts: readonly Product[];
  progress?: PurchaseExcelCreateProgress;
  createProductFn?: (product: ProductInput, actorUid: string) => Promise<Product>;
}): Promise<PurchaseExcelCreateResult> {
  const progress = cloneProgress(input.progress);
  const failures: PurchaseExcelCreateFailure[] = [];
  const groups = new Map<string, PurchaseExcelImportRow[]>();
  const createProductNow = input.createProductFn ?? createProduct;
  const currentCatalog = [...input.currentProducts, ...Object.values(progress.createdProductsBySku)];

  for (const row of input.rows) {
    if (row.status !== 'NEW' || !input.selectedNewRowNumbers.has(row.rowNumber)) continue;
    if (!row.newProductInput || !row.effectiveSku) continue;
    const key = productKey(row);
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }

  for (const [key, group] of groups) {
    if (progress.createdProductsBySku[key]) continue;

    const consensus = buildPurchaseExcelNewProductConsensus(group);
    const sku = consensus.input?.sku ?? group[0]?.effectiveSku ?? key;
    if (!consensus.input) {
      failures.push({
        sku,
        rowNumbers: group.map((row) => row.rowNumber),
        message: consensus.error ?? 'Metadata hàng mới không nhất quán. Hãy phân tích lại file.',
      });
      continue;
    }

    const catalogConflict = getPurchaseExcelCurrentCatalogConflict(consensus.input, currentCatalog);
    if (catalogConflict) {
      failures.push({
        sku: consensus.input.sku,
        rowNumbers: group.map((row) => row.rowNumber),
        message: catalogConflict,
      });
      continue;
    }

    try {
      const created = await createProductNow(consensus.input, input.actorUid);
      progress.createdProductsBySku[key] = created;
      currentCatalog.push(created);
    } catch (error) {
      failures.push({
        sku: consensus.input.sku,
        rowNumbers: group.map((row) => row.rowNumber),
        message: messageOf(error),
      });
    }
  }

  return {
    progress,
    failures,
    createdProducts: Object.values(progress.createdProductsBySku),
  };
}
