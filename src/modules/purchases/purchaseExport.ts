import { utils, writeFile, type WorkBook } from 'xlsx';
import type { Purchase, Supplier } from '../../types/models';
import {
  buildPurchaseDetailRows,
  getPurchaseStatusLabel,
  getPurchaseTotals,
  resolveSupplierCode,
} from './purchaseManagementViewModel';

function dateTime(value: number) {
  return Number.isFinite(value)
    ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(value)
    : '';
}

function localDateStamp(value = Date.now()) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function sanitizeFilenamePart(value: string) {
  return value.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_') || 'PHIEU';
}

export function createPurchaseWorkbook(
  purchase: Purchase,
  suppliers: readonly Supplier[],
  creatorDisplay: string,
): WorkBook {
  const workbook = utils.book_new();
  const totals = getPurchaseTotals(purchase);
  const rows = buildPurchaseDetailRows(purchase);
  const supplierCode = resolveSupplierCode(purchase, suppliers);

  const infoSheet = utils.aoa_to_sheet([
    ['Thông tin', 'Giá trị'],
    ['Mã phiếu', purchase.code],
    ['Trạng thái', getPurchaseStatusLabel(purchase.status)],
    ['Thời gian', dateTime(purchase.createdAt)],
    ['Người tạo', creatorDisplay],
    ['Mã NCC', supplierCode],
    ['Nhà cung cấp', purchase.supplierName || ''],
    ['Ghi chú', purchase.note || ''],
    ['Số mặt hàng', totals.itemCount],
    ['Tổng số lượng', totals.totalQuantity],
    ['Tổng tiền', totals.total],
  ]);
  infoSheet['!cols'] = [{ wch: 24 }, { wch: 68 }];

  const detailSheet = utils.json_to_sheet(
    rows.map((item, index) => ({
      STT: index + 1,
      'Mã hàng': item.sku,
      'Tên hàng': item.name,
      'Số lượng': item.quantity,
      'Giá nhập': item.unitCost,
      'Thành tiền': item.lineTotal,
    })),
    { header: ['STT', 'Mã hàng', 'Tên hàng', 'Số lượng', 'Giá nhập', 'Thành tiền'] },
  );
  detailSheet['!cols'] = [
    { wch: 7 },
    { wch: 18 },
    { wch: 42 },
    { wch: 14 },
    { wch: 16 },
    { wch: 18 },
  ];
  detailSheet['!autofilter'] = { ref: `A1:F${Math.max(rows.length + 1, 1)}` };

  utils.book_append_sheet(workbook, infoSheet, 'Thong tin phieu');
  utils.book_append_sheet(workbook, detailSheet, 'Hang nhap');
  return workbook;
}

export function buildPurchaseFilename(purchase: Pick<Purchase, 'code'>) {
  return `PhieuNhap_${sanitizeFilenamePart(purchase.code)}.xlsx`;
}

export function exportPurchaseToExcel(
  purchase: Purchase,
  suppliers: readonly Supplier[],
  creatorDisplay: string,
) {
  writeFile(createPurchaseWorkbook(purchase, suppliers, creatorDisplay), buildPurchaseFilename(purchase), {
    bookType: 'xlsx',
    compression: true,
  });
}

export function createPurchaseListWorkbook(
  purchases: readonly Purchase[],
  suppliers: readonly Supplier[],
  creatorDisplay: (createdBy: string) => string,
): WorkBook {
  if (purchases.length === 0) throw new Error('Không có phiếu nhập phù hợp bộ lọc để xuất.');

  const workbook = utils.book_new();
  const sheet = utils.json_to_sheet(
    purchases.map((purchase, index) => ({
      STT: index + 1,
      'Mã phiếu': purchase.code,
      'Thời gian': dateTime(purchase.createdAt),
      'Mã NCC': resolveSupplierCode(purchase, suppliers),
      'Nhà cung cấp': purchase.supplierName || '',
      'Tổng nhập': Math.round(Number(purchase.total) || 0),
      'Trạng thái': getPurchaseStatusLabel(purchase.status),
      'Người tạo': creatorDisplay(purchase.createdBy),
      'Ghi chú': purchase.note || '',
    })),
    {
      header: ['STT', 'Mã phiếu', 'Thời gian', 'Mã NCC', 'Nhà cung cấp', 'Tổng nhập', 'Trạng thái', 'Người tạo', 'Ghi chú'],
    },
  );
  sheet['!cols'] = [
    { wch: 7 }, { wch: 22 }, { wch: 20 }, { wch: 18 }, { wch: 34 },
    { wch: 18 }, { wch: 16 }, { wch: 24 }, { wch: 42 },
  ];
  sheet['!autofilter'] = { ref: `A1:I${purchases.length + 1}` };
  utils.book_append_sheet(workbook, sheet, 'Danh sach phieu');
  return workbook;
}

export function buildPurchaseListFilename(exportedAt = Date.now()) {
  return `DanhSachPhieuNhap_${localDateStamp(exportedAt)}.xlsx`;
}

export function exportPurchaseListToExcel(
  purchases: readonly Purchase[],
  suppliers: readonly Supplier[],
  creatorDisplay: (createdBy: string) => string,
  exportedAt = Date.now(),
) {
  const workbook = createPurchaseListWorkbook(purchases, suppliers, creatorDisplay);
  writeFile(workbook, buildPurchaseListFilename(exportedAt), { bookType: 'xlsx', compression: true });
}
