import { utils, writeFile, type WorkBook } from 'xlsx';
import type { Product, Stocktake } from '../../types/models';
import {
  buildStocktakeDetailRows,
  getStocktakeStatusLabel,
  getStocktakeTotals,
} from './stocktakeManagementViewModel';

function dateTime(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return '';
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(value);
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

export function createStocktakeWorkbook(
  stocktake: Stocktake,
  products: readonly Product[],
  creatorDisplay: string,
): WorkBook {
  const workbook = utils.book_new();
  const totals = getStocktakeTotals(stocktake);
  const detailRows = buildStocktakeDetailRows(stocktake, products);

  const infoSheet = utils.aoa_to_sheet([
    ['Thông tin', 'Giá trị'],
    ['Mã phiếu', stocktake.code],
    ['Trạng thái', getStocktakeStatusLabel(stocktake.status)],
    ['Ngày tạo', dateTime(stocktake.createdAt)],
    ['Ngày chốt', dateTime(stocktake.completedAt)],
    ['Người tạo', creatorDisplay],
    ['Ghi chú', stocktake.note || ''],
    ['Số mặt hàng', totals.itemCount],
    ['Mặt hàng khớp', totals.matchedCount],
    ['Mặt hàng thiếu', totals.shortageCount],
    ['Mặt hàng thừa', totals.surplusCount],
    ['Tổng tồn hệ thống', totals.systemQuantity],
    ['Tổng thực tế', totals.actualQuantity],
    ['Tổng chênh lệch', totals.difference],
  ]);
  infoSheet['!cols'] = [{ wch: 24 }, { wch: 70 }];

  const detailSheet = utils.json_to_sheet(
    detailRows.map((row, index) => ({
      STT: index + 1,
      'Mã hàng': row.sku,
      'Tên hàng': row.name,
      'Đơn vị tính': row.unit,
      'Tồn hệ thống': row.systemQuantity,
      'Kiểm kê thực tế': row.actualQuantity,
      'Chênh lệch': row.difference,
      'Kết quả': row.result,
    })),
    {
      header: ['STT', 'Mã hàng', 'Tên hàng', 'Đơn vị tính', 'Tồn hệ thống', 'Kiểm kê thực tế', 'Chênh lệch', 'Kết quả'],
    },
  );
  detailSheet['!cols'] = [
    { wch: 7 },
    { wch: 18 },
    { wch: 38 },
    { wch: 14 },
    { wch: 16 },
    { wch: 14 },
    { wch: 14 },
    { wch: 12 },
  ];
  detailSheet['!autofilter'] = { ref: `A1:H${Math.max(detailRows.length + 1, 1)}` };

  utils.book_append_sheet(workbook, infoSheet, 'Thong tin phieu');
  utils.book_append_sheet(workbook, detailSheet, 'Kiem ke');
  return workbook;
}

export function buildStocktakeFilename(stocktake: Pick<Stocktake, 'code'>) {
  return `KiemKe_${sanitizeFilenamePart(stocktake.code)}.xlsx`;
}

export function exportStocktakeToExcel(
  stocktake: Stocktake,
  products: readonly Product[],
  creatorDisplay: string,
) {
  const workbook = createStocktakeWorkbook(stocktake, products, creatorDisplay);
  writeFile(workbook, buildStocktakeFilename(stocktake), { bookType: 'xlsx', compression: true });
}

export function createStocktakeListWorkbook(stocktakes: readonly Stocktake[]): WorkBook {
  if (stocktakes.length === 0) throw new Error('Không có phiếu kiểm kê phù hợp để xuất.');

  const workbook = utils.book_new();
  const sheet = utils.json_to_sheet(
    stocktakes.map((stocktake, index) => {
      const totals = getStocktakeTotals(stocktake);
      return {
        STT: index + 1,
        'Mã phiếu': stocktake.code,
        'Ngày tạo': dateTime(stocktake.createdAt),
        'Trạng thái': getStocktakeStatusLabel(stocktake.status),
        'Số mặt hàng': totals.itemCount,
        'Tổng tồn hệ thống': totals.systemQuantity,
        'Tổng thực tế': totals.actualQuantity,
        'Tổng chênh lệch': totals.difference,
        'Ghi chú': stocktake.note || '',
      };
    }),
    {
      header: [
        'STT',
        'Mã phiếu',
        'Ngày tạo',
        'Trạng thái',
        'Số mặt hàng',
        'Tổng tồn hệ thống',
        'Tổng thực tế',
        'Tổng chênh lệch',
        'Ghi chú',
      ],
    },
  );

  sheet['!cols'] = [
    { wch: 7 },
    { wch: 24 },
    { wch: 20 },
    { wch: 14 },
    { wch: 14 },
    { wch: 18 },
    { wch: 16 },
    { wch: 18 },
    { wch: 42 },
  ];
  sheet['!autofilter'] = { ref: `A1:I${stocktakes.length + 1}` };
  utils.book_append_sheet(workbook, sheet, 'Danh sach phieu');
  return workbook;
}

export function buildStocktakeListFilename(exportedAt = Date.now()) {
  return `DanhSachPhieuKiemKe_${localDateStamp(exportedAt)}.xlsx`;
}

export function exportStocktakeListToExcel(stocktakes: readonly Stocktake[], exportedAt = Date.now()) {
  const workbook = createStocktakeListWorkbook(stocktakes);
  writeFile(workbook, buildStocktakeListFilename(exportedAt), { bookType: 'xlsx', compression: true });
}
