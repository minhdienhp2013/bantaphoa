import type { AppUser, Purchase, Supplier } from '../../types/models';
import {
  buildPurchaseDetailRows,
  getPurchaseActionCapabilities,
  getPurchaseStatusLabel,
  getPurchaseTotals,
  resolveCreatorDisplay,
  resolveSupplierCode,
} from './purchaseManagementViewModel';

interface PurchaseDetailPanelProps {
  purchase: Purchase;
  suppliers: readonly Supplier[];
  appUser: AppUser | null;
  busy: boolean;
  onCollapse: () => void;
  onExport: (purchase: Purchase) => void;
  onPrint: (purchase: Purchase) => void;
  onCopy: (purchase: Purchase) => void;
  onCancel: (purchase: Purchase) => void;
}

function money(value: number) {
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.round(value))} đ`;
}

function quantity(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value);
}

function dateTime(value: number) {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(value);
}

export default function PurchaseDetailPanel({
  purchase,
  suppliers,
  appUser,
  busy,
  onCollapse,
  onExport,
  onPrint,
  onCopy,
  onCancel,
}: PurchaseDetailPanelProps) {
  const detailId = `purchase-detail-${purchase.id}`;
  const titleId = `${detailId}-title`;
  const rows = buildPurchaseDetailRows(purchase);
  const totals = getPurchaseTotals(purchase);
  const actions = getPurchaseActionCapabilities(purchase.status);
  const supplierCode = resolveSupplierCode(purchase, suppliers);

  return (
    <section id={detailId} className="purchase-detail" role="region" aria-labelledby={titleId}>
      <div className="purchase-detail-heading">
        <div>
          <span>Phiếu nhập</span>
          <div className="purchase-detail-title-line"><h3 id={titleId}>{purchase.code}</h3><span className={`purchase-status purchase-status--${purchase.status}`}>{getPurchaseStatusLabel(purchase.status)}</span></div>
        </div>
        <button className="purchase-collapse-button" type="button" onClick={onCollapse} aria-label={`Thu gọn ${purchase.code}`}>⌃</button>
      </div>

      <dl className="purchase-detail-meta">
        <div><dt>Thời gian nhập</dt><dd>{dateTime(purchase.createdAt)}</dd></div>
        <div><dt>Nhà cung cấp</dt><dd>{purchase.supplierName || 'Không ghi NCC'}</dd></div>
        <div><dt>Mã NCC</dt><dd>{supplierCode}</dd></div>
        <div><dt>Người tạo</dt><dd>{resolveCreatorDisplay(purchase.createdBy, appUser)}</dd></div>
        <div className="purchase-detail-note"><dt>Ghi chú</dt><dd>{purchase.note || '—'}</dd></div>
      </dl>

      <div className="purchase-detail-section-heading"><strong>Danh sách mặt hàng ({rows.length})</strong></div>
      <div className="purchase-detail-table-wrap">
        <table className="purchase-detail-table">
          <thead><tr><th>Mã hàng</th><th>Tên hàng</th><th className="purchase-number">Số lượng</th><th className="purchase-number">Giá nhập</th><th className="purchase-number">Thành tiền</th></tr></thead>
          <tbody>{rows.map((item, index) => (
            <tr key={`${item.productId}-${index}`}><td><strong>{item.sku}</strong></td><td>{item.name}</td><td className="purchase-number">{quantity(item.quantity)}</td><td className="purchase-number">{money(item.unitCost)}</td><td className="purchase-number"><strong>{money(item.lineTotal)}</strong></td></tr>
          ))}</tbody>
        </table>
      </div>

      <div className="purchase-detail-mobile-items">
        {rows.map((item, index) => (
          <article key={`${item.productId}-${index}`}><div><strong>{item.sku}</strong><span>{item.name}</span></div><dl><div><dt>Số lượng</dt><dd>{quantity(item.quantity)}</dd></div><div><dt>Giá nhập</dt><dd>{money(item.unitCost)}</dd></div><div><dt>Thành tiền</dt><dd>{money(item.lineTotal)}</dd></div></dl></article>
        ))}
      </div>

      <div className="purchase-detail-summary">
        <div><span>Số mặt hàng</span><strong>{totals.itemCount}</strong></div>
        <div><span>Tổng số lượng</span><strong>{quantity(totals.totalQuantity)}</strong></div>
        <div className="purchase-detail-summary-total"><span>Tổng cộng</span><strong>{money(totals.total)}</strong></div>
      </div>

      <div className="purchase-detail-actions">
        <button className="button button--secondary purchase-touch" type="button" disabled={busy} onClick={() => onExport(purchase)}>Xuất Excel</button>
        {actions.print ? <button className="button button--secondary purchase-touch" type="button" disabled={busy} onClick={() => onPrint(purchase)}>In tem mã / QR</button> : null}
        <button className="button button--secondary purchase-touch" type="button" disabled={busy} onClick={() => onCopy(purchase)}>{purchase.status === 'completed' ? 'Sao chép để sửa' : 'Sao chép thành phiếu mới'}</button>
        {actions.cancel ? <button className="button button--danger purchase-touch" type="button" disabled={busy} onClick={() => onCancel(purchase)}>{busy ? 'Đang hoàn nhập...' : 'Hủy / hoàn nhập toàn bộ'}</button> : null}
      </div>
    </section>
  );
}
