import type { ReceiptPaperSize, Sale, StoreSettings } from '../../types/models';
import { DEFAULT_RECEIPT_SETTINGS, resolveReceiptSettings } from '../settings/receiptSettings';

export type { ReceiptPaperSize } from '../../types/models';

export interface ReceiptPrintOptions {
  paperSize?: ReceiptPaperSize;
  creatorName?: string;
}

const RECEIPT_PAPER_STORAGE_KEY = 'quan-ly-ban-hang.receipt-paper-size.v1';
const DEFAULT_RECEIPT_PAPER_SIZE: ReceiptPaperSize = '80mm';

const QUICK_SERVICE_LABELS: Record<string, string> = {
  photo: 'Photo',
  printing: 'In ấn',
  scan: 'Scan',
  computer: 'Vi tính',
  stationery: 'Văn phòng phẩm',
  other: 'Dịch vụ khác',
};

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatMoney(value: number): string {
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(value)} đ`;
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value);
}

function formatDateTime(value: number): string {
  return new Intl.DateTimeFormat('vi-VN', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(value);
}

function paymentLabel(value: Sale['paymentMethod']): string {
  if (value === 'bank_transfer') return 'Chuyển khoản';
  if (value === 'other') return 'Khác';
  return 'Tiền mặt';
}

function statusLabel(sale: Sale): string | null {
  if (sale.status === 'cancelled') return 'ĐÃ HỦY';
  if (sale.saleKind === 'product' && sale.status === 'refunded') return 'ĐÃ HOÀN';
  return null;
}

function paperWidthMm(paperSize: ReceiptPaperSize): number {
  return paperSize === '58mm' ? 58 : 80;
}

function contentWidthMm(paperSize: ReceiptPaperSize): number {
  return paperSize === '58mm' ? 54 : 78;
}

function productRows(sale: Extract<Sale, { saleKind: 'product' }>, showSku = true): string {
  return sale.items.map((item) => `
    <tr>
      <td class="item-name">
        <strong>${escapeHtml(item.name)}</strong>
        ${showSku ? `<span>${escapeHtml(item.sku)}</span>` : ''}
        <span>${formatQuantity(item.quantity)} × ${formatMoney(item.unitPrice)}</span>
      </td>
      <td class="amount">${formatMoney(item.lineTotal)}</td>
    </tr>
  `).join('');
}

function quickServiceRows(sale: Extract<Sale, { saleKind: 'quick_service' }>): string {
  const label = QUICK_SERVICE_LABELS[sale.serviceCategory] || 'Dịch vụ';
  return `
    <tr>
      <td class="item-name">
        <strong>${escapeHtml(label)}</strong>
        <span>Dịch vụ bán nhanh</span>
      </td>
      <td class="amount">${formatMoney(sale.total)}</td>
    </tr>
  `;
}

export function readReceiptPaperSize(): ReceiptPaperSize {
  try {
    return localStorage.getItem(RECEIPT_PAPER_STORAGE_KEY) === '58mm' ? '58mm' : DEFAULT_RECEIPT_PAPER_SIZE;
  } catch {
    return DEFAULT_RECEIPT_PAPER_SIZE;
  }
}

export function saveReceiptPaperSize(value: ReceiptPaperSize): void {
  try {
    localStorage.setItem(RECEIPT_PAPER_STORAGE_KEY, value);
  } catch {
    // Printing remains usable even when storage is unavailable.
  }
}

export function buildSaleReceiptHtml(
  sale: Sale,
  settings: StoreSettings | null,
  options: ReceiptPrintOptions = {},
): string {
  const receiptSettings = resolveReceiptSettings(settings?.receipt);
  const paperSize = options.paperSize ?? receiptSettings.defaultPaperSize ?? DEFAULT_RECEIPT_PAPER_SIZE;
  const widthMm = paperWidthMm(paperSize);
  const receiptWidthMm = contentWidthMm(paperSize);
  const storeName = settings?.storeName?.trim() || 'CỬA HÀNG';
  const address = settings?.address?.trim();
  const phone = settings?.phone?.trim();
  const rows = sale.saleKind === 'product' ? productRows(sale, receiptSettings.showSku) : quickServiceRows(sale);
  const showSubtotal = sale.discount > 0;
  const status = statusLabel(sale);
  const paymentQrImageDataUrl = receiptSettings.paymentQrImageDataUrl;

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(sale.code)}</title>
<style>
  @page { size: ${widthMm}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: #fff; color: #000; }
  body {
    width: ${receiptWidthMm}mm;
    max-width: ${receiptWidthMm}mm;
    margin: 0 auto;
    padding: ${paperSize === '58mm' ? '2mm' : '2.5mm'};
    font-family: Arial, Helvetica, sans-serif;
    font-size: ${paperSize === '58mm' ? '11px' : '12px'};
    line-height: 1.35;
  }
  .center { text-align: center; }
  .store { font-size: ${paperSize === '58mm' ? '15px' : '18px'}; font-weight: 800; }
  .muted { font-size: 0.92em; }
  .title { margin-top: 5px; font-size: ${paperSize === '58mm' ? '13px' : '15px'}; font-weight: 800; }
  .status { margin-top: 2px; font-weight: 800; }
  .line { border-top: 1px dashed #000; margin: 6px 0; }
  .meta { display: grid; gap: 2px; }
  .meta-row { display: flex; justify-content: space-between; gap: 8px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 4px 0; vertical-align: top; }
  .item-name { padding-right: 5px; }
  .item-name span { display: block; font-size: 0.92em; }
  .amount { width: 32%; text-align: right; white-space: nowrap; }
  .summary { display: grid; gap: 3px; }
  .summary-row { display: flex; justify-content: space-between; gap: 8px; }
  .summary-row.total { font-size: ${paperSize === '58mm' ? '14px' : '16px'}; font-weight: 800; }
  .note { overflow-wrap: anywhere; }
  .payment-qr { display: grid; justify-items: center; gap: 4px; margin: 7px 0 2px; text-align: center; }
  .payment-qr strong { font-size: 0.95em; }
  .payment-qr img { display: block; width: ${paperSize === '58mm' ? '30mm' : '34mm'}; max-width: 100%; height: auto; }
  .footer { margin-top: 8px; text-align: center; font-size: 0.95em; }
</style>
</head>
<body>
  <div class="center store">${escapeHtml(storeName)}</div>
  ${address ? `<div class="center muted">${escapeHtml(address)}</div>` : ''}
  ${phone ? `<div class="center muted">ĐT: ${escapeHtml(phone)}</div>` : ''}
  <div class="center title">${escapeHtml(receiptSettings.title || DEFAULT_RECEIPT_SETTINGS.title)}</div>
  ${status ? `<div class="center status">${escapeHtml(status)}</div>` : ''}

  <div class="line"></div>
  <div class="meta">
    <div class="meta-row"><span>Mã đơn</span><strong>${escapeHtml(sale.code)}</strong></div>
    <div class="meta-row"><span>Ngày</span><span>${escapeHtml(formatDateTime(sale.createdAt))}</span></div>
    <div class="meta-row"><span>Khách</span><span>${escapeHtml(sale.customerName || 'Khách lẻ')}</span></div>
    ${receiptSettings.showPaymentMethod ? `<div class="meta-row"><span>Phương thức</span><span>${escapeHtml(paymentLabel(sale.paymentMethod))}</span></div>` : ''}
    ${receiptSettings.showCreator && options.creatorName?.trim() ? `<div class="meta-row"><span>Nhân viên</span><span>${escapeHtml(options.creatorName.trim())}</span></div>` : ''}
  </div>

  <div class="line"></div>
  <table><tbody>${rows}</tbody></table>
  <div class="line"></div>

  <div class="summary">
    ${showSubtotal ? `<div class="summary-row"><span>Tạm tính</span><span>${formatMoney(sale.subtotal)}</span></div>` : ''}
    ${showSubtotal ? `<div class="summary-row"><span>Giảm giá</span><span>-${formatMoney(sale.discount)}</span></div>` : ''}
    <div class="summary-row total"><span>TỔNG CỘNG</span><span>${formatMoney(sale.total)}</span></div>
  </div>

  ${sale.note ? `<div class="line"></div><div class="note"><strong>Ghi chú:</strong> ${escapeHtml(sale.note)}</div>` : ''}

  ${paymentQrImageDataUrl ? `
    <div class="line"></div>
    <div class="payment-qr">
      <strong>QUÉT MÃ THANH TOÁN</strong>
      <img src="${escapeHtml(paymentQrImageDataUrl)}" alt="" />
    </div>
  ` : ''}

  <div class="line"></div>
  <div class="footer">${escapeHtml(receiptSettings.footer || DEFAULT_RECEIPT_SETTINGS.footer)}</div>
</body>
</html>`;
}

export function printSaleReceipt(
  sale: Sale,
  settings: StoreSettings | null,
  options: ReceiptPrintOptions = {},
): Promise<void> {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('Thiết bị hiện tại không hỗ trợ in hóa đơn.'));
  }

  const html = buildSaleReceiptHtml(sale, settings, options);
  const receiptSettings = resolveReceiptSettings(settings?.receipt);
  const paperSize = options.paperSize ?? receiptSettings.defaultPaperSize ?? DEFAULT_RECEIPT_PAPER_SIZE;
  const desktop = typeof window !== 'undefined' ? window.minhDienDesktop : undefined;

  if (desktop?.isElectron) {
    return desktop.printReceipt({ html, paperSize }).then(() => undefined);
  }

  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.style.position = 'fixed';
    frame.style.right = '0';
    frame.style.bottom = '0';
    frame.style.width = '1px';
    frame.style.height = '1px';
    frame.style.border = '0';
    frame.style.opacity = '0';
    frame.style.pointerEvents = 'none';

    let cleanupTimer: number | undefined;
    const cleanup = () => {
      if (typeof cleanupTimer === 'number') window.clearTimeout(cleanupTimer);
      frame.remove();
    };

    frame.onload = () => {
      const target = frame.contentWindow;
      if (!target || typeof target.print !== 'function') {
        cleanup();
        reject(new Error('Trình duyệt này không hỗ trợ hộp thoại in hóa đơn.'));
        return;
      }

      try {
        target.addEventListener('afterprint', cleanup, { once: true });
        cleanupTimer = window.setTimeout(cleanup, 60_000);
        target.focus();
        target.print();
        resolve();
      } catch {
        cleanup();
        reject(new Error('Không thể mở hộp thoại in. Hãy kiểm tra trình duyệt và máy in.'));
      }
    };

    frame.srcdoc = html;
    document.body.append(frame);
  });
}
