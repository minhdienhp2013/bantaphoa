import type { MouseEvent } from 'react';
import type { AppUser, Purchase, Supplier } from '../../types/models';
import PurchaseDetailPanel from './PurchaseDetailPanel';
import { getPurchaseStatusLabel, getPurchaseTotals } from './purchaseManagementViewModel';

interface PurchaseResponsiveListProps {
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

function money(value: number) { return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(Math.round(Number(value) || 0))} đ`; }
function dateTime(value: number) { return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(value); }

export default function PurchaseResponsiveList(props: PurchaseResponsiveListProps) {
  const toggle = (purchaseId: string, event: MouseEvent<HTMLElement>) => props.onToggleDetail(purchaseId, event.currentTarget);
  return (
    <div className="purchase-mobile-list">
      {props.purchases.map((purchase) => {
        const expanded = purchase.id === props.selectedPurchaseId;
        const totals = getPurchaseTotals(purchase);
        const detailId = `purchase-detail-${purchase.id}`;
        return (
          <article className={`purchase-card${expanded ? ' purchase-card--selected' : ''}`} key={purchase.id}>
            <button className="purchase-card-toggle" type="button" aria-expanded={expanded} aria-controls={detailId} onClick={(event) => toggle(purchase.id, event)}>
              <div className="purchase-card-main"><strong>{purchase.code}</strong><span>{purchase.supplierName || 'Không ghi NCC'}</span><small>{dateTime(purchase.createdAt)} · {totals.itemCount} mặt hàng</small></div>
              <div className="purchase-card-side"><span className={`purchase-status purchase-status--${purchase.status}`}>{getPurchaseStatusLabel(purchase.status)}</span><small>Tổng nhập</small><strong>{money(purchase.total)}</strong><span aria-hidden="true">{expanded ? '⌃' : '›'}</span></div>
            </button>
            {expanded ? <PurchaseDetailPanel purchase={purchase} suppliers={props.suppliers} appUser={props.appUser} busy={props.busyPurchaseId === purchase.id} onCollapse={props.onCollapseDetail} onExport={props.onExport} onPrint={props.onPrint} onCopy={props.onCopy} onCancel={props.onCancel} /> : null}
          </article>
        );
      })}
    </div>
  );
}
