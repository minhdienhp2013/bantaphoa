import { utils, writeFile, type WorkBook } from 'xlsx';
import type { Category, Product } from '../../types/models';

export const PRODUCT_EXCEL_FORMAT = 'PRODUCT_EXCEL_V2';

export const PRODUCT_EXCEL_HEADERS = [
  'Mã hàng',
  'Tên hàng',
  'Tên gọi khác',
  'Danh mục',
  'Barcode',
  'Mã QR',
  'Đơn vị tính',
  'Giá vốn',
  'Giá bán',
  'Tồn tối thiểu',
  'Tồn kho',
  'Trạng thái',
  'Ngày tạo',
  'Cập nhật gần nhất',
] as const;

const STOCK_SNAPSHOT_NOTE = 'Tồn kho trong file Excel chỉ là snapshot phục vụ lưu trữ/đối chiếu. Import Product không ghi trực tiếp tồn kho.';

type ProductExcelHeader = (typeof PRODUCT_EXCEL_HEADERS)[number];
type ProductExcelCell = string | number;
type ProductExcelRow = Record<ProductExcelHeader, ProductExcelCell>;

function formatTimestamp(value: number) {
  if (!Number.isFinite(value)) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

export function buildProductExcelRows(products: readonly Product[], categories: readonly Category[] = []): ProductExcelRow[] {
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name] as const));
  return products.map((product) => ({
    'Mã hàng': product.sku,
    'Tên hàng': product.name,
    'Tên gọi khác': (product.aliases ?? []).join('; '),
    'Danh mục': product.categoryId ? (categoryNameById.get(product.categoryId) ?? '') : '',
    Barcode: product.barcode || '',
    'Mã QR': product.qrCode || '',
    'Đơn vị tính': product.unit || '',
    'Giá vốn': product.costPrice,
    'Giá bán': product.salePrice,
    'Tồn tối thiểu': typeof product.minStock === 'number' ? product.minStock : '',
    'Tồn kho': product.stockQuantity,
    'Trạng thái': product.active ? 'Đang kinh doanh' : 'Ngừng kinh doanh',
    'Ngày tạo': formatTimestamp(product.createdAt),
    'Cập nhật gần nhất': formatTimestamp(product.updatedAt),
  }));
}

export function createProductExcelWorkbook(
  products: readonly Product[],
  categoriesOrExportedAt: readonly Category[] | number = [],
  exportedAtInput = Date.now(),
): WorkBook {
  const categories = Array.isArray(categoriesOrExportedAt) ? categoriesOrExportedAt : [];
  const exportedAt = typeof categoriesOrExportedAt === 'number' ? categoriesOrExportedAt : exportedAtInput;
  const workbook = utils.book_new();
  const productSheet = utils.json_to_sheet(buildProductExcelRows(products, categories), {
    header: [...PRODUCT_EXCEL_HEADERS],
  });

  productSheet['!cols'] = [
    { wch: 16 },
    { wch: 34 },
    { wch: 34 },
    { wch: 22 },
    { wch: 18 },
    { wch: 18 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 16 },
    { wch: 14 },
    { wch: 20 },
    { wch: 24 },
    { wch: 24 },
  ];

  const activeCount = products.filter((product) => product.active).length;
  const infoSheet = utils.aoa_to_sheet([
    ['Định dạng', PRODUCT_EXCEL_FORMAT],
    ['Thời gian xuất', formatTimestamp(exportedAt)],
    ['Tổng hàng hóa', products.length],
    ['Đang kinh doanh', activeCount],
    ['Ngừng kinh doanh', products.length - activeCount],
    ['Ghi chú', STOCK_SNAPSHOT_NOTE],
  ]);
  infoSheet['!cols'] = [{ wch: 22 }, { wch: 100 }];

  utils.book_append_sheet(workbook, productSheet, 'Hang hoa');
  utils.book_append_sheet(workbook, infoSheet, 'Thong tin');
  return workbook;
}

export function buildProductExcelFilename(exportedAt = Date.now()) {
  const date = new Date(exportedAt);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `hang-hoa-${year}-${month}-${day}.xlsx`;
}

export function exportProductsToExcel(products: readonly Product[], categories: readonly Category[] = [], exportedAt = Date.now()) {
  const workbook = createProductExcelWorkbook(products, categories, exportedAt);
  writeFile(workbook, buildProductExcelFilename(exportedAt), {
    bookType: 'xlsx',
    compression: true,
  });
}