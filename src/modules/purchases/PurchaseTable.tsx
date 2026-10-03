import { Fragment, type MouseEvent } from 'react';
import type { AppUser, Purchase, Supplier } from '../../types/models';
import PurchaseDetailPanel from './PurchaseDetailPanel';
import { getPurchaseStatusLabel, resolveSupplierCode } from './purchaseManagementViewModel';

interface PurchaseTableProps {
  purchases: readonly Purchase[];
  suppliers: readonly Supplier[];
  appUser: AppUser | null;
  selectedPurchaseId: string | null;
  busyPurchaseId: string | null;
  onToggleDetail: (purchaseId: string, opener: HTMLElement) => void;
  onCollapseDetail: () => void;
  onExport: (purchase: Purchase) => void;
  onPrint: (purchase: Purchase) => void;
  onCopy: (purchase: Purchase) => void;
  onCancel: (purchase: Purchase) => void;
}

function money(value: number) {
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0))} đ`;
}
function dateTime(value: number) {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(value);
}

export default function PurchaseTable(props: PurchaseTableProps) {
  const { purchases, suppliers, appUser, selectedPurchaseId, busyPurchaseId } = props;
  const toggle = (purchaseId: string, event: MouseEvent<HTMLElement>) => props.onToggleDetail(purchaseId, event.currentTarget);

  return (
    <div className="purchase-table-wrap">
      <table className="purchase-table">
        <thead><tr><th>Mã phiếu</th><th>Thời gian</th><th>Mã NCC</th><th>Nhà cung cấp</th><th className="purchase-number">Tổng nhập</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
        <tbody>
          {purchases.map((purchase) => {
            const expanded = purchase.id === selectedPurchaseId;
            const detailId = `purchase-detail-${purchase.id}`;
            return (
              <Fragment key={purchase.id}>
                <tr className={expanded ? 'purchase-row purchase-row--selected' : 'purchase-row'}>
                  <td><button className="purchase-code-button" type="button" aria-expanded={expanded} aria-controls={detailId} onClick={(event) => toggle(purchase.id, event)}>{purchase.code}</button></td>
                  <td>{dateTime(purchase.createdAt)}</td>
                  <td>{resolveSupplierCode(purchase, suppliers)}</td>
                  <td className="purchase-supplier-cell">{purchase.supplierName || 'Không ghi NCC'}</td>
                  <td className="purchase-number"><strong>{money(purchase.total)}</strong></td>
                  <td><span className={`purchase-status purchase-status--${purchase.status}`}>{getPurchaseStatusLabel(purchase.status)}</span></td>
                  <td><button className="purchase-view-button" type="button" aria-expanded={expanded} aria-controls={detailId} onClick={(event) => toggle(purchase.id, event)}>{expanded ? 'Thu gọn' : 'Xem chi tiết'}</button></td>
                </tr>
                {expanded ? (
                  <tr className="purchase-detail-row"><td colSpan={7}><PurchaseDetailPanel purchase={purchase} suppliers={suppliers} appUser={appUser} busy={busyPurchaseId === purchase.id} onCollapse={props.onCollapseDetail} onExport={props.onExport} onPrint={props.onPrint} onCopy={props.onCopy} onCancel={props.onCancel} /></td></tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
