import type { DashboardChartPoint } from './dashboardViewModel';

interface DashboardRevenueChartProps {
  points: DashboardChartPoint[];
  rangeLabel: string;
}

function vnd(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(value);
}

function compact(value: number) {
  return new Intl.NumberFormat('vi-VN', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export default function DashboardRevenueChart({ points, rangeLabel }: DashboardRevenueChartProps) {
  const width = 720;
  const height = 260;
  const plotTop = 18;
  const plotBottom = 210;
  const plotHeight = plotBottom - plotTop;
  const max = Math.max(0, ...points.map((point) => point.value));
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const step = points.length ? width / points.length : width;
  const barWidth = Math.max(3, Math.min(24, step * 0.58));
  const labelEvery = points.length > 18 ? Math.ceil(points.length / 8) : points.length > 10 ? 2 : 1;

  return (
    <section className="dashboard-card dashboard-chart-card" aria-labelledby="dashboard-revenue-chart-title">
      <div className="dashboard-section-heading">
        <div>
          <p className="dashboard-kicker">Phân tích bán hàng</p>
          <h2 id="dashboard-revenue-chart-title">Doanh thu theo thời gian</h2>
          <p>{rangeLabel}</p>
        </div>
        <strong className="dashboard-chart-total">{vnd(total)}</strong>
      </div>

      {points.length === 0 ? (
        <div className="dashboard-empty">Chưa có bucket thời gian để hiển thị.</div>
      ) : (
        <>
          <div className="dashboard-chart-wrap">
            <svg
              className="dashboard-chart"
              viewBox={`0 0 ${width} ${height}`}
              role="img"
              aria-label={`Biểu đồ doanh thu ${rangeLabel}. Tổng doanh thu ${vnd(total)}.`}
            >
              <line x1="0" y1={plotBottom} x2={width} y2={plotBottom} className="dashboard-chart-axis" />
              <line x1="0" y1={plotTop + plotHeight / 2} x2={width} y2={plotTop + plotHeight / 2} className="dashboard-chart-grid" />
              <line x1="0" y1={plotTop} x2={width} y2={plotTop} className="dashboard-chart-grid" />

              {points.map((point, index) => {
                const x = index * step + step / 2 - barWidth / 2;
                const barHeight = max > 0 ? Math.max(point.value > 0 ? 2 : 0, (point.value / max) * plotHeight) : 0;
                const y = plotBottom - barHeight;
                const showLabel = index % labelEvery === 0 || index === points.length - 1;
                return (
                  <g key={point.key}>
                    <title>{`${point.label}: ${vnd(point.value)}`}</title>
                    <rect
                      className="dashboard-chart-bar"
                      x={x}
                      y={y}
                      width={barWidth}
                      height={barHeight}
                      rx="3"
                    />
                    {showLabel ? (
                      <text className="dashboard-chart-label" x={index * step + step / 2} y="238" textAnchor="middle">
                        {point.shortLabel}
                      </text>
                    ) : null}
                  </g>
                );
              })}

              {max > 0 ? (
                <text className="dashboard-chart-scale" x="6" y="14">{compact(max)} ₫</text>
              ) : null}
            </svg>
          </div>
          {total === 0 ? <p className="dashboard-empty-inline">Không có doanh thu completed trong kỳ đã chọn.</p> : null}
        </>
      )}
    </section>
  );
}
