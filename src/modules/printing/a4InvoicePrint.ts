import type { Sale, StoreSettings } from '../../types/models';
import { resolveA4InvoiceSettings } from '../settings/a4InvoiceSettings';

export interface A4InvoicePrintOptions {
  creatorName?: string;
}

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

function productRows(sale: Extract<Sale, { saleKind: 'product' }>, showSku: boolean): string {
  return sale.items.map((item, index) => `
    <tr>
      <td class="center-cell">${index + 1}</td>
      <td>
        <strong>${escapeHtml(item.name)}</strong>
        ${showSku ? `<div class="muted">SKU: ${escapeHtml(item.sku)}</div>` : ''}
      </td>
      <td class="number">${formatQuantity(item.quantity)}</td>
      <td class="number">${formatMoney(item.unitPrice)}</td>
      <td class="number strong">${formatMoney(item.lineTotal)}</td>
    </tr>
  `).join('');
}

function quickServiceRows(sale: Extract<Sale, { saleKind: 'quick_service' }>): string {
  const labels: Record<string, string> = {
    photo: 'Photo',
    printing: 'In ấn',
    scan: 'Scan',
    computer: 'Vi tính',
    stationery: 'Văn phòng phẩm',
    other: 'Dịch vụ khác',
  };
  return `
    <tr>
      <td class="center-cell">1</td>
      <td><strong>${escapeHtml(labels[sale.serviceCategory] || 'Dịch vụ')}</strong></td>
      <td class="number">1</td>
      <td class="number">${formatMoney(sale.total)}</td>
      <td class="number strong">${formatMoney(sale.total)}</td>
    </tr>
  `;
}

export function buildA4InvoiceHtml(
  sale: Sale,
  settings: StoreSettings | null,
  options: A4InvoicePrintOptions = {},
): string {
  const a4 = resolveA4InvoiceSettings(settings?.a4Invoice);
  const storeName = settings?.storeName?.trim() || 'CỬA HÀNG';
  const address = settings?.address?.trim();
  const phone = settings?.phone?.trim();
  const paymentQr = a4.showPaymentQr ? settings?.receipt?.paymentQrImageDataUrl : undefined;
  const rows = sale.saleKind === 'product'
    ? productRows(sale, a4.showSku)
    : quickServiceRows(sale);
  const showSubtotal = sale.discount > 0;

  return `<!doctype html>
<html lang="vi">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(a4.title)} - ${escapeHtml(sale.code)}</title>
<style>
  @page { size: A4 portrait; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; color: #111; background: #fff; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; line-height: 1.45; }
  .sheet { width: 100%; }
  .header { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 20px; align-items: start; }
  .store-name { font-size: 18px; font-weight: 800; text-transform: uppercase; }
  .store-meta { margin-top: 4px; color: #333; }
  .doc-code { text-align: right; color: #444; }
  .title { margin: 22px 0 4px; text-align: center; font-size: 24px; font-weight: 800; }
  .subtitle { text-align: center; color: #555; margin-bottom: 18px; }
  .meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 24px; margin-bottom: 14px; }
  .meta-row { display: flex; gap: 8px; min-width: 0; }
  .meta-row span:first-child { min-width: 92px; color: #555; }
  .meta-row strong, .meta-row span:last-child { overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { border: 1px solid #444; padding: 7px 8px; vertical-align: top; }
  th { text-align: center; background: #f3f3f3; font-weight: 800; }
  th:nth-child(1), td:nth-child(1) { width: 7%; }
  th:nth-child(3), td:nth-child(3) { width: 10%; }
  th:nth-child(4), td:nth-child(4) { width: 18%; }
  th:nth-child(5), td:nth-child(5) { width: 20%; }
  .center-cell { text-align: center; }
  .number { text-align: right; white-space: nowrap; }
  .strong { font-weight: 800; }
  .muted { color: #666; font-size: 11px; margin-top: 2px; }
  .summary-wrap { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 18px; margin-top: 12px; align-items: start; }
  .note-box { border: 1px solid #aaa; min-height: 74px; padding: 9px 10px; overflow-wrap: anywhere; }
  .summary { border: 1px solid #444; }
  .summary-row { display: flex; justify-content: space-between; gap: 16px; padding: 7px 9px; border-bottom: 1px solid #bbb; }
  .summary-row:last-child { border-bottom: 0; }
  .summary-row.total { font-size: 16px; font-weight: 800; }
  .bottom { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 24px; margin-top: 18px; align-items: start; }
  .qr { display: grid; justify-items: center; gap: 6px; text-align: center; }
  .qr img { display: block; width: 34mm; height: 34mm; object-fit: contain; }
  .signatures { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 80px; margin-top: 28px; text-align: center; }
  .signature-space { height: 64px; }
  .footer { margin-top: 24px; text-align: center; color: #444; font-style: italic; }
</style>
</head>
<body>
<div class="sheet">
  <div class="header">
    <div>
      <div class="store-name">${escapeHtml(storeName)}</div>
      ${address ? `<div class="store-meta">Địa chỉ: ${escapeHtml(address)}</div>` : ''}
      ${phone ? `<div class="store-meta">Điện thoại: ${escapeHtml(phone)}</div>` : ''}
    </div>
    <div class="doc-code">
      <div><strong>Mã đơn:</strong> ${escapeHtml(sale.code)}</div>
      <div><strong>Ngày:</strong> ${escapeHtml(formatDateTime(sale.createdAt))}</div>
    </div>
  </div>

  <div class="title">${escapeHtml(a4.title)}</div>
  ${a4.subtitle ? `<div class="subtitle">${escapeHtml(a4.subtitle)}</div>` : ''}

  <div class="meta-grid">
    <div class="meta-row"><span>Khách hàng:</span><strong>${escapeHtml(sale.customerName || 'Khách lẻ')}</strong></div>
    ${a4.showPaymentMethod ? `<div class="meta-row"><span>Thanh toán:</span><span>${escapeHtml(paymentLabel(sale.paymentMethod))}</span></div>` : '<div></div>'}
    ${a4.showCreator && options.creatorName?.trim() ? `<div class="meta-row"><span>Nhân viên:</span><span>${escapeHtml(options.creatorName.trim())}</span></div>` : ''}
  </div>

  <table>
    <thead>
      <tr>
        <th>STT</th>
        <th>Sản phẩm / Dịch vụ</th>
        <th>SL</th>
        <th>Đơn giá</th>
        <th>Thành tiền</th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

  <div class="summary-wrap">
    <div class="note-box"><strong>Ghi chú / địa chỉ khách:</strong><br />${escapeHtml(sale.note || '')}</div>
    <div class="summary">
      ${showSubtotal ? `<div class="summary-row"><span>Tạm tính</span><span>${formatMoney(sale.subtotal)}</span></div>` : ''}
      ${showSubtotal ? `<div class="summary-row"><span>Giảm giá</span><span>-${formatMoney(sale.discount)}</span></div>` : ''}
      <div class="summary-row total"><span>TỔNG CỘNG</span><span>${formatMoney(sale.total)}</span></div>
    </div>
  </div>

  ${paymentQr ? `
  <div class="bottom">
    <div></div>
    <div class="qr">
      <strong>QUÉT MÃ THANH TOÁN</strong>
      <img src="${escapeHtml(paymentQr)}" alt="" />
    </div>
  </div>` : ''}

  ${a4.showSignatures ? `
  <div class="signatures">
    <div><strong>Khách hàng</strong><div class="signature-space"></div><span>(Ký, ghi rõ họ tên)</span></div>
    <div><strong>Người lập phiếu</strong><div class="signature-space"></div><span>(Ký, ghi rõ họ tên)</span></div>
  </div>` : ''}

  <div class="footer">${escapeHtml(a4.footer)}</div>
</div>
</body>
</html>`;
}

export function printA4Invoice(
  sale: Sale,
  settings: StoreSettings | null,
  options: A4InvoicePrintOptions = {},
): Promise<void> {
  if (typeof document === 'undefined') {
    return Promise.reject(new Error('Thiết bị hiện tại không hỗ trợ in A4.'));
  }

  const html = buildA4InvoiceHtml(sale, settings, options);
  const desktop = typeof window !== 'undefined' ? window.minhDienDesktop : undefined;

  if (desktop?.isElectron) {
    return desktop.printA4({ html }).then(() => undefined);
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
        reject(new Error('Không thể mở hộp thoại in A4.'));
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
        reject(new Error('Không thể mở hộp thoại in A4.'));
      }
    };

    frame.srcdoc = html;
    document.body.append(frame);
  });
}
