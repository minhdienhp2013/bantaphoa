import type { Product } from '../../types/models';
import { normalizeSearchCode, prepareSearchCandidate } from '../../shared/search/searchNormalization';
import type { ProductInput } from '../products/productService';
import type { PurchaseExcelImportRow } from './purchaseExcelImport';

export interface PurchaseExcelNewProductConsensus {
  input: ProductInput | null;
  error: string | null;
}

function deterministicText(values: readonly string[]) {
  return [...values].sort((a, b) => a.localeCompare(b, 'vi'))[0] ?? '';
}

function uniqueText(
  values: readonly string[],
  normalize: (value: string) => string,
  fieldLabel: string,
) {
  const byNormalized = new Map<string, string[]>();
  for (const raw of values) {
    const value = raw.trim();
    if (!value) continue;
    const key = normalize(value);
    if (!key) continue;
    const originals = byNormalized.get(key) ?? [];
    originals.push(value);
    byNormalized.set(key, originals);
  }
  if (byNormalized.size > 1) {
    return { value: '', error: `${fieldLabel} có nhiều giá trị khác nhau trong cùng Mã hàng.` };
  }
  const originals = [...byNormalized.values()][0] ?? [];
  return { value: deterministicText(originals), error: '' };
}

function uniqueNumber(values: ReadonlyArray<number | null | undefined>, fieldLabel: string) {
  const provided = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const distinct = new Set(provided);
  if (distinct.size > 1) {
    return { value: undefined, error: `${fieldLabel} có nhiều giá trị khác nhau trong cùng Mã hàng.` };
  }
  return { value: provided[0], error: '' };
}

function normalizeName(value: string) {
  return prepareSearchCandidate(value).normalized;
}

function normalizeUnit(value: string) {
  return value.trim().toLocaleLowerCase('vi');
}

export function buildPurchaseExcelNewProductConsensus(
  group: readonly PurchaseExcelImportRow[],
): PurchaseExcelNewProductConsensus {
  if (group.length === 0) return { input: null, error: 'Không có dòng hàng mới để tạo Product.' };

  const sku = uniqueText(group.map((row) => row.effectiveSku ?? ''), normalizeSearchCode, 'Mã hàng');
  if (sku.error || !sku.value) return { input: null, error: sku.error || 'Không xác định được Mã hàng mới.' };

  const name = uniqueText(group.map((row) => row.name), normalizeName, 'Tên hàng');
  if (name.error) return { input: null, error: 'Hai hàng mới khác tên cùng Mã hàng.' };
  if (!name.value) return { input: null, error: 'Thiếu Tên hàng.' };

  const barcode = uniqueText(group.map((row) => row.sourceBarcode), normalizeSearchCode, 'Barcode');
  if (barcode.error) return { input: null, error: barcode.error };

  const qrCode = uniqueText(group.map((row) => row.sourceQrCode), normalizeSearchCode, 'QR');
  if (qrCode.error) return { input: null, error: qrCode.error };

  const unit = uniqueText(group.map((row) => row.unit), normalizeUnit, 'Đơn vị');
  if (unit.error) return { input: null, error: unit.error };

  const unitCost = uniqueNumber(group.map((row) => row.unitCost), 'Giá nhập');
  if (unitCost.error) return { input: null, error: 'Cùng sản phẩm dự kiến nhưng Giá nhập khác nhau; không tự average.' };
  if (typeof unitCost.value !== 'number') return { input: null, error: 'Thiếu Giá nhập hợp lệ.' };

  const salePrice = uniqueNumber(group.map((row) => row.salePrice), 'Giá bán');
  if (salePrice.error) return { input: null, error: salePrice.error };

  const minStock = uniqueNumber(group.map((row) => row.minStock), 'Tồn tối thiểu');
  if (minStock.error) return { input: null, error: minStock.error };

  return {
    input: {
      sku: sku.value,
      name: name.value,
      barcode: barcode.value || sku.value,
      qrCode: qrCode.value || undefined,
      unit: unit.value || undefined,
      costPrice: Math.round(unitCost.value),
      salePrice: Math.round(salePrice.value ?? 0),
      minStock: minStock.value,
      active: true,
    },
    error: null,
  };
}

function exactMatches(products: readonly Product[], value: string | undefined, read: (product: Product) => string | undefined) {
  const needle = normalizeSearchCode(value);
  if (!needle) return [];
  return products.filter((product) => normalizeSearchCode(read(product)) === needle);
}

export function getPurchaseExcelCurrentCatalogConflict(
  input: ProductInput,
  currentProducts: readonly Product[],
): string | null {
  const skuMatches = exactMatches(currentProducts, input.sku, (product) => product.sku);
  if (skuMatches.length > 0) {
    return `Danh mục đã thay đổi từ lúc phân tích Excel. Mã hàng “${input.sku}” hiện đã tồn tại. Hãy phân tích lại file.`;
  }

  const barcodeMatches = exactMatches(currentProducts, input.barcode, (product) => product.barcode);
  if (barcodeMatches.length > 0) {
    return `Danh mục đã thay đổi từ lúc phân tích Excel. Barcode “${input.barcode}” hiện đã tồn tại. Hãy phân tích lại file.`;
  }

  const qrMatches = exactMatches(currentProducts, input.qrCode, (product) => product.qrCode);
  if (qrMatches.length > 0) {
    return `Danh mục đã thay đổi từ lúc phân tích Excel. QR “${input.qrCode}” hiện đã tồn tại. Hãy phân tích lại file.`;
  }

  const normalizedName = normalizeName(input.name);
  if (normalizedName && currentProducts.some((product) => normalizeName(product.name) === normalizedName)) {
    return `Danh mục đã thay đổi từ lúc phân tích Excel. Tên “${input.name}” hiện đã trùng Product có sẵn. Hãy phân tích lại file.`;
  }

  return null;
}
