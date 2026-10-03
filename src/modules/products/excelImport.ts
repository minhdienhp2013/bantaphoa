import { read, utils } from 'xlsx';
import type { Category, Product } from '../../types/models';
import type { ProductInput } from './productService';

export type ExcelImportStatus = 'ready' | 'duplicate' | 'conflict' | 'error';
export type ExcelProductField =
  | 'sku'
  | 'name'
  | 'aliases'
  | 'barcode'
  | 'qrCode'
  | 'categoryId'
  | 'unit'
  | 'costPrice'
  | 'salePrice'
  | 'minStock'
  | 'stockQuantity'
  | 'active';
export type ExcelProductMetadataField = Exclude<ExcelProductField, 'stockQuantity'>;

export interface ExcelProductImportRow {
  rowNumber: number;
  input: ProductInput | null;
  status: ExcelImportStatus;
  message: string;
  presentFields: ExcelProductField[];
  metadataPatch: Partial<ProductInput>;
  sourceStockQuantity?: number;
  matchedProductId?: string;
  categoryName?: string;
}

export interface ExcelProductImportResult {
  sheetName: string;
  rows: ExcelProductImportRow[];
  detectedHeaders: string[];
  stockColumnDetected: boolean;
  sourceFormat?: string;
}

type RawRow = Record<string, unknown>;
type IdentityKind = 'sku' | 'barcode' | 'qrCode';

interface DraftRow {
  rowNumber: number;
  input: ProductInput | null;
  presentFields: ExcelProductField[];
  metadataPatch: Partial<ProductInput>;
  sourceStockQuantity?: number;
  errors: string[];
  identityConflict: boolean;
  matchedProductId?: string;
  identityKeys: string[];
  duplicateReasons: string[];
  categoryName?: string;
}

const aliases: Record<ExcelProductField, string[]> = {
  sku: ['sku', 'mahang', 'masanpham', 'masp', 'mah', 'code'],
  name: ['tensanpham', 'tenhang', 'tenhanghoa', 'sanpham', 'productname', 'name'],
  aliases: ['tengoikhac'],
  barcode: ['barcode', 'mavach', 'ean', 'upc'],
  qrCode: ['qrcode', 'maqr', 'qr'],
  categoryId: ['danhmuc', 'nhomhang', 'category'],
  unit: ['donvitinh', 'donvi', 'dvt', 'unit'],
  costPrice: ['giavon', 'gianhap', 'giavonhang', 'costprice', 'cost'],
  salePrice: ['giaban', 'giabanle', 'saleprice', 'price'],
  minStock: ['tontoithieu', 'tonmin', 'minstock', 'muctontoithieu'],
  stockQuantity: ['tonkho', 'soluongton', 'slton', 'ton', 'inventory'],
  active: ['trangthai', 'active', 'status'],
};

function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, '');
}

function normalizeCode(value: string) {
  return value.trim().toLocaleLowerCase('vi');
}

function toText(value: unknown) {
  if (value === null || typeof value === 'undefined') return '';
  return String(value).trim();
}

function parseProductAliases(value: unknown) {
  return [...new Set(
    toText(value)
      .split(';')
      .map((alias) => alias.trim())
      .filter(Boolean),
  )];
}

function toNonNegativeNumber(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : undefined;
  }

  const text = toText(value);
  if (!text) return undefined;

  const stripped = text.replace(/[^0-9,.-]/g, '');
  if (!stripped) return undefined;

  let normalized = stripped;
  if (/^\d{1,3}([.,]\d{3})+$/.test(stripped)) {
    normalized = stripped.replace(/[.,]/g, '');
  } else if (stripped.includes(',') && !stripped.includes('.')) {
    normalized = stripped.replace(',', '.');
  } else if (stripped.includes(',') && stripped.includes('.')) {
    const lastComma = stripped.lastIndexOf(',');
    const lastDot = stripped.lastIndexOf('.');
    const decimalSeparator = lastComma > lastDot ? ',' : '.';
    const thousandSeparator = decimalSeparator === ',' ? '.' : ',';
    normalized = stripped.replaceAll(thousandSeparator, '').replace(decimalSeparator, '.');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function parseActive(value: unknown) {
  const text = normalizeHeader(toText(value));
  if (!text) return true;

  const inactiveValues = ['0', 'false', 'inactive', 'ngung', 'ngungkinhdoanh', 'khongkinhdoanh', 'tat'];
  return !inactiveValues.includes(text);
}

function findHeader(headers: string[], field: ExcelProductField) {
  const accepted = new Set(aliases[field]);
  return headers.find((header) => accepted.has(normalizeHeader(header)));
}

function getValue(row: RawRow, header?: string) {
  return header ? row[header] : undefined;
}

function addIndexValue(index: Map<string, Set<string>>, key: string, productId: string) {
  if (!key) return;
  const ids = index.get(key) ?? new Set<string>();
  ids.add(productId);
  index.set(key, ids);
}

function buildExistingIdentityIndexes(products: readonly Product[]) {
  const sku = new Map<string, Set<string>>();
  const barcode = new Map<string, Set<string>>();
  const qrCode = new Map<string, Set<string>>();

  for (const product of products) {
    addIndexValue(sku, normalizeCode(product.sku), product.id);
    addIndexValue(barcode, product.barcode?.trim() ?? '', product.id);
    addIndexValue(qrCode, product.qrCode?.trim() ?? '', product.id);
  }

  return { sku, barcode, qrCode };
}

function getIdentityMatches(
  indexes: ReturnType<typeof buildExistingIdentityIndexes>,
  kind: IdentityKind,
  value: string,
) {
  if (!value) return new Set<string>();
  if (kind === 'sku') return indexes.sku.get(normalizeCode(value)) ?? new Set<string>();
  if (kind === 'barcode') return indexes.barcode.get(value.trim()) ?? new Set<string>();
  return indexes.qrCode.get(value.trim()) ?? new Set<string>();
}

function buildIdentityKey(kind: IdentityKind, value: string) {
  if (!value) return '';
  const normalized = kind === 'sku' ? normalizeCode(value) : value.trim();
  return normalized ? `${kind}:${normalized}` : '';
}

export async function parseProductExcel(
  file: File,
  existingProducts: Product[],
  categories: readonly Category[] = [],
): Promise<ExcelProductImportResult> {
  const buffer = await file.arrayBuffer();
  const workbook = read(buffer, { type: 'array', cellDates: false });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error('File Excel không có sheet dữ liệu.');
  }

  const sheet = workbook.Sheets[sheetName];
  const infoSheet = workbook.Sheets['Thong tin'];
  const infoRows = infoSheet
    ? utils.sheet_to_json<unknown[]>(infoSheet, { header: 1, defval: '', raw: true })
    : [];
  const infoMap = new Map(
    infoRows
      .filter((row): row is unknown[] => Array.isArray(row) && row.length >= 2)
      .map((row) => [toText(row[0]), toText(row[1])] as const),
  );
  const sourceFormat = infoMap.get('Định dạng') || undefined;
  const rawRows = utils.sheet_to_json<RawRow>(sheet, { defval: '', raw: true });

  if (rawRows.length === 0) {
    throw new Error('Sheet đầu tiên không có dòng sản phẩm nào.');
  }

  const headers = Object.keys(rawRows[0]);
  const fieldHeaders: Partial<Record<ExcelProductField, string>> = {};
  (Object.keys(aliases) as ExcelProductField[]).forEach((field) => {
    const header = findHeader(headers, field);
    if (header) fieldHeaders[field] = header;
  });
  const presentFields = (Object.keys(fieldHeaders) as ExcelProductField[]).filter(
    (field) => Boolean(fieldHeaders[field]),
  );

  if (!fieldHeaders.sku || !fieldHeaders.name) {
    throw new Error('Excel phải có tối thiểu cột “Mã hàng/SKU” và “Tên hàng/Tên sản phẩm”.');
  }

  const identityIndexes = buildExistingIdentityIndexes(existingProducts);
  const categoryByName = new Map(categories.map((category) => [normalizeHeader(category.name), category] as const));

  const drafts = rawRows.map<DraftRow>((row, index) => {
    const rowNumber = index + 2;
    const sku = toText(getValue(row, fieldHeaders.sku));
    const name = toText(getValue(row, fieldHeaders.name));
    const productAliases = parseProductAliases(getValue(row, fieldHeaders.aliases));
    const barcode = toText(getValue(row, fieldHeaders.barcode));
    const qrCode = toText(getValue(row, fieldHeaders.qrCode));
    const categoryName = toText(getValue(row, fieldHeaders.categoryId));
    const category = categoryName ? categoryByName.get(normalizeHeader(categoryName)) : undefined;
    const unit = toText(getValue(row, fieldHeaders.unit));
    const costPriceValue = getValue(row, fieldHeaders.costPrice);
    const salePriceValue = getValue(row, fieldHeaders.salePrice);
    const minStockValue = getValue(row, fieldHeaders.minStock);
    const stockQuantityValue = getValue(row, fieldHeaders.stockQuantity);
    const activeValue = getValue(row, fieldHeaders.active);
    const sourceStockQuantity = toNonNegativeNumber(stockQuantityValue);
    const costPrice = toNonNegativeNumber(costPriceValue);
    const salePrice = toNonNegativeNumber(salePriceValue);
    const minStock = toNonNegativeNumber(minStockValue);

    const skuMatches = getIdentityMatches(identityIndexes, 'sku', sku);
    const barcodeMatches = getIdentityMatches(identityIndexes, 'barcode', barcode);
    const qrMatches = getIdentityMatches(identityIndexes, 'qrCode', qrCode);
    const candidateIds = new Set<string>([...skuMatches, ...barcodeMatches, ...qrMatches]);
    const identityConflict = candidateIds.size > 1;
    const matchedProductId = candidateIds.size === 1 ? [...candidateIds][0] : undefined;
    const duplicateReasons: string[] = [];
    if (skuMatches.size > 0) duplicateReasons.push('SKU đã có trong hệ thống');
    if (barcode && barcodeMatches.size > 0) duplicateReasons.push('Barcode đã có trong hệ thống');
    if (qrCode && qrMatches.size > 0) duplicateReasons.push('QR đã có trong hệ thống');

    const errors: string[] = [];
    if (!sku) errors.push('Thiếu SKU/Mã hàng');
    if (!name && !matchedProductId) errors.push('Thiếu tên sản phẩm');
    if (toText(costPriceValue) && typeof costPrice === 'undefined') errors.push('Giá vốn không hợp lệ');
    if (toText(salePriceValue) && typeof salePrice === 'undefined') errors.push('Giá bán không hợp lệ');
    if (toText(minStockValue) && typeof minStock === 'undefined') errors.push('Tồn tối thiểu không hợp lệ');
    if (categoryName && !category) errors.push(`Danh mục “${categoryName}” chưa tồn tại`);
    if (category && !category.active) errors.push(`Danh mục “${category.name}” đang ngừng sử dụng`);
    if (
      fieldHeaders.stockQuantity &&
      toText(stockQuantityValue) &&
      typeof sourceStockQuantity === 'undefined'
    ) {
      errors.push('Tồn kho không hợp lệ');
    }

    const metadataPatch: Partial<ProductInput> = {};
    if (name) metadataPatch.name = name;
    if (fieldHeaders.aliases && productAliases.length > 0) metadataPatch.aliases = productAliases;
    if (fieldHeaders.barcode && barcode) metadataPatch.barcode = barcode;
    if (fieldHeaders.qrCode && qrCode) metadataPatch.qrCode = qrCode;
    if (fieldHeaders.categoryId && category?.active) metadataPatch.categoryId = category.id;
    if (fieldHeaders.unit && unit) metadataPatch.unit = unit;
    if (fieldHeaders.costPrice && toText(costPriceValue) && typeof costPrice === 'number') {
      metadataPatch.costPrice = Math.round(costPrice);
    }
    if (fieldHeaders.salePrice && toText(salePriceValue) && typeof salePrice === 'number') {
      metadataPatch.salePrice = Math.round(salePrice);
    }
    if (fieldHeaders.minStock && toText(minStockValue) && typeof minStock === 'number') {
      metadataPatch.minStock = minStock;
    }
    if (fieldHeaders.active && toText(activeValue)) metadataPatch.active = parseActive(activeValue);

    const input: ProductInput | null = errors.length > 0
      ? null
      : {
          sku,
          name,
          ...(productAliases.length > 0 ? { aliases: productAliases } : {}),
          barcode: barcode || undefined,
          qrCode: qrCode || undefined,
          ...(category?.active ? { categoryId: category.id } : {}),
          unit: unit || undefined,
          costPrice: Math.round(costPrice ?? 0),
          salePrice: Math.round(salePrice ?? 0),
          minStock: typeof minStock === 'number' ? minStock : undefined,
          active: parseActive(activeValue),
        };

    return {
      rowNumber,
      input,
      presentFields,
      metadataPatch,
      errors,
      identityConflict,
      ...(typeof sourceStockQuantity === 'number' ? { sourceStockQuantity } : {}),
      ...(matchedProductId ? { matchedProductId } : {}),
      ...(categoryName ? { categoryName: category?.name ?? categoryName } : {}),
      identityKeys: [
        buildIdentityKey('sku', sku),
        buildIdentityKey('barcode', barcode),
        buildIdentityKey('qrCode', qrCode),
      ].filter(Boolean),
      duplicateReasons,
    };
  });

  const identityRows = new Map<string, number[]>();
  const matchedProductRows = new Map<string, number[]>();

  for (const draft of drafts) {
    if (draft.errors.length > 0 || draft.identityConflict) continue;
    for (const key of draft.identityKeys) {
      const rows = identityRows.get(key) ?? [];
      rows.push(draft.rowNumber);
      identityRows.set(key, rows);
    }
    if (draft.matchedProductId) {
      const rows = matchedProductRows.get(draft.matchedProductId) ?? [];
      rows.push(draft.rowNumber);
      matchedProductRows.set(draft.matchedProductId, rows);
    }
  }

  const duplicatedRowNumbers = new Set<number>();
  for (const rows of identityRows.values()) {
    if (rows.length > 1) rows.forEach((rowNumber) => duplicatedRowNumbers.add(rowNumber));
  }
  for (const rows of matchedProductRows.values()) {
    if (rows.length > 1) rows.forEach((rowNumber) => duplicatedRowNumbers.add(rowNumber));
  }

  const rows = drafts.map<ExcelProductImportRow>((draft) => {
    const common = {
      rowNumber: draft.rowNumber,
      input: draft.input,
      presentFields: [...draft.presentFields],
      metadataPatch: { ...draft.metadataPatch },
      ...(typeof draft.sourceStockQuantity === 'number' ? { sourceStockQuantity: draft.sourceStockQuantity } : {}),
      ...(draft.categoryName ? { categoryName: draft.categoryName } : {}),
    };

    if (draft.errors.length > 0) {
      return {
        ...common,
        input: null,
        status: 'error',
        message: draft.errors.join('; '),
      };
    }

    if (draft.identityConflict) {
      return {
        ...common,
        status: 'conflict',
        message: 'SKU/Barcode/QR đang trỏ tới các sản phẩm khác nhau.',
      };
    }

    if (duplicatedRowNumbers.has(draft.rowNumber)) {
      return {
        ...common,
        status: 'conflict',
        message: 'SKU/Barcode/QR bị lặp hoặc nhiều dòng đang trỏ tới cùng một sản phẩm trong file.',
        ...(draft.matchedProductId ? { matchedProductId: draft.matchedProductId } : {}),
      };
    }

    if (draft.matchedProductId) {
      return {
        ...common,
        status: 'duplicate',
        message: draft.duplicateReasons.join('; ') || 'Hàng trùng: đã xác định đúng một Product hiện hữu.',
        matchedProductId: draft.matchedProductId,
      };
    }

    return {
      ...common,
      status: 'ready',
      message: 'Sản phẩm mới - sẵn sàng nhập',
    };
  });

  return {
    sheetName,
    rows,
    detectedHeaders: headers,
    stockColumnDetected: Boolean(fieldHeaders.stockQuantity),
    ...(sourceFormat ? { sourceFormat } : {}),
  };
}