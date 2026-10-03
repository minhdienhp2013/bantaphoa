import { read, utils } from 'xlsx';
import type { Product } from '../../types/models';

export type OpeningBalanceRowStatus = 'ready' | 'error' | 'skip';

export interface OpeningBalanceExcelRow {
  rowNumber: number;
  sku: string;
  quantity: number | null;
  productId?: string;
  productName?: string;
  unitCost?: number;
  status: OpeningBalanceRowStatus;
  message: string;
}

export interface OpeningBalanceExcelResult {
  sheetName: string;
  rows: OpeningBalanceExcelRow[];
}

type RawRow = Record<string, unknown>;

const SKU_ALIASES = ['sku', 'mahang', 'masanpham', 'masp', 'mah', 'code'];
const STOCK_ALIASES = ['tonkho', 'soluongton', 'slton', 'ton', 'inventory', 'stockquantity', 'tondauky'];
const COST_ALIASES = ['giavon', 'gianhap', 'costprice', 'cost', 'dongia'];

function normalizeHeader(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]/g, '');
}

function findHeader(headers: string[], aliases: string[]) {
  const accepted = new Set(aliases);
  return headers.find((header) => accepted.has(normalizeHeader(header)));
}

function toText(value: unknown) {
  if (value === null || typeof value === 'undefined') return '';
  return String(value).trim();
}

function toNonNegativeNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
  const text = toText(value);
  if (!text) return null;

  const stripped = text.replace(/[^0-9,.-]/g, '');
  if (!stripped) return null;
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
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export async function parseOpeningBalanceExcel(
  file: File,
  products: Product[],
): Promise<OpeningBalanceExcelResult> {
  const buffer = await file.arrayBuffer();
  const workbook = read(buffer, { type: 'array', cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error('File Excel không có sheet dữ liệu.');

  const sheet = workbook.Sheets[sheetName];
  const rawRows = utils.sheet_to_json<RawRow>(sheet, { defval: '' });
  const headers = rawRows.length > 0 ? Object.keys(rawRows[0]) : [];
  const skuHeader = findHeader(headers, SKU_ALIASES);
  const stockHeader = findHeader(headers, STOCK_ALIASES);
  const costHeader = findHeader(headers, COST_ALIASES);
  if (!skuHeader || !stockHeader) {
    throw new Error('Không tìm thấy cột Mã hàng/SKU và Tồn kho/Tồn đầu kỳ trong file Excel.');
  }

  const productBySku = new Map(products.map((product) => [product.sku.trim().toLocaleLowerCase('vi'), product]));
  const seen = new Set<string>();
  const rows = rawRows.map<OpeningBalanceExcelRow>((row, index) => {
    const sku = toText(row[skuHeader]);
    const normalizedSku = sku.toLocaleLowerCase('vi');
    const quantity = toNonNegativeNumber(row[stockHeader]);
    const unitCost = costHeader ? toNonNegativeNumber(row[costHeader]) : null;
    const product = productBySku.get(normalizedSku);

    if (!sku) {
      return { rowNumber: index + 2, sku, quantity, status: 'skip', message: 'Bỏ qua dòng không có mã hàng.' };
    }
    if (seen.has(normalizedSku)) {
      return { rowNumber: index + 2, sku, quantity, status: 'error', message: 'Mã hàng bị lặp trong file.' };
    }
    seen.add(normalizedSku);
    if (quantity === null) {
      return { rowNumber: index + 2, sku, quantity, status: 'error', message: 'Số lượng tồn không hợp lệ.' };
    }
    if (!product) {
      return { rowNumber: index + 2, sku, quantity, status: 'error', message: 'Không tìm thấy SKU trong danh mục sản phẩm.' };
    }
    if ((Number(product.stockQuantity) || 0) !== 0) {
      return {
        rowNumber: index + 2,
        sku,
        quantity,
        productId: product.id,
        productName: product.name,
        status: 'error',
        message: `Sản phẩm đang có tồn ${product.stockQuantity}; không thể ghi tồn đầu kỳ.`,
      };
    }

    return {
      rowNumber: index + 2,
      sku,
      quantity,
      productId: product.id,
      productName: product.name,
      ...(typeof unitCost === 'number' ? { unitCost } : {}),
      status: quantity === 0 ? 'skip' : 'ready',
      message: quantity === 0 ? 'Tồn bằng 0, không cần tạo movement.' : 'Sẵn sàng ghi tồn đầu kỳ.',
    };
  });

  return { sheetName, rows };
}
