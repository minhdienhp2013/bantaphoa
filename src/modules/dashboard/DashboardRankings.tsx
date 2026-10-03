import type { CustomerReportRow } from '../reports/reportService';
import type { DashboardTopProduct } from './dashboardViewModel';

interface DashboardRankingsProps {
  topProducts: DashboardTopProduct[];
  topCustomers?: CustomerReportRow[];
  showProductRevenue: boolean;
}

function vnd(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);
}

function quantity(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value);
}

function initial(value: string) {
  return value.trim().charAt(0).toLocaleUpperCase('vi') || '?';
}

export default function DashboardRankings({ topProducts, topCustomers, showProductRevenue }: DashboardRankingsProps) {
  return (
    <div className={`dashboard-rankings${topCustomers ? '' : ' dashboard-rankings--single'}`}>
      <section className="dashboard-card dashboard-ranking-card" aria-labelledby="dashboard-top-products-title">
        <div className="dashboard-section-heading dashboard-section-heading--compact">
          <div>
            <p className="dashboard-kicker">Bán chạy</p>
            <h2 id="dashboard-top-products-title">Top 10 hàng bán chạy</h2>
          </div>
        </div>
        {topProducts.length === 0 ? (
          <div className="dashboard-empty">Chưa có sản phẩm bán trong kỳ.</div>
        ) : (
          <ol className="dashboard-ranking-list">
            {topProducts.map((item, index) => (
              <li key={item.productId}>
                <span className="dashboard-rank-number">{index + 1}</span>
                <span className="dashboard-rank-avatar" aria-hidden="true">{initial(item.name)}</span>
                <span className="dashboard-rank-copy">
                  <strong title={item.name}>{item.name}</strong>
                  <small>{item.sku} · {item.orderCount} đơn</small>
                </span>
                <span className="dashboard-rank-value">
                  <strong>{quantity(item.quantity)}</strong>
                  <small>{showProductRevenue ? vnd(item.revenue) : 'đã bán'}</small>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      {topCustomers ? (
        <section className="dashboard-card dashboard-ranking-card" aria-labelledby="dashboard-top-customers-title">
          <div className="dashboard-section-heading dashboard-section-heading--compact">
            <div>
              <p className="dashboard-kicker">Khách hàng</p>
              <h2 id="dashboard-top-customers-title">Top khách hàng theo doanh thu</h2>
            </div>
          </div>
          {topCustomers.length === 0 ? (
            <div className="dashboard-empty">Chưa có dữ liệu khách hàng trong kỳ.</div>
          ) : (
            <ol className="dashboard-ranking-list">
              {topCustomers.slice(0, 10).map((item, index) => (
                <li key={item.customerId}>
                  <span className="dashboard-rank-number">{index + 1}</span>
                  <span className="dashboard-rank-avatar" aria-hidden="true">{initial(item.customerName)}</span>
                  <span className="dashboard-rank-copy">
                    <strong title={item.customerName}>{item.customerName}</strong>
                    <small>{item.orderCount} giao dịch</small>
                  </span>
                  <span className="dashboard-rank-value">
                    <strong>{vnd(item.totalRevenue)}</strong>
                    <small>tổng doanh thu</small>
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      ) : null}
    </div>
  );
}
