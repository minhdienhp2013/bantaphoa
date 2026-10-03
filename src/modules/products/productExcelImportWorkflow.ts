import type { Product, UserRole } from '../../types/models';
import { commitStockOperation, getProductsOnce } from '../inventory/inventoryService';
import type { ExcelProductImportRow } from './excelImport';
import {
  buildDuplicateProductUpdateInput,
  type ProductExcelDuplicateMode,
} from './productExcelImportPlan';
import { createProduct, updateProduct } from './productService';

const STOCK_NOTE = 'Điều chỉnh tồn từ Product Excel Import';
const MAX_TARGET_RETRIES = 3;

export interface ProductExcelImportProgress {
  createdProductIdsByRow: Record<number, string>;
  metadataUpdatedRows: number[];
  stockCompletedRows: number[];
}

export interface ProductExcelImportFailure {
  rowNumber: number;
  stage: 'create' | 'update' | 'stock';
  message: string;
}

export interface ProductExcelImportRunResult {
  created: number;
  updated: number;
  stockAdjusted: number;
  stockUnchanged: number;
  skippedDuplicates: number;
  failures: ProductExcelImportFailure[];
  progress: ProductExcelImportProgress;
}

export interface RunProductExcelImportInput {
  rows: readonly ExcelProductImportRow[];
  actorUid: string;
  actorRole: UserRole;
  duplicateMode: ProductExcelDuplicateMode;
  updateStock: boolean;
  stockColumnDetected: boolean;
  sessionId: string;
  progress?: ProductExcelImportProgress;
}

export function createEmptyProductExcelImportProgress(): ProductExcelImportProgress {
  return {
    createdProductIdsByRow: {},
    metadataUpdatedRows: [],
    stockCompletedRows: [],
  };
}

function cloneProgress(progress?: ProductExcelImportProgress): ProductExcelImportProgress {
  const source = progress ?? createEmptyProductExcelImportProgress();
  return {
    createdProductIdsByRow: { ...source.createdProductIdsByRow },
    metadataUpdatedRows: [...source.metadataUpdatedRows],
    stockCompletedRows: [...source.stockCompletedRows],
  };
}

function asMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || 'Lỗi không xác định.');
}

function sanitizeReferencePart(value: string) {
  return value
    .replaceAll('.', '-')
    .replaceAll('#', '-')
    .replaceAll('$', '-')
    .replaceAll('[', '-')
    .replaceAll(']', '-')
    .replaceAll('/', '-');
}

export function buildProductExcelStockReferenceId(
  sessionId: string,
  rowNumber: number,
  productId: string,
) {
  return `product-excel-${sanitizeReferencePart(sessionId)}-${rowNumber}-${sanitizeReferencePart(productId)}`;
}

function isStaleStockError(error: unknown) {
  const message = asMessage(error).toLocaleLowerCase('vi');
  return message.includes('tồn') && message.includes('đã thay đổi');
}

async function readProductById(productId: string): Promise<Product> {
  const products = await getProductsOnce();
  const product = products.find((candidate) => candidate.id === productId);
  if (!product) throw new Error(`Không tìm thấy sản phẩm ${productId}.`);
  return product;
}

async function adjustStockToExcelTarget(
  productId: string,
  targetQuantity: number,
  actorUid: string,
  referenceId: string,
): Promise<'adjusted' | 'unchanged'> {
  for (let attempt = 1; attempt <= MAX_TARGET_RETRIES; attempt += 1) {
    const currentProduct = await readProductById(productId);
    const currentQuantity = Number(currentProduct.stockQuantity) || 0;
    const delta = Math.round((targetQuantity - currentQuantity) * 1000) / 1000;
    if (delta === 0) return 'unchanged';

    try {
      await commitStockOperation({
        type: 'MANUAL_ADJUSTMENT',
        referenceType: 'manual',
        referenceId,
        actorUid,
        changes: [
          {
            productId,
            quantityDelta: delta,
            expectedQuantityBefore: currentQuantity,
            note: STOCK_NOTE,
          },
        ],
        audit: {
          action: 'PRODUCT_EXCEL_STOCK_ADJUSTED',
          entityType: 'product_import',
          entityId: referenceId,
          summary: `${STOCK_NOTE}: ${currentQuantity} → ${targetQuantity}`,
        },
      });
      return 'adjusted';
    } catch (error) {
      if (attempt < MAX_TARGET_RETRIES && isStaleStockError(error)) continue;
      throw error;
    }
  }

  throw new Error('Không thể điều chỉnh tồn kho theo file Excel.');
}

export async function runProductExcelImport(
  input: RunProductExcelImportInput,
): Promise<ProductExcelImportRunResult> {
  if (input.updateStock && input.actorRole !== 'owner') {
    throw new Error('Chỉ chủ cửa hàng được cập nhật tồn kho từ file Excel.');
  }
  if (input.updateStock && !input.stockColumnDetected) {
    throw new Error('File không có cột Tồn kho.');
  }

  const progress = cloneProgress(input.progress);
  const metadataUpdated = new Set(progress.metadataUpdatedRows);
  const stockCompleted = new Set(progress.stockCompletedRows);
  const failures: ProductExcelImportFailure[] = [];
  const productIdByRow = new Map<number, string>();

  let created = 0;
  let updated = 0;
  let stockAdjusted = 0;
  let stockUnchanged = 0;
  let skippedDuplicates = 0;

  for (const row of input.rows) {
    if (!row.input || row.status === 'error' || row.status === 'conflict') continue;

    if (row.status === 'ready') {
      const existingCreatedId = progress.createdProductIdsByRow[row.rowNumber];
      if (existingCreatedId) {
        productIdByRow.set(row.rowNumber, existingCreatedId);
        continue;
      }

      try {
        const product = await createProduct(row.input, input.actorUid);
        progress.createdProductIdsByRow[row.rowNumber] = product.id;
        productIdByRow.set(row.rowNumber, product.id);
        created += 1;
      } catch (error) {
        failures.push({ rowNumber: row.rowNumber, stage: 'create', message: asMessage(error) });
      }
      continue;
    }

    if (!row.matchedProductId) {
      failures.push({
        rowNumber: row.rowNumber,
        stage: 'update',
        message: 'Không xác định được Product hiện hữu cho dòng trùng.',
      });
      continue;
    }

    productIdByRow.set(row.rowNumber, row.matchedProductId);
    if (input.duplicateMode === 'skip') {
      skippedDuplicates += 1;
      continue;
    }
    if (metadataUpdated.has(row.rowNumber)) continue;

    try {
      const existing = await readProductById(row.matchedProductId);
      // buildDuplicateProductUpdateInput enforces duplicate identity by keeping sku: existing.sku.
      const updateInput = buildDuplicateProductUpdateInput(existing, row);
      await updateProduct(existing, updateInput, input.actorUid);
      metadataUpdated.add(row.rowNumber);
      progress.metadataUpdatedRows = [...metadataUpdated];
      updated += 1;
    } catch (error) {
      failures.push({ rowNumber: row.rowNumber, stage: 'update', message: asMessage(error) });
    }
  }

  if (input.updateStock) {
    for (const row of input.rows) {
      if (!row.input || row.status === 'error' || row.status === 'conflict') continue;
      if (typeof row.sourceStockQuantity !== 'number') continue;
      if (stockCompleted.has(row.rowNumber)) continue;

      const productId =
        productIdByRow.get(row.rowNumber) ??
        progress.createdProductIdsByRow[row.rowNumber] ??
        row.matchedProductId;
      if (!productId) continue;

      const referenceId = buildProductExcelStockReferenceId(
        input.sessionId,
        row.rowNumber,
        productId,
      );

      try {
        const outcome = await adjustStockToExcelTarget(
          productId,
          row.sourceStockQuantity,
          input.actorUid,
          referenceId,
        );
        stockCompleted.add(row.rowNumber);
        progress.stockCompletedRows = [...stockCompleted];
        if (outcome === 'adjusted') stockAdjusted += 1;
        else stockUnchanged += 1;
      } catch (error) {
        failures.push({ rowNumber: row.rowNumber, stage: 'stock', message: asMessage(error) });
      }
    }
  }

  progress.metadataUpdatedRows = [...metadataUpdated];
  progress.stockCompletedRows = [...stockCompleted];

  return {
    created,
    updated,
    stockAdjusted,
    stockUnchanged,
    skippedDuplicates,
    failures,
    progress,
  };
}
