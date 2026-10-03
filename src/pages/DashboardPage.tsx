import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { hasModulePermission } from '../auth/permissions';
import DashboardRankings from '../modules/dashboard/DashboardRankings';
import DashboardRevenueChart from '../modules/dashboard/DashboardRevenueChart';
import DashboardStockWarnings from '../modules/dashboard/DashboardStockWarnings';
import { loadDashboardData, type DashboardDataBundle } from '../modules/dashboard/dashboardService';
import {
  buildDashboardRange,
  buildInventorySummary,
  buildPreviousDashboardRange,
  buildRecentActivity,
  buildRevenueChart,
  buildTopProducts,
  getDashboardComparison,
  getDashboardPreviousPeriodLabel,
  getDashboardVisibility,
  getOwnerMetrics,
  getSoldQuantity,
  getStockWarnings,
  type DashboardComparison,
  type DashboardPreset,
} from '../modules/dashboard/dashboardViewModel';
import '../modules/dashboard/dashboard.css';
import '../modules/dashboard/dashboardDesktopMobilePolish.css';

const PRESETS: { id: DashboardPreset; label: string }[] = [
  { id: 'today', label: 'Hôm nay' },
  { id: 'last7', label: 'Tuần này' },
  { id: 'month', label: 'Tháng này' },
  { id: 'quarter', label: 'Quý này' },
  { id: 'year', label: 'Năm nay' },
];

function vnd(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);
}

function number(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value);
}

function dateTime(value: number) {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(value);
}

function ComparisonBadge({ comparison }: { comparison: DashboardComparison }) {
  const symbol = comparison.direction === 'up' ? '↑' : comparison.direction === 'down' ? '↓' : '';
  return (
    <span className={`dashboard-comparison dashboard-comparison--${comparison.direction}`}>
      {symbol ? `${symbol} ` : ''}{comparison.label}
    </span>
  );
}

function LoadingDashboard() {
  return (
    <div className="dashboard-loading" aria-label="Đang tải Tổng quan">
      <div className="dashboard-skeleton dashboard-skeleton--heading" />
      <div className="dashboard-kpi-grid">
        {Array.from({ length: 6 }, (_, index) => <div className="dashboard-skeleton dashboard-skeleton--kpi" key={index} />)}
      </div>
      <div className="dashboard-primary-grid">
        <div className="dashboard-skeleton dashboard-skeleton--chart" />
        <div className="dashboard-skeleton dashboard-skeleton--chart" />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { appUser } = useAuth();
  const [preset, setPreset] = useState<DashboardPreset>('today');
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [data, setData] = useState<DashboardDataBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const ranges = useMemo(() => {
    const now = new Date();
    return {
      current: buildDashboardRange(preset, now),
      previous: buildPreviousDashboardRange(preset, now),
    };
  }, [preset, refreshNonce]);

  useEffect(() => {
    if (!appUser) return undefined;
    let cancelled = false;
    setLoading(true);
    setError('');

    void loadDashboardData(
      appUser.role,
      ranges.current,
      ranges.previous,
      hasModulePermission(appUser, 'debts'),
    )
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((cause) => {
        if (!cancelled) {
          setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu Tổng quan.');
          setData(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [appUser, ranges]);

  if (!appUser) return null;

  const refreshDashboard = () => {
    if (loading) return;
    setRefreshNonce((value) => value + 1);
  };

  const visibility = getDashboardVisibility(appUser.role);
  const inventorySummary = data ? buildInventorySummary(data.inventory) : { active: 0, ok: 0, low: 0, out: 0 };
  const stockWarnings = data ? getStockWarnings(data.inventory) : { low: [], out: [] };
  const topProducts = data ? buildTopProducts(data.sales, 10) : [];
  const recentActivity = data ? buildRecentActivity(data.sales, data.purchases, data.stockOuts, 8) : [];
  const soldQuantity = data ? getSoldQuantity(data.sales) : 0;

  const ownerData = data?.role === 'owner' ? data : null;
  const debtSnapshot = data?.debtSnapshot ?? null;
  const ownerMetrics = ownerData ? getOwnerMetrics(ownerData.currentReport.summary, ownerData.sales) : null;
  const previousMetrics = ownerData ? getOwnerMetrics(ownerData.previousReport.summary, ownerData.previousReport.sales) : null;
  const chartPoints = ownerData ? buildRevenueChart(ownerData.sales, preset, ranges.current) : [];
  const previousPeriodLabel = getDashboardPreviousPeriodLabel(preset);

  const inventoryPercent = (count: number) => inventorySummary.active > 0 ? (count / inventorySummary.active) * 100 : 0;
  const inventoryBackground = inventorySummary.active > 0
    ? `conic-gradient(#2d8a57 0 ${inventoryPercent(inventorySummary.ok)}%, #d99a1b ${inventoryPercent(inventorySummary.ok)}% ${inventoryPercent(inventorySummary.ok + inventorySummary.low)}%, #c84c4c ${inventoryPercent(inventorySummary.ok + inventorySummary.low)}% 100%)`
    : '#edf1f6';

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header">
        <div>
          <p className="dashboard-kicker">Tổng quan cửa hàng</p>
          <h1>Xin chào, {appUser.displayName}</h1>
          <p className="dashboard-subtitle">
            {appUser.role === 'owner'
              ? 'Theo dõi bán hàng, lợi nhuận và tồn kho từ dữ liệu giao dịch thật.'
              : hasModulePermission(appUser, 'debts')
                ? 'Theo dõi hoạt động bán hàng, tồn kho, công nợ và khoản vay theo quyền được cấp.'
                : 'Theo dõi hoạt động bán hàng và tồn kho. Thông tin tài chính nhạy cảm được ẩn khỏi Dashboard nhân viên.'}
          </p>
        </div>
        <div className="dashboard-header-actions">
          <button
            className="dashboard-refresh"
            type="button"
            aria-disabled={loading}
            aria-busy={loading}
            onClick={refreshDashboard}
          >
            {loading ? 'Đang tải…' : 'Làm mới'}
          </button>
        </div>
      </header>

      <section className="dashboard-period-bar" aria-label="Khoảng thời gian Tổng quan">
        <div className="dashboard-period-chips">
          {PRESETS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`dashboard-period-chip${preset === item.id ? ' is-active' : ''}`}
              aria-pressed={preset === item.id}
              onClick={() => setPreset(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <span className="dashboard-range-label">{ranges.current.label}</span>
      </section>

      {error ? (
        <div className="dashboard-error" role="alert">
          <div><strong>Không thể tải Tổng quan.</strong><span>{error}</span></div>
          <button type="button" onClick={refreshDashboard}>Thử lại</button>
        </div>
      ) : null}

      {loading ? <LoadingDashboard /> : null}

      {!loading && data ? (
        <>
          {visibility.financial && ownerMetrics && previousMetrics ? (
            <section className="dashboard-kpi-grid" aria-label="KPI tài chính">
              <article className="dashboard-kpi-card">
                <span>Tổng doanh thu</span>
                <strong>{vnd(ownerMetrics.totalRevenue)}</strong>
                <div><ComparisonBadge comparison={getDashboardComparison(ownerMetrics.totalRevenue, previousMetrics.totalRevenue)} /><small>so với {previousPeriodLabel}: {vnd(previousMetrics.totalRevenue)}</small></div>
              </article>
              <article className="dashboard-kpi-card">
                <span>Giao dịch hoàn tất</span>
                <strong>{number(ownerMetrics.completedSales)}</strong>
                <div><ComparisonBadge comparison={getDashboardComparison(ownerMetrics.completedSales, previousMetrics.completedSales)} /><small>so với {previousPeriodLabel}: {number(previousMetrics.completedSales)} giao dịch</small></div>
              </article>
              <article className="dashboard-kpi-card">
                <span>Lợi nhuận gộp thực hàng hóa</span>
                <strong>{vnd(ownerMetrics.productActualGrossProfit)}</strong>
                <div><ComparisonBadge comparison={getDashboardComparison(ownerMetrics.productActualGrossProfit, previousMetrics.productActualGrossProfit)} /><small>so với {previousPeriodLabel}: {vnd(previousMetrics.productActualGrossProfit)}</small></div>
              </article>
              <article className="dashboard-kpi-card">
                <span>Lợi nhuận ước tính dịch vụ</span>
                <strong>{vnd(ownerMetrics.serviceEstimatedProfit)}</strong>
                <div><ComparisonBadge comparison={getDashboardComparison(ownerMetrics.serviceEstimatedProfit, previousMetrics.serviceEstimatedProfit)} /><small>so với {previousPeriodLabel}: {vnd(previousMetrics.serviceEstimatedProfit)}</small></div>
              </article>
              <article className="dashboard-kpi-card">
                <span>Lợi nhuận tổng hợp ước tính trước chi phí</span>
                <strong title="Gồm phần ước tính dịch vụ · trước chi phí">{vnd(ownerMetrics.combinedProfitEstimate)}</strong>
                <div><ComparisonBadge comparison={getDashboardComparison(ownerMetrics.combinedProfitEstimate, previousMetrics.combinedProfitEstimate)} /><small>so với {previousPeriodLabel}: {vnd(previousMetrics.combinedProfitEstimate)}</small></div>
              </article>
              <article className="dashboard-kpi-card">
                <span>Chi phí</span>
                <strong>{vnd(ownerMetrics.expenseTotal)}</strong>
                <div><ComparisonBadge comparison={getDashboardComparison(ownerMetrics.expenseTotal, previousMetrics.expenseTotal)} /><small>so với {previousPeriodLabel}: {vnd(previousMetrics.expenseTotal)}</small></div>
              </article>
            </section>
          ) : (
            <section className="dashboard-kpi-grid" aria-label="KPI vận hành">
              <article className="dashboard-kpi-card"><span>Giao dịch hoàn tất</span><strong>{number(data.sales.length)}</strong><small>Trong kỳ đã chọn</small></article>
              <article className="dashboard-kpi-card"><span>Sản phẩm đã bán</span><strong>{number(soldQuantity)}</strong><small>Tổng SaleItem.quantity</small></article>
              <article className="dashboard-kpi-card"><span>Sắp hết</span><strong>{inventorySummary.low}</strong><small>SKU active</small></article>
              <article className="dashboard-kpi-card"><span>Đã hết</span><strong>{inventorySummary.out}</strong><small>SKU active</small></article>
            </section>
          )}

          {debtSnapshot ? (
            <section className="dashboard-card dashboard-sales-summary dashboard-debt-summary--flow" aria-labelledby="dashboard-debt-summary-title">
              <div className="dashboard-section-heading dashboard-section-heading--compact">
                <div>
                  <p className="dashboard-kicker">Số dư hiện tại</p>
                  <h2 id="dashboard-debt-summary-title">Công nợ và khoản vay</h2>
                </div>
                <Link to="/debts" className="dashboard-text-link">Mở Công nợ →</Link>
              </div>
              <div className="dashboard-mini-stats">
                <div><span>Khách hàng còn nợ</span><strong>{vnd(debtSnapshot.receivable.totalOutstanding)}</strong></div>
                <div><span>Phải thu quá hạn</span><strong>{vnd(debtSnapshot.receivable.overdueAmount)}</strong></div>
                <div><span>Còn phải trả NCC</span><strong>{vnd(debtSnapshot.payable.totalOutstanding)}</strong></div>
                <div><span>Phải trả quá hạn</span><strong>{vnd(debtSnapshot.payable.overdueAmount)}</strong></div>
                <div><span>Dư nợ gốc vay</span><strong>{vnd(debtSnapshot.loans.principalOutstanding)}</strong></div>
                <div><span>Lãi kế hoạch còn lại</span><strong>{vnd(debtSnapshot.loans.plannedInterestOutstanding)}</strong></div>
              </div>
            </section>
          ) : null}

          <div className={`dashboard-primary-grid${visibility.revenueChart ? '' : ' dashboard-primary-grid--single'}`}>
            {visibility.revenueChart && ownerData ? (
              <div className="dashboard-primary-left">
                <DashboardRevenueChart points={chartPoints} rangeLabel={ranges.current.label} />
                {visibility.financial && ownerMetrics ? (
                  <section className="dashboard-card dashboard-sales-summary dashboard-sales-summary--primary" aria-labelledby="dashboard-sales-summary-title">
                    <div className="dashboard-section-heading dashboard-section-heading--compact">
                      <div><p className="dashboard-kicker">Trong kỳ</p><h2 id="dashboard-sales-summary-title">Tóm tắt giao dịch</h2></div>
                    </div>
                    <div className="dashboard-mini-stats">
                      <div><span>Doanh thu hàng hóa</span><strong>{vnd(ownerData.currentReport.summary.productRevenue)}</strong></div>
                      <div><span>Doanh thu dịch vụ</span><strong>{vnd(ownerData.currentReport.summary.serviceRevenue)}</strong></div>
                      <div><span>Giao dịch trung bình</span><strong>{vnd(ownerMetrics.averageOrder)}</strong></div>
                      <div><span>Sản phẩm đã bán</span><strong>{number(ownerMetrics.soldQuantity)}</strong></div>
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}
            <div className="dashboard-primary-right">
              <DashboardStockWarnings low={stockWarnings.low} out={stockWarnings.out} />
              {debtSnapshot ? (
                <section className="dashboard-card dashboard-sales-summary dashboard-debt-summary--compact" aria-labelledby="dashboard-debt-summary-compact-title">
                  <div className="dashboard-section-heading dashboard-section-heading--compact">
                    <div>
                      <p className="dashboard-kicker">Số dư hiện tại</p>
                      <h2 id="dashboard-debt-summary-compact-title">Công nợ và khoản vay</h2>
                    </div>
                    <Link to="/debts" className="dashboard-text-link">Mở →</Link>
                  </div>
                  <div className="dashboard-mini-stats">
                    <div><span>Khách hàng còn nợ</span><strong>{vnd(debtSnapshot.receivable.totalOutstanding)}</strong></div>
                    <div><span>Phải thu quá hạn</span><strong>{vnd(debtSnapshot.receivable.overdueAmount)}</strong></div>
                    <div><span>Còn phải trả NCC</span><strong>{vnd(debtSnapshot.payable.totalOutstanding)}</strong></div>
                    <div><span>Phải trả quá hạn</span><strong>{vnd(debtSnapshot.payable.overdueAmount)}</strong></div>
                    <div><span>Dư nợ gốc vay</span><strong>{vnd(debtSnapshot.loans.principalOutstanding)}</strong></div>
                    <div><span>Lãi kế hoạch còn lại</span><strong>{vnd(debtSnapshot.loans.plannedInterestOutstanding)}</strong></div>
                  </div>
                </section>
              ) : null}
            </div>
          </div>

          {!visibility.financial ? (
            <section className="dashboard-card dashboard-sales-summary" aria-labelledby="dashboard-ops-summary-title">
              <div className="dashboard-section-heading dashboard-section-heading--compact">
                <div><p className="dashboard-kicker">Vận hành</p><h2 id="dashboard-ops-summary-title">Tóm tắt hoạt động</h2></div>
              </div>
              <div className="dashboard-mini-stats">
                <div><span>Giao dịch hoàn tất</span><strong>{number(data.sales.length)}</strong></div>
                <div><span>Sản phẩm đã bán</span><strong>{number(soldQuantity)}</strong></div>
                <div><span>SKU đang hoạt động</span><strong>{inventorySummary.active}</strong></div>
                <div><span>Cảnh báo kho</span><strong>{inventorySummary.low + inventorySummary.out}</strong></div>
              </div>
            </section>
          ) : null}

          <DashboardRankings
            topProducts={topProducts}
            topCustomers={visibility.topCustomers && ownerData ? ownerData.currentReport.customers.slice(0, 10) : undefined}
            showProductRevenue={visibility.financial}
          />

          <div className="dashboard-lower-grid">
            <section className="dashboard-card dashboard-inventory-summary" aria-labelledby="dashboard-inventory-summary-title">
              <div className="dashboard-section-heading dashboard-section-heading--compact">
                <div><p className="dashboard-kicker">Kho hiện tại</p><h2 id="dashboard-inventory-summary-title">Tóm tắt tồn kho</h2></div>
              </div>
              <div className="dashboard-inventory-content">
                <div className="dashboard-donut" style={{ background: inventoryBackground }} aria-hidden="true">
                  <div><strong>{inventorySummary.active}</strong><span>SKU active</span></div>
                </div>
                <dl className="dashboard-inventory-legend">
                  <div><dt><span className="dashboard-dot dashboard-dot--ok" />Còn hàng</dt><dd>{inventorySummary.ok} <small>{inventoryPercent(inventorySummary.ok).toFixed(0)}%</small></dd></div>
                  <div><dt><span className="dashboard-dot dashboard-dot--low" />Sắp hết</dt><dd>{inventorySummary.low} <small>{inventoryPercent(inventorySummary.low).toFixed(0)}%</small></dd></div>
                  <div><dt><span className="dashboard-dot dashboard-dot--out" />Đã hết</dt><dd>{inventorySummary.out} <small>{inventoryPercent(inventorySummary.out).toFixed(0)}%</small></dd></div>
                </dl>
              </div>
              <p className="dashboard-note">Tỷ lệ tính theo số SKU active, không phải tổng số lượng tồn.</p>
            </section>

            <section className="dashboard-card dashboard-activity" aria-labelledby="dashboard-activity-title">
              <div className="dashboard-section-heading dashboard-section-heading--compact">
                <div><p className="dashboard-kicker">Giao dịch</p><h2 id="dashboard-activity-title">Hoạt động gần đây</h2></div>
              </div>
              {recentActivity.length === 0 ? (
                <div className="dashboard-empty">Chưa có giao dịch completed trong kỳ.</div>
              ) : (
                <ul className="dashboard-activity-list">
                  {recentActivity.map((item) => (
                    <li key={item.id}>
                      <span className={`dashboard-activity-icon dashboard-activity-icon--${item.type}`} aria-hidden="true">
                        {item.type === 'sale' ? 'B' : item.type === 'purchase' ? 'N' : 'X'}
                      </span>
                      <span className="dashboard-activity-copy"><strong>{item.title}</strong><small>{item.detail}</small></span>
                      <time dateTime={new Date(item.createdAt).toISOString()}>{dateTime(item.createdAt)}</time>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {ownerData?.currentReport.warnings.length ? (
            <div className="dashboard-data-warning" role="status">
              <strong>Cảnh báo dữ liệu lịch sử</strong>
              <span>{ownerData.currentReport.warnings[0]}</span>
              {ownerData.currentReport.warnings.length > 1 ? <small>+{ownerData.currentReport.warnings.length - 1} cảnh báo khác trong Reports.</small> : null}
            </div>
          ) : null}

        </>
      ) : null}
    </div>
  );
}
