import { utils, writeFile, type WorkBook, type WorkSheet } from 'xlsx';

export const PURCHASE_EXCEL_TEMPLATE_HEADERS = [
  'Tên hàng',
  'Mã hàng',
  'Mã vạch',
  'Đơn vị',
  'Số lượng nhập',
  'Giá nhập',
  'Giá bán',
  'Tồn tối thiểu',
  'Mã QR',
] as const;

function forceTextColumns(sheet: WorkSheet, rowCount = 100) {
  const identifierColumns = [1, 2, 8];
  for (let row = 1; row <= rowCount; row += 1) {
    for (const column of identifierColumns) {
      const address = utils.encode_cell({ r: row, c: column });
      sheet[address] = { t: 's', v: '', z: '@' };
    }
  }
  sheet['!ref'] = `A1:I${rowCount + 1}`;
}

export function createPurchaseExcelTemplateWorkbook(): WorkBook {
  const workbook = utils.book_new();
  const sheet = utils.aoa_to_sheet([[...PURCHASE_EXCEL_TEMPLATE_HEADERS]]);
  forceTextColumns(sheet);
  sheet['!cols'] = [
    { wch: 36 },
    { wch: 18 },
    { wch: 22 },
    { wch: 14 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 16 },
    { wch: 22 },
  ];

  const guide = utils.aoa_to_sheet([
    ['HƯỚNG DẪN NHẬP HÀNG BẰNG EXCEL'],
    ['1', 'Không đổi tên sheet “Nhap hang”.'],
    ['2', 'Mã hàng, Mã vạch và Mã QR nên để định dạng TEXT để giữ số 0 đầu, mã dài và ký tự + . * -.'],
    ['3', 'Nếu Mã hàng để trống, hệ thống chỉ sinh mã cho HÀNG MỚI bằng shared legacy Product code contract.'],
    ['4', 'Số lượng nhập phải > 0. Giá nhập/Giá bán/Tồn tối thiểu không được âm.'],
    ['5', 'Import chỉ chuẩn bị phiếu nhập. Tồn kho KHÔNG thay đổi cho tới khi bấm “Hoàn tất nhập hàng”.'],
    ['6', 'Hàng mới chỉ được tạo sau bước preview và xác nhận rõ ràng. Product mới bắt đầu với tồn 0.'],
  ]);
  guide['!cols'] = [{ wch: 10 }, { wch: 110 }];

  utils.book_append_sheet(workbook, sheet, 'Nhap hang');
  utils.book_append_sheet(workbook, guide, 'Huong dan');
  return workbook;
}

export function downloadPurchaseExcelTemplate() {
  writeFile(createPurchaseExcelTemplateWorkbook(), 'mau-nhap-hang.xlsx', {
    bookType: 'xlsx',
    compression: true,
  });
}
