import type { Product } from '../../types/models';
import type {
  ExcelProductImportRow,
  ExcelProductMetadataField,
} from './excelImport';
import type { ProductInput } from './productService';

export type ProductExcelDuplicateMode = 'skip' | 'update';

export interface ProductExcelStockPreview {
  current: number;
  target: number;
  delta: number;
}

export interface ProductExcelImportSummary {
  newCount: number;
  duplicateCount: number;
  conflictCount: number;
  errorCount: number;
  updateCount: number;
  stockAdjustmentCount: number;
  skippedCount: number;
}

export function getMatchedProduct(
  row: ExcelProductImportRow,
  products: readonly Product[],
): Product | undefined {
  if (!row.matchedProductId) return undefined;
  return products.find((product) => product.id === row.matchedProductId);
}

function hasProvidedMetadataField(
  row: ExcelProductImportRow,
  field: ExcelProductMetadataField,
) {
  return row.presentFields.includes(field)
    && Object.prototype.hasOwnProperty.call(row.metadataPatch, field);
}

export function buildDuplicateProductUpdateInput(
  existing: Product,
  row: ExcelProductImportRow,
): ProductInput {
  const patch = row.metadataPatch;
  const input: ProductInput = {
    sku: existing.sku,
    name: hasProvidedMetadataField(row, 'name') && typeof patch.name === 'string'
      ? patch.name
      : existing.name,
    barcode: hasProvidedMetadataField(row, 'barcode') && typeof patch.barcode === 'string'
      ? patch.barcode
      : existing.barcode,
    qrCode: hasProvidedMetadataField(row, 'qrCode') && typeof patch.qrCode === 'string'
      ? patch.qrCode
      : existing.qrCode,
    unit: hasProvidedMetadataField(row, 'unit') && typeof patch.unit === 'string'
      ? patch.unit
      : existing.unit,
    costPrice: hasProvidedMetadataField(row, 'costPrice') && typeof patch.costPrice === 'number'
      ? patch.costPrice
      : existing.costPrice,
    salePrice: hasProvidedMetadataField(row, 'salePrice') && typeof patch.salePrice === 'number'
      ? patch.salePrice
      : existing.salePrice,
    minStock: hasProvidedMetadataField(row, 'minStock') && typeof patch.minStock === 'number'
      ? patch.minStock
      : existing.minStock,
    active: hasProvidedMetadataField(row, 'active') && typeof patch.active === 'boolean'
      ? patch.active
      : existing.active,
  };

  if (hasProvidedMetadataField(row, 'aliases') && Array.isArray(patch.aliases)) {
    input.aliases = [...patch.aliases];
  }
  if (hasProvidedMetadataField(row, 'categoryId') && typeof patch.categoryId === 'string') {
    input.categoryId = patch.categoryId;
  } else if (existing.categoryId) {
    input.categoryId = existing.categoryId;
  }

  return input;
}

export function getExcelStockPreview(
  row: ExcelProductImportRow,
  products: readonly Product[],
): ProductExcelStockPreview | null {
  if (typeof row.sourceStockQuantity !== 'number') return null;
  if (row.status === 'error' || row.status === 'conflict') return null;

  const matched = getMatchedProduct(row, products);
  const current = row.status === 'ready' ? 0 : matched?.stockQuantity;
  if (typeof current !== 'number') return null;

  const target = row.sourceStockQuantity;
  const delta = Math.round((target - current) * 1000) / 1000;
  return { current, target, delta };
}

export function summarizeProductExcelImport(
  rows: readonly ExcelProductImportRow[],
  products: readonly Product[],
  duplicateMode: ProductExcelDuplicateMode,
  updateStock: boolean,
): ProductExcelImportSummary {
  const newCount = rows.filter((row) => row.status === 'ready').length;
  const duplicateCount = rows.filter((row) => row.status === 'duplicate').length;
  const conflictCount = rows.filter((row) => row.status === 'conflict').length;
  const errorCount = rows.filter((row) => row.status === 'error').length;
  const updateCount = duplicateMode === 'update' ? duplicateCount : 0;
  const skippedCount = duplicateMode === 'skip' ? duplicateCount : 0;
  const stockAdjustmentCount = updateStock
    ? rows.filter((row) => {
        const preview = getExcelStockPreview(row, products);
        return preview ? preview.delta !== 0 : false;
      }).length
    : 0;

  return {
    newCount,
    duplicateCount,
    conflictCount,
    errorCount,
    updateCount,
    stockAdjustmentCount,
    skippedCount,
  };
}