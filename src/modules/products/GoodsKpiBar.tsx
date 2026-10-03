import type { GoodsStockFilter } from './goodsViewModel';

interface GoodsKpiBarProps {
  stats: {
    total: number;
    active: number;
    inactive: number;
    low: number;
    out: number;
  };
  stockFilter: GoodsStockFilter;
  onStockFilterChange: (value: GoodsStockFilter) => void;
}

export default function GoodsKpiBar({
  stats,
  stockFilter,
  onStockFilterChange,
}: GoodsKpiBarProps) {
  const toggleStockFilter = (value: Extract<GoodsStockFilter, 'low' | 'out'>) => {
    onStockFilterChange(stockFilter === value ? 'all' : value);
  };

  return (
    <section className="goods-kpis" aria-label="Thống kê hàng hóa">
      <div className="goods-kpi"><span>Tổng hàng hóa</span><strong>{stats.total}</strong></div>
      <div className="goods-kpi goods-kpi--active"><span>Đang kinh doanh</span><strong>{stats.active}</strong></div>
      <div className="goods-kpi goods-kpi--inactive"><span>Ngừng kinh doanh</span><strong>{stats.inactive}</strong></div>
      <button
        type="button"
        className={`goods-kpi goods-kpi-button goods-kpi--low${stockFilter === 'low' ? ' is-selected' : ''}`}
        aria-pressed={stockFilter === 'low'}
        aria-label={stockFilter === 'low' ? 'Bỏ lọc sản phẩm sắp hết' : 'Lọc sản phẩm sắp hết'}
        onClick={() => toggleStockFilter('low')}
      >
        <span>Sắp hết</span>
        <strong>{stats.low}</strong>
        <small>{stockFilter === 'low' ? 'Đang lọc' : 'Bấm để lọc'}</small>
      </button>
      <button
        type="button"
        className={`goods-kpi goods-kpi-button goods-kpi--out${stockFilter === 'out' ? ' is-selected' : ''}`}
        aria-pressed={stockFilter === 'out'}
        aria-label={stockFilter === 'out' ? 'Bỏ lọc sản phẩm hết hàng' : 'Lọc sản phẩm hết hàng'}
        onClick={() => toggleStockFilter('out')}
      >
        <span>Hết hàng</span>
        <strong>{stats.out}</strong>
        <small>{stockFilter === 'out' ? 'Đang lọc' : 'Bấm để lọc'}</small>
      </button>
    </section>
  );
}
