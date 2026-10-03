import { read, utils, type CellObject, type WorkSheet } from 'xlsx';
import type { Product } from '../../types/models';
import { normalizeSearchCode, prepareSearchCandidate } from '../../shared/search/searchNormalization';
import { generateLegacyProductCode } from '../products/productLegacyCode';
import type { ProductInput } from '../products/productService';
import { buildPurchaseExcelNewProductConsensus } from './purchaseExcelImportNewProduct';

export type PurchaseExcelRowStatus = 'MATCHED' | 'NEW' | 'REVIEW' | 'ERROR';

export interface PurchaseExcelImportRow {
  rowNumber: number;
  status: PurchaseExcelRowStatus;
  message: string;
  name: string;
  sourceSku: string;
  sourceBarcode: string;
  sourceQrCode: string;
  unit: string;
  quantity: number | null;
  unitCost: number | null;
  salePrice: number | null;
  minStock?: number;
  matchedProductId?: string;
  effectiveSku?: string;
  newProductInput?: ProductInput;
}

export interface PurchaseExcelImportResult {
  sheetName: string;
  rows: PurchaseExcelImportRow[];
  detectedHeaders: string[];
  summary: PurchaseExcelImportSummary;
}

export interface PurchaseExcelImportSummary {
  total: number;
  matched: number;
  newCount: number;
  review: number;
  error: number;
}

type PurchaseExcelField =
  | 'name'
  | 'sku'
  | 'barcode'
  | 'qrCode'
  | 'unit'
  | 'quantity'
  | 'unitCost'
  | 'salePrice'
  | 'minStock';

type HeaderIndexes = Partial<Record<PurchaseExcelField, number>>;

export const PURCHASE_EXCEL_HEADER_ALIASES: Record<PurchaseExcelField, readonly string[]> = {
  name: ['tenhang', 'tensanpham', 'tenhanghoa', 'sanpham', 'productname', 'name'],
  sku: ['mahang', 'sku', 'masanpham', 'masp', 'mah', 'code'],
  barcode: ['mavach', 'barcode', 'ean', 'upc'],
  qrCode: ['maqr', 'qrcode', 'qr'],
  unit: ['donvi', 'donvitinh', 'dvt', 'unit'],
  quantity: ['soluongnhap', 'slnhap', 'soluong', 'quantity', 'qty'],
  unitCost: ['gianhap', 'giavon', 'unitcost', 'costprice', 'cost'],
  salePrice: ['giaban', 'giabanle', 'saleprice', 'price'],
  minStock: ['tontoithieu', 'tonmin', 'minstock', 'muctontoithieu'],
};

const SCIENTIFIC_IDENTIFIER = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)[eE][+-]?\d+$/;

function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[đĐ]/g, 'd')
    .toLocaleLowerCase('vi')
    .replace(/[^a-z0-9]/g, '');
}

function normalizeFullName(value: string) {
  return prepareSearchCandidate(value).normalized;
}

function summarize(rows: readonly PurchaseExcelImportRow[]): PurchaseExcelImportSummary {
  return {
    total: rows.length,
    matched: rows.filter((row) => row.status === 'MATCHED').length,
    newCount: rows.filter((row) => row.status === 'NEW').length,
    review: rows.filter((row) => row.status === 'REVIEW').length,
    error: rows.filter((row) => row.status === 'ERROR').length,
  };
}

function buildIndex(products: readonly Product[], value: (product: Product) => string | undefined) {
  const index = new Map<string, Product[]>();
  for (const product of products) {
    const key = normalizeSearchCode(value(product));
    if (!key) continue;
    const list = index.get(key) ?? [];
    list.push(product);
    index.set(key, list);
  }
  return index;
}

function buildNameIndex(products: readonly Product[]) {
  const index = new Map<string, Product[]>();
  for (const product of products) {
    const key = normalizeFullName(product.name);
    if (!key) continue;
    const list = index.get(key) ?? [];
    list.push(product);
    index.set(key, list);
  }
  return index;
}

function findHeaderRow(sheet: WorkSheet) {
  const rows = utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 10); rowIndex += 1) {
    const headers = (rows[rowIndex] ?? []).map((value) => String(value ?? '').trim());
    const normalized = new Set(headers.map(normalizeHeader));
    const recognized = Object.values(PURCHASE_EXCEL_HEADER_ALIASES)
      .flat()
      .filter((alias) => normalized.has(alias)).length;
    if (recognized >= 3) return { rowIndex, headers };
  }
  return null;
}

function resolveHeaders(headers: readonly string[]) {
  const indexes: HeaderIndexes = {};
  for (const [field, aliases] of Object.entries(PURCHASE_EXCEL_HEADER_ALIASES) as Array<[PurchaseExcelField, readonly string[]]>) {
    const accepted = new Set(aliases);
    const index = headers.findIndex((header) => accepted.has(normalizeHeader(header)));
    if (index >= 0) indexes[field] = index;
  }
  return indexes;
}

function getCell(sheet: WorkSheet, row: number, column: number | undefined): CellObject | undefined {
  if (typeof column !== 'number') return undefined;
  return sheet[utils.encode_cell({ r: row, c: column })] as CellObject | undefined;
}

function cellText(cell: CellObject | undefined) {
  if (!cell || cell.v === null || typeof cell.v === 'undefined') return '';
  return String(cell.v).trim();
}

function readSafeIdentifier(cell: CellObject | undefined, label: string) {
  if (!cell || cell.v === null || typeof cell.v === 'undefined' || String(cell.v).trim() === '') {
    return { value: '', error: '' };
  }
  if (cell.f) {
    return { value: '', error: `${label} dùng công thức Excel; không thể xác minh identifier an toàn.` };
  }
  if (cell.t !== 's') {
    return { value: '', error: `${label} đang được Excel lưu dạng số/không phải TEXT; có thể đã mất số 0 đầu hoặc bị biến dạng.` };
  }
  const value = String(cell.v).trim();
  if (SCIENTIFIC_IDENTIFIER.test(value)) {
    return { value: '', error: `${label} có dạng scientific notation; cần sửa cột về TEXT và nhập lại mã gốc.` };
  }
  return { value, error: '' };
}

function parseNumberText(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const compact = trimmed.replace(/\s+/g, '');
  if (!/^-?\d+(?:[.,]\d+)*(?:[.,]\d+)?$/.test(compact)) return Number.NaN;

  let normalized = compact;
  if (/^-?\d{1,3}(?:[.,]\d{3})+$/.test(compact)) {
    normalized = compact.replace(/[.,]/g, '');
  } else if (compact.includes(',') && compact.includes('.')) {
    const lastComma = compact.lastIndexOf(',');
    const lastDot = compact.lastIndexOf('.');
    const decimal = lastComma > lastDot ? ',' : '.';
    const thousands = decimal === ',' ? '.' : ',';
    normalized = compact.replaceAll(thousands, '').replace(decimal, '.');
  } else if (compact.includes(',')) {
    const pieces = compact.split(',');
    normalized = pieces.length === 2 && pieces[1].length !== 3
      ? compact.replace(',', '.')
      : compact.replaceAll(',', '');
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? value : Number.NaN;
}

function readNumber(cell: CellObject | undefined) {
  if (!cell || cell.v === null || typeof cell.v === 'undefined' || String(cell.v).trim() === '') return null;
  if (typeof cell.v === 'number') return Number.isFinite(cell.v) ? cell.v : Number.NaN;
  return parseNumberText(String(cell.v));
}

function matchedRow(
  base: Omit<PurchaseExcelImportRow, 'status' | 'message'>,
  product: Product,
  via: string,
): PurchaseExcelImportRow {
  if (!product.active) {
    return {
      ...base,
      status: 'REVIEW',
      message: `Product “${product.name}” (${product.sku}) đã ngừng sử dụng. Cần kiểm tra trước khi nhập.`,
      matchedProductId: product.id,
      effectiveSku: product.sku,
    };
  }
  return {
    ...base,
    status: 'MATCHED',
    message: `Đã khớp ${product.sku} theo ${via}. SKU/barcode/QR hiện tại của Product được giữ nguyên.`,
    matchedProductId: product.id,
    effectiveSku: product.sku,
  };
}

function reviewRow(
  base: Omit<PurchaseExcelImportRow, 'status' | 'message'>,
  message: string,
): PurchaseExcelImportRow {
  return { ...base, status: 'REVIEW', message };
}

function errorRow(
  base: Omit<PurchaseExcelImportRow, 'status' | 'message'>,
  message: string,
): PurchaseExcelImportRow {
  return { ...base, status: 'ERROR', message };
}

function newRow(
  base: Omit<PurchaseExcelImportRow, 'status' | 'message'>,
  effectiveSku: string,
  message: string,
): PurchaseExcelImportRow {
  const candidate: PurchaseExcelImportRow = {
    ...base,
    status: 'NEW',
    message,
    effectiveSku,
  };
  const consensus = buildPurchaseExcelNewProductConsensus([candidate]);
  if (!consensus.input) return reviewRow({ ...base, effectiveSku }, consensus.error ?? 'Không thể dựng Product mới an toàn.');
  return { ...candidate, newProductInput: consensus.input };
}

function productIdentifierValue(product: Product, label: 'SKU' | 'Barcode' | 'QR') {
  if (label === 'SKU') return product.sku;
  if (label === 'Barcode') return product.barcode;
  return product.qrCode;
}

function buildInitialRows(sheet: WorkSheet, headerRowIndex: number, headers: HeaderIndexes, products: readonly Product[]) {
  const range = utils.decode_range(sheet['!ref'] ?? 'A1:A1');
  const skuIndex = buildIndex(products, (product) => product.sku);
  const barcodeIndex = buildIndex(products, (product) => product.barcode);
  const qrIndex = buildIndex(products, (product) => product.qrCode);
  const nameIndex = buildNameIndex(products);
  const rows: PurchaseExcelImportRow[] = [];

  for (let rowIndex = headerRowIndex + 1; rowIndex <= range.e.r; rowIndex += 1) {
    const name = cellText(getCell(sheet, rowIndex, headers.name));
    const unit = cellText(getCell(sheet, rowIndex, headers.unit));
    const skuResult = readSafeIdentifier(getCell(sheet, rowIndex, headers.sku), 'Mã hàng');
    const barcodeResult = readSafeIdentifier(getCell(sheet, rowIndex, headers.barcode), 'Mã vạch');
    const qrResult = readSafeIdentifier(getCell(sheet, rowIndex, headers.qrCode), 'Mã QR');
    const quantity = readNumber(getCell(sheet, rowIndex, headers.quantity));
    const unitCost = readNumber(getCell(sheet, rowIndex, headers.unitCost));
    const salePrice = readNumber(getCell(sheet, rowIndex, headers.salePrice));
    const minStock = readNumber(getCell(sheet, rowIndex, headers.minStock));

    const hasAnyValue = [
      name,
      unit,
      skuResult.value,
      barcodeResult.value,
      qrResult.value,
      cellText(getCell(sheet, rowIndex, headers.quantity)),
      cellText(getCell(sheet, rowIndex, headers.unitCost)),
      cellText(getCell(sheet, rowIndex, headers.salePrice)),
      cellText(getCell(sheet, rowIndex, headers.minStock)),
    ].some(Boolean);
    if (!hasAnyValue) continue;

    const base: Omit<PurchaseExcelImportRow, 'status' | 'message'> = {
      rowNumber: rowIndex + 1,
      name,
      sourceSku: skuResult.value,
      sourceBarcode: barcodeResult.value,
      sourceQrCode: qrResult.value,
      unit,
      quantity: typeof quantity === 'number' && Number.isFinite(quantity) ? quantity : null,
      unitCost: typeof unitCost === 'number' && Number.isFinite(unitCost) ? unitCost : null,
      salePrice: typeof salePrice === 'number' && Number.isFinite(salePrice) ? salePrice : null,
      ...(typeof minStock === 'number' && Number.isFinite(minStock) ? { minStock } : {}),
    };

    const errors = [skuResult.error, barcodeResult.error, qrResult.error].filter(Boolean);
    if (quantity === null || !Number.isFinite(quantity) || quantity <= 0) errors.push('Số lượng nhập phải là số lớn hơn 0.');
    if (unitCost === null || !Number.isFinite(unitCost) || unitCost < 0) errors.push('Giá nhập phải là số từ 0 trở lên.');
    if (salePrice !== null && (!Number.isFinite(salePrice) || salePrice < 0)) errors.push('Giá bán phải là số từ 0 trở lên.');
    if (minStock !== null && (!Number.isFinite(minStock) || minStock < 0)) errors.push('Tồn tối thiểu phải là số từ 0 trở lên.');
    if (errors.length > 0) {
      rows.push(errorRow(base, errors.join(' ')));
      continue;
    }

    const explicit = [
      ['SKU', skuResult.value, skuIndex] as const,
      ['Barcode', barcodeResult.value, barcodeIndex] as const,
      ['QR', qrResult.value, qrIndex] as const,
    ];
    const hasExplicitIdentifier = explicit.some(([, value]) => Boolean(value));
    const identityProducts = new Map<string, Product>();
    const ambiguousIdentities: string[] = [];
    for (const [label, value, index] of explicit) {
      if (!value) continue;
      const matches = index.get(normalizeSearchCode(value)) ?? [];
      if (matches.length > 1) ambiguousIdentities.push(`${label} đang trùng nhiều Product`);
      for (const product of matches) identityProducts.set(product.id, product);
    }

    if (ambiguousIdentities.length > 0 || identityProducts.size > 1) {
      rows.push(reviewRow(base, ambiguousIdentities.length > 0
        ? `${ambiguousIdentities.join('; ')}. Cần kiểm tra dữ liệu danh mục.`
        : 'SKU/Barcode/QR trong dòng đang trỏ tới các Product khác nhau.'));
      continue;
    }

    if (identityProducts.size === 1) {
      const product = [...identityProducts.values()][0];
      const mismatches = explicit
        .filter(([, value]) => Boolean(value))
        .filter(([label, value]) => normalizeSearchCode(productIdentifierValue(product, label)) !== normalizeSearchCode(value))
        .map(([label]) => label);
      if (mismatches.length > 0) {
        rows.push(reviewRow(
          base,
          `Có identifier khớp Product “${product.name}” (${product.sku}) nhưng ${mismatches.join(', ')} được cung cấp không khớp Product đó. Cần kiểm tra.`,
        ));
      } else {
        rows.push(matchedRow(base, product, 'identity chính xác'));
      }
      continue;
    }

    if (!name) {
      rows.push(errorRow(base, 'Thiếu Tên hàng cho sản phẩm chưa tồn tại.'));
      continue;
    }

    const generatedSku = generateLegacyProductCode(name);
    const effectiveSku = skuResult.value || generatedSku;
    if (!effectiveSku) {
      rows.push(errorRow(base, 'Không thể sinh Mã hàng từ tên sản phẩm.'));
      continue;
    }

    if (hasExplicitIdentifier) {
      const skuCollision = skuIndex.get(normalizeSearchCode(effectiveSku)) ?? [];
      if (skuCollision.length > 0) {
        rows.push(reviewRow({ ...base, effectiveSku }, `Mã hàng “${effectiveSku}” đã thuộc Product hiện có. Cần kiểm tra.`));
        continue;
      }

      const effectiveBarcode = barcodeResult.value || effectiveSku;
      const barcodeCollision = barcodeIndex.get(normalizeSearchCode(effectiveBarcode)) ?? [];
      if (barcodeCollision.length > 0) {
        rows.push(reviewRow({ ...base, effectiveSku }, `Barcode dự kiến “${effectiveBarcode}” đã thuộc Product hiện có. Cần kiểm tra.`));
        continue;
      }

      if (qrResult.value && (qrIndex.get(normalizeSearchCode(qrResult.value)) ?? []).length > 0) {
        rows.push(reviewRow({ ...base, effectiveSku }, `QR “${qrResult.value}” đã thuộc Product hiện có. Cần kiểm tra.`));
        continue;
      }

      const explicitNameMatches = nameIndex.get(normalizeFullName(name)) ?? [];
      if (explicitNameMatches.length > 0) {
        rows.push(reviewRow(
          { ...base, effectiveSku },
          'Có mã mới nhưng tên trùng Product hiện có — cần kiểm tra.',
        ));
        continue;
      }

      rows.push(newRow(
        base,
        effectiveSku,
        skuResult.value
          ? 'Hàng mới. Sẽ dùng Mã hàng trong Excel; Product chỉ được tạo sau khi xác nhận.'
          : `Hàng mới. Mã legacy dự kiến: ${generatedSku}. Product chỉ được tạo sau khi xác nhận.`,
      ));
      continue;
    }

    const generatedMatches = skuIndex.get(normalizeSearchCode(generatedSku)) ?? [];
    if (generatedMatches.length > 1) {
      rows.push(reviewRow({ ...base, effectiveSku }, `Mã sinh “${generatedSku}” đang thuộc nhiều Product. Cần kiểm tra.`));
      continue;
    }
    if (generatedMatches.length === 1) {
      const product = generatedMatches[0];
      if (normalizeFullName(product.name) === normalizeFullName(name)) {
        rows.push(matchedRow(base, product, 'mã legacy sinh từ tên'));
      } else {
        rows.push(reviewRow(
          { ...base, effectiveSku },
          `Mã sinh “${generatedSku}” đã thuộc Product “${product.name}” (${product.sku}) nhưng tên không trùng chính xác.`,
        ));
      }
      continue;
    }

    const fullNameMatches = nameIndex.get(normalizeFullName(name)) ?? [];
    if (fullNameMatches.length > 1) {
      rows.push(reviewRow({ ...base, effectiveSku }, 'Tên chuẩn hóa trùng chính xác với nhiều Product. Cần chọn/kiểm tra thủ công.'));
      continue;
    }
    if (fullNameMatches.length === 1) {
      rows.push(matchedRow(base, fullNameMatches[0], 'tên đầy đủ chuẩn hóa chính xác'));
      continue;
    }

    const fallbackBarcode = effectiveSku;
    if ((barcodeIndex.get(normalizeSearchCode(fallbackBarcode)) ?? []).length > 0) {
      rows.push(reviewRow({ ...base, effectiveSku }, `Barcode fallback “${fallbackBarcode}” đã thuộc Product hiện có. Cần kiểm tra.`));
      continue;
    }

    rows.push(newRow(
      base,
      effectiveSku,
      `Hàng mới. Mã legacy dự kiến: ${generatedSku}. Product chỉ được tạo sau khi xác nhận.`,
    ));
  }

  return rows;
}

function applyFileCollisionChecks(inputRows: PurchaseExcelImportRow[]) {
  const rows = inputRows.map((row) => ({ ...row }));
  const reviewRows = new Map<number, string[]>();
  const addReview = (rowNumber: number, message: string) => {
    const messages = reviewRows.get(rowNumber) ?? [];
    if (!messages.includes(message)) messages.push(message);
    reviewRows.set(rowNumber, messages);
  };

  const newRows = rows.filter((row) => row.status === 'NEW' && row.effectiveSku && row.newProductInput);
  const skuGroups = new Map<string, PurchaseExcelImportRow[]>();
  for (const row of newRows) {
    const key = normalizeSearchCode(row.effectiveSku);
    const group = skuGroups.get(key) ?? [];
    group.push(row);
    skuGroups.set(key, group);
  }

  for (const [sku, group] of skuGroups) {
    const consensus = buildPurchaseExcelNewProductConsensus(group);
    if (!consensus.input) {
      group.forEach((row) => addReview(row.rowNumber, `${consensus.error ?? 'Metadata hàng mới không nhất quán'} Mã hàng “${sku}”.`));
      continue;
    }
    for (const row of group) row.newProductInput = { ...consensus.input };
  }

  for (const field of ['barcode', 'qrCode'] as const) {
    const groups = new Map<string, PurchaseExcelImportRow[]>();
    for (const row of newRows) {
      const value = normalizeSearchCode(row.newProductInput?.[field]);
      if (!value) continue;
      const group = groups.get(value) ?? [];
      group.push(row);
      groups.set(value, group);
    }
    for (const [value, group] of groups) {
      const skuKeys = new Set(group.map((row) => normalizeSearchCode(row.effectiveSku)));
      if (skuKeys.size > 1) {
        const label = field === 'barcode' ? 'Barcode' : 'QR';
        group.forEach((row) => addReview(row.rowNumber, `${label} “${value}” bị dùng cho nhiều hàng mới khác nhau.`));
      }
    }
  }

  const matchedGroups = new Map<string, PurchaseExcelImportRow[]>();
  for (const row of rows.filter((candidate) => candidate.status === 'MATCHED' && candidate.matchedProductId)) {
    const group = matchedGroups.get(row.matchedProductId!) ?? [];
    group.push(row);
    matchedGroups.set(row.matchedProductId!, group);
  }
  for (const group of matchedGroups.values()) {
    if (group.length < 2) continue;
    const costs = new Set(group.map((row) => row.unitCost));
    if (costs.size > 1) group.forEach((row) => addReview(row.rowNumber, 'Cùng Product xuất hiện nhiều dòng nhưng Giá nhập khác nhau; không tự average.'));
  }

  return rows.map((row) => {
    const messages = reviewRows.get(row.rowNumber);
    if (!messages?.length) return row;
    return { ...row, status: 'REVIEW' as const, message: messages.join(' ') };
  });
}

export function parsePurchaseExcelBuffer(
  buffer: ArrayBuffer | Uint8Array,
  existingProducts: readonly Product[],
): PurchaseExcelImportResult {
  const workbook = read(buffer, { type: 'array', cellDates: false });
  const sheetName = workbook.SheetNames.find((name) => normalizeHeader(name) === 'nhaphang') ?? workbook.SheetNames[0];
  if (!sheetName) throw new Error('File Excel không có sheet dữ liệu.');
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) throw new Error('Không đọc được sheet nhập hàng.');

  const headerRow = findHeaderRow(sheet);
  if (!headerRow) throw new Error('Không tìm thấy hàng tiêu đề hợp lệ trong Excel.');
  const headers = resolveHeaders(headerRow.headers);
  if (typeof headers.name !== 'number' || typeof headers.quantity !== 'number' || typeof headers.unitCost !== 'number') {
    throw new Error('Excel phải có tối thiểu các cột “Tên hàng”, “Số lượng nhập” và “Giá nhập”.');
  }

  const rows = applyFileCollisionChecks(buildInitialRows(sheet, headerRow.rowIndex, headers, existingProducts));
  if (rows.length === 0) throw new Error('Sheet nhập hàng không có dòng dữ liệu nào.');
  return { sheetName, rows, detectedHeaders: headerRow.headers.filter(Boolean), summary: summarize(rows) };
}

export async function parsePurchaseExcelFile(
  file: File,
  existingProducts: readonly Product[],
): Promise<PurchaseExcelImportResult> {
  return parsePurchaseExcelBuffer(await file.arrayBuffer(), existingProducts);
}

export function summarizePurchaseExcelRows(rows: readonly PurchaseExcelImportRow[]) {
  return summarize(rows);
}
