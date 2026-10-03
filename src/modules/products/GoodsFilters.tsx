import type { Category } from '../../types/models';
import type { GoodsActiveFilter, GoodsCategoryFilter, GoodsStockFilter } from './goodsViewModel';

interface GoodsFiltersProps {
  open: boolean;
  activeFilter: GoodsActiveFilter;
  stockFilter: GoodsStockFilter;
  categoryFilter: GoodsCategoryFilter;
  categories: readonly Category[];
  onActiveFilterChange: (value: GoodsActiveFilter) => void;
  onStockFilterChange: (value: GoodsStockFilter) => void;
  onCategoryFilterChange: (value: GoodsCategoryFilter) => void;
  onClear: () => void;
  onClose: () => void;
}

export default function GoodsFilters({
  open,
  activeFilter,
  stockFilter,
  categoryFilter,
  categories,
  onActiveFilterChange,
  onStockFilterChange,
  onCategoryFilterChange,
  onClear,
  onClose,
}: GoodsFiltersProps) {
  const hasFilter = activeFilter !== 'all' || stockFilter !== 'all' || categoryFilter !== 'all';

  return (
    <>
      {open ? <button className="goods-filter-backdrop" type="button" aria-label="Đóng bộ lọc hàng hóa" onClick={onClose} /> : null}
      <aside className={`goods-filters${open ? ' is-open' : ''}`} aria-label="Bộ lọc hàng hóa">
        <div className="goods-filter-heading">
          <div>
            <strong>Bộ lọc</strong>
            {hasFilter ? <span>Đang áp dụng</span> : null}
          </div>
          <button className="goods-filter-close" type="button" aria-label="Đóng bộ lọc" onClick={onClose}>×</button>
        </div>

        <fieldset>
          <legend>Danh mục</legend>
          <select value={categoryFilter} onChange={(event) => onCategoryFilterChange(event.target.value)} aria-label="Lọc theo danh mục">
            <option value="all">Tất cả danh mục</option>
            <option value="uncategorized">Chưa phân loại</option>
            {categories.map((category) => <option key={category.id} value={category.id}>{category.name}{category.active ? '' : ' (ngừng sử dụng)'}</option>)}
          </select>
        </fieldset>

        <fieldset>
          <legend>Trạng thái</legend>
          <label><input type="radio" name="goods-active" checked={activeFilter === 'all'} onChange={() => onActiveFilterChange('all')} /> Tất cả</label>
          <label><input type="radio" name="goods-active" checked={activeFilter === 'active'} onChange={() => onActiveFilterChange('active')} /> Đang kinh doanh</label>
          <label><input type="radio" name="goods-active" checked={activeFilter === 'inactive'} onChange={() => onActiveFilterChange('inactive')} /> Ngừng kinh doanh</label>
        </fieldset>

        <fieldset>
          <legend>Tình trạng tồn</legend>
          <label><input type="radio" name="goods-stock" checked={stockFilter === 'all'} onChange={() => onStockFilterChange('all')} /> Tất cả tồn</label>
          <label><input type="radio" name="goods-stock" checked={stockFilter === 'in-stock'} onChange={() => onStockFilterChange('in-stock')} /> Còn hàng</label>
          <label><input type="radio" name="goods-stock" checked={stockFilter === 'low'} onChange={() => onStockFilterChange('low')} /> Sắp hết</label>
          <label><input type="radio" name="goods-stock" checked={stockFilter === 'out'} onChange={() => onStockFilterChange('out')} /> Hết hàng</label>
        </fieldset>

        <div className="goods-filter-actions">
          <button className="button button--secondary goods-filter-clear" type="button" onClick={onClear} disabled={!hasFilter}>Xóa lọc</button>
          <button className="button button--primary goods-filter-done" type="button" onClick={onClose}>Xong</button>
        </div>
      </aside>
    </>
  );
}