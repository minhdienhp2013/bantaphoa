import * as XLSX from 'xlsx';
import { QUICK_SERVICE_CATEGORY_LABELS } from '../settings/quickServiceProfitRates';
import type { ReportBundle } from './reportService';
import { getProductSaleSnapshotCost, getQuickServiceEstimatedProfit } from './reportService';

function dateTime(value: number) {
  return Number.isFinite(value)
    ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(value)
    : '';
}

function paymentMethodLabel(value: string | undefined) {
  if (value === 'cash') return 'Tiền mặt';
  if (value === 'bank_transfer') return 'Chuyển khoản';
  if (value === 'other') return 'Khác';
  return 'Chưa ghi nhận';
}

function productSaleItemsLabel(items: readonly { name: string; sku: string; quantity: number }[]) {
  return items
    .filter((item) => item.name.trim())
    .map((item) => {
      const quantity = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(item.quantity);
      return `${item.name}${item.sku ? ` [${item.sku}]` : ''} ×${quantity}`;
    })
    .join('; ');
}

function addSheet(workbook: XLSX.WorkBook, name: string, rows: Record<string, string | number | boolean>[]) {
  const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 'Thông tin': 'Không có dữ liệu' }]);
  XLSX.utils.book_append_sheet(workbook, sheet, name.slice(0, 31));
}

function isoDate(value: number) {
  const date = new Date(value);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function buildSalesRowsForRange(bundle: ReportBundle) {
  return bundle.sales
    .filter((sale) => sale.createdAt >= bundle.range.from && sale.createdAt <= bundle.range.to)
    .map((sale) => {
      if (sale.saleKind === 'product') {
        const cost = getProductSaleSnapshotCost(sale);
        return [
          dateTime(sale.createdAt),
          'Hàng hóa',
          productSaleItemsLabel(sale.items),
          sale.code,
          sale.customerName || 'Khách lẻ',
          sale.creatorName,
          paymentMethodLabel(sale.paymentMethod),
          sale.note || '',
          sale.total,
          cost,
          sale.total - cost,
          '',
          '',
        ];
      }

      return [
        dateTime(sale.createdAt),
        `Dịch vụ · ${QUICK_SERVICE_CATEGORY_LABELS[sale.serviceCategory]}`,
        '',
        sale.code,
        sale.customerName || 'Khách lẻ',
        sale.creatorName,
        paymentMethodLabel(sale.paymentMethod),
        sale.note || '',
        sale.total,
        '',
        '',
        sale.estimatedProfitRatePercent,
        getQuickServiceEstimatedProfit(sale),
      ];
    });
}

function addDetailedSalesSheet(workbook: XLSX.WorkBook, bundle: ReportBundle) {
  const headers = [
    'Thời gian',
    'Loại giao dịch',
    'Mặt hàng đã bán',
    'Mã',
    'Khách hàng',
    'Người khởi tạo',
    'Thanh toán',
    'Ghi chú',
    'Doanh thu',
    'Giá vốn hàng hóa',
    'LN thực hàng hóa',
    'Tỷ lệ LN dịch vụ',
    'LN ước tính dịch vụ',
  ];
  const salesRows = buildSalesRowsForRange(bundle);
  const rows: (string | number)[][] = [
    ['BÁN HÀNG VÀ DỊCH VỤ'],
    ['Khoảng thời gian', bundle.range.label],
    ['Số giao dịch', salesRows.length],
    [],
    headers,
    ...(salesRows.length ? salesRows : [['Không có giao dịch completed trong khoảng thời gian này.']]),
  ];

  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet['!merges'] = [XLSX.utils.decode_range('A1:M1')];
  sheet['!cols'] = [
    { wch: 18 },
    { wch: 24 },
    { wch: 52 },
    { wch: 22 },
    { wch: 20 },
    { wch: 20 },
    { wch: 18 },
    { wch: 32 },
    { wch: 16 },
    { wch: 18 },
    { wch: 18 },
    { wch: 18 },
    { wch: 20 },
  ];
  sheet['!autofilter'] = { ref: `A5:M${Math.max(5, salesRows.length + 5)}` };
  XLSX.utils.book_append_sheet(workbook, sheet, 'Ban hang va dich vu');
}

export function exportReportExcel(bundle: ReportBundle) {
  const workbook = XLSX.utils.book_new();

  // Keep the detailed sales/service sheet first so the exported workbook opens
  // directly on the exact transaction list for the selected report range.
  addDetailedSalesSheet(workbook, bundle);

  addSheet(workbook, 'Tong quan', [
    {
      'Khoảng báo cáo': bundle.range.label,
      'Tổng doanh thu': bundle.summary.totalRevenue,
      'Doanh thu hàng hóa': bundle.summary.productRevenue,
      'Giá vốn hàng hóa': bundle.summary.productCostOfGoods,
      'Lợi nhuận gộp thực hàng hóa': bundle.summary.productActualGrossProfit,
      'Doanh thu dịch vụ': bundle.summary.serviceRevenue,
      'Lợi nhuận ước tính dịch vụ': bundle.summary.serviceEstimatedProfit,
      'Lợi nhuận tổng hợp trước chi phí (gồm ước tính dịch vụ)': bundle.summary.combinedProfitBeforeExpenses,
      'Chi phí': bundle.summary.expenseTotal,
      'Lãi vay đã trả (chi phí tài chính)': bundle.summary.loanInterestExpense,
      'Trả gốc vay (không tính chi phí)': bundle.summary.loanPrincipalCashOutflow,
      'Lợi nhuận ròng tổng hợp ước tính': bundle.summary.combinedNetProfitEstimate,
      'Số giao dịch hoàn tất': bundle.summary.completedSales,
    },
    {
      'Khoảng báo cáo': 'Tồn hiện tại',
      'Tổng doanh thu': 0,
      'Doanh thu hàng hóa': 0,
      'Giá vốn hàng hóa': 0,
      'Lợi nhuận gộp thực hàng hóa': 0,
      'Doanh thu dịch vụ': 0,
      'Lợi nhuận ước tính dịch vụ': 0,
      'Lợi nhuận tổng hợp trước chi phí (gồm ước tính dịch vụ)': 0,
      'Chi phí': 0,
      'Lãi vay đã trả (chi phí tài chính)': 0,
      'Trả gốc vay (không tính chi phí)': 0,
      'Lợi nhuận ròng tổng hợp ước tính': bundle.summary.inventoryValue,
      'Số giao dịch hoàn tất': bundle.summary.inventoryQuantity,
    },
  ]);

  addSheet(workbook, 'Chi phi', bundle.expenses.map((item) => ({
    'Mã': item.code,
    'Ngày': dateTime(item.expenseDate),
    'Danh mục': item.category,
    'Số tiền': Number(item.amount) || 0,
    'Ghi chú': item.note || '',
  })));

  addSheet(workbook, 'Ton kho', bundle.inventory.map((item) => ({
    'SKU': item.sku,
    'Tên sản phẩm': item.name,
    'Đơn vị': item.unit || '',
    'Tồn hiện tại': item.stockQuantity,
    'Tồn tối thiểu': item.minStock ?? '',
    'Trạng thái': item.status === 'out' ? 'Hết hàng' : item.status === 'low' ? 'Sắp hết' : 'Bình thường',
    'Giá vốn hiện tại': item.currentUnitCost,
    'Giá trị tồn hiện tại': item.currentInventoryValue,
  })));

  addSheet(workbook, 'Nhap hang', bundle.purchases.map((item) => ({
    'Mã phiếu': item.code,
    'Thời gian': dateTime(item.createdAt),
    'Nhà cung cấp': item.supplierName || '',
    'Tổng nhập': Number(item.total) || 0,
  })));

  addSheet(workbook, 'Xuat kho', bundle.stockOuts.map((item) => ({
    'Mã phiếu': item.code,
    'Thời gian': dateTime(item.createdAt),
    'Lý do': item.reason,
    'Số dòng hàng': Array.isArray(item.items) ? item.items.length : Object.keys(item.items || {}).length,
  })));

  addSheet(workbook, 'Bien dong kho', bundle.movements.map((item) => ({
    'Thời gian': dateTime(item.createdAt),
    'Nghiệp vụ': item.type,
    'Product ID': item.productId,
    'Thay đổi': Number(item.quantityDelta) || 0,
    'Trước': Number(item.quantityBefore) || 0,
    'Sau': Number(item.quantityAfter) || 0,
    'Giá vốn snapshot': typeof item.unitCost === 'number' ? item.unitCost : '',
    'Tham chiếu': item.referenceId || '',
  })));

  addSheet(workbook, 'Khach hang', bundle.customers.map((item) => ({
    'Khách hàng': item.customerName,
    'Số giao dịch': item.orderCount,
    'Tổng doanh thu': item.totalRevenue,
    'Doanh thu hàng hóa': item.productRevenue,
    'Doanh thu dịch vụ': item.serviceRevenue,
    'Giá vốn hàng hóa': item.productCostOfGoods,
    'Lợi nhuận thực hàng hóa': item.productActualGrossProfit,
    'Lợi nhuận ước tính dịch vụ': item.serviceEstimatedProfit,
    'Lợi nhuận tổng hợp ước tính (gồm phần ước tính dịch vụ)': item.combinedProfitEstimate,
  })));

  addSheet(workbook, 'Nha cung cap', bundle.suppliers.map((item) => ({
    'Nhà cung cấp': item.supplierName,
    'Số phiếu nhập': item.purchaseCount,
    'Giá trị nhập': item.purchaseTotal,
  })));

  if (bundle.debtFinance) {
    addSheet(workbook, 'Cong no tong hop', [
      {
        'Chỉ tiêu': 'Phải thu hiện tại',
        'Số tiền': bundle.debtFinance.receivable.totalOutstanding,
      },
      {
        'Chỉ tiêu': 'Phải thu quá hạn',
        'Số tiền': bundle.debtFinance.receivable.overdueAmount,
      },
      {
        'Chỉ tiêu': 'Phải trả hiện tại',
        'Số tiền': bundle.debtFinance.payable.totalOutstanding,
      },
      {
        'Chỉ tiêu': 'Phải trả quá hạn',
        'Số tiền': bundle.debtFinance.payable.overdueAmount,
      },
      {
        'Chỉ tiêu': 'Dư nợ gốc vay',
        'Số tiền': bundle.debtFinance.loans.principalOutstanding,
      },
      {
        'Chỉ tiêu': 'Lãi kế hoạch còn lại',
        'Số tiền': bundle.debtFinance.loans.plannedInterestOutstanding,
      },
      {
        'Chỉ tiêu': 'Thu công nợ khách trong kỳ (ròng)',
        'Số tiền': bundle.debtFinance.receivableCollectedNet,
      },
      {
        'Chỉ tiêu': 'Trả công nợ NCC trong kỳ (ròng)',
        'Số tiền': bundle.debtFinance.payablePaidNet,
      },
      {
        'Chỉ tiêu': 'Trả gốc vay trong kỳ (ròng, không tính chi phí)',
        'Số tiền': bundle.debtFinance.loanPrincipalPaidNet,
      },
      {
        'Chỉ tiêu': 'Trả lãi vay trong kỳ (ròng, chi phí tài chính)',
        'Số tiền': bundle.debtFinance.loanInterestPaidNet,
      },
    ]);

    addSheet(workbook, 'Thanh toan cong no', bundle.debtFinance.debtPayments.map((item) => ({
      'Thời gian': dateTime(item.createdAt),
      'Loại': item.debtKind === 'receivable' ? 'Phải thu' : 'Phải trả',
      'Sự kiện': item.eventType === 'payment' ? 'Thanh toán' : 'Hoàn tác',
      'Debt ID': item.debtId,
      'Số tiền': item.eventType === 'reversal' ? -item.amount : item.amount,
      'Phương thức': item.paymentMethod,
      'Ghi chú': item.note || '',
    })));

    addSheet(workbook, 'Tra vay', bundle.debtFinance.loanPayments.map((item) => ({
      'Thời gian': dateTime(item.createdAt),
      'Sự kiện': item.eventType === 'payment' ? 'Trả vay' : 'Hoàn tác',
      'Loan ID': item.loanId,
      'Gốc': item.eventType === 'reversal' ? -item.principalAmount : item.principalAmount,
      'Lãi': item.eventType === 'reversal' ? -item.interestAmount : item.interestAmount,
      'Phương thức': item.paymentMethod,
      'Ghi chú': item.note || '',
    })));
  }

  const from = isoDate(bundle.range.from);
  const to = isoDate(bundle.range.to);
  const rangeStamp = from === to ? from : `${from}-den-${to}`;
  XLSX.writeFile(workbook, `ban-hang-va-dich-vu-${rangeStamp}.xlsx`, { compression: true });
}
