import { Link } from 'react-router-dom';
import type { DashboardInventoryItem } from './dashboardViewModel';

interface DashboardStockWarningsProps {
  low: DashboardInventoryItem[];
  out: DashboardInventoryItem[];
}

function quantity(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value);
}

function WarningList({ items, type }: { items: DashboardInventoryItem[]; type: 'low' | 'out' }) {
  const visible = items.slice(0, 2);
  const remaining = items.slice(2);
  const label = type === 'low' ? 'Sắp hết' : 'Đã hết';

  const renderItem = (item: DashboardInventoryItem) => (
    <li key={item.productId} className={`dashboard-stock-item dashboard-stock-item--${type}`}>
      <div className="dashboard-stock-icon" aria-hidden="true">{type === 'low' ? '!' : '×'}</div>
      <div className="dashboard-stock-copy">
        <strong title={item.name}>{item.name}</strong>
        <span>{item.sku}{item.unit ? ` · ${item.unit}` : ''}</span>
      </div>
      <div className="dashboard-stock-qty">
        <span>Tồn</span>
        <strong>{quantity(item.stockQuantity)}</strong>
      </div>
    </li>
  );

  return (
    <div className="dashboard-stock-group">
      <div className="dashboard-stock-group-title">
        <strong>{label}</strong>
        <span>{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="dashboard-empty-inline">Không có mặt hàng {label.toLocaleLowerCase('vi')}.</p>
      ) : (
        <>
          <ul className="dashboard-stock-list">{visible.map(renderItem)}</ul>
          {remaining.length > 0 ? (
            <details className="dashboard-stock-more">
              <summary>Xem thêm {remaining.length} mặt hàng</summary>
              <ul className="dashboard-stock-list">{remaining.map(renderItem)}</ul>
            </details>
          ) : null}
        </>
      )}
    </div>
  );
}

export default function DashboardStockWarnings({ low, out }: DashboardStockWarningsProps) {
  return (
    <section className="dashboard-card dashboard-stock-card" aria-labelledby="dashboard-stock-warning-title">
      <div className="dashboard-section-heading dashboard-section-heading--compact">
        <div>
          <p className="dashboard-kicker">Cảnh báo kho</p>
          <h2 id="dashboard-stock-warning-title">Tồn kho cần chú ý</h2>
        </div>
        <Link className="dashboard-text-link" to="/inventory">Xem kho</Link>
      </div>
      <WarningList items={low} type="low" />
      <WarningList items={out} type="out" />
    </section>
  );
}
