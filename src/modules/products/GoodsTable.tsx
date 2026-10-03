import { useEffect, useRef } from 'react';
import type { Category, Product } from '../../types/models';
import ProductThumbnail from './ProductThumbnail';
import {
  formatGoodsMoney,
  formatGoodsQuantity,
  getGoodsStatusLabel,
  getGoodsStockStatus,
} from './goodsViewModel';

interface GoodsTableProps {
  products: Product[];
  categories: readonly Category[];
  selectedIds: ReadonlySet<string>;
  onToggleProduct: (productId: string) => void;
  onToggleAllVisible: () => void;
  onView: (product: Product) => void;
  onEdit: (product: Product) => void;
}

export default function GoodsTable({
  products,
  categories,
  selectedIds,
  onToggleProduct,
  onToggleAllVisible,
  onView,
  onEdit,
}: GoodsTableProps) {
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name] as const));
  const selectAllRef = useRef<HTMLInputElement>(null);
  const allSelected = products.length > 0 && products.every((product) => selectedIds.has(product.id));
  const someSelected = products.some((product) => selectedIds.has(product.id));

  useEffect(() => {
    if (selectAllRef.current) selectAllRef.current.indeterminate = someSelected && !allSelected;
  }, [allSelected, someSelected]);

  return (
    <div className="goods-table-wrap goods-desktop-table">
      <table className="goods-table">
        <thead>
          <tr>
            <th className="goods-check-cell">
              <input
                ref={selectAllRef}
                type="checkbox"
                aria-label="Chọn tất cả sản phẩm đang hiển thị"
                checked={allSelected}
                disabled={products.length === 0}
                onChange={onToggleAllVisible}
              />
            </th>
            <th>Ảnh</th>
            <th>Mã hàng</th>
            <th>Tên hàng</th>
            <th>Danh mục</th>
            <th>ĐVT</th>
            <th className="goods-number">Giá vốn hiện tại</th>
            <th className="goods-number">Giá bán</th>
            <th className="goods-number">Tồn kho</th>
            <th className="goods-number">Tồn tối thiểu</th>
            <th>Trạng thái</th>
            <th aria-label="Thao tác" />
          </tr>
        </thead>
        <tbody>
          {products.map((product) => {
            const stockStatus = getGoodsStockStatus(product);
            return (
              <tr key={product.id} className={!product.active ? 'goods-row--inactive' : undefined} onClick={() => onView(product)}>
                <td className="goods-check-cell" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    aria-label={`Chọn ${product.name}`}
                    checked={selectedIds.has(product.id)}
                    onChange={() => onToggleProduct(product.id)}
                  />
                </td>
                <td><ProductThumbnail product={product} className="goods-table-thumbnail" /></td>
                <td><strong>{product.sku}</strong></td>
                <td><button className="goods-name-button" type="button" onClick={(event) => { event.stopPropagation(); onView(product); }}>{product.name}</button></td>
                <td>{product.categoryId ? (categoryNameById.get(product.categoryId) ?? 'Chưa phân loại') : 'Chưa phân loại'}</td>
                <td>{product.unit || '—'}</td>
                <td className="goods-number">{formatGoodsMoney(product.costPrice)}</td>
                <td className="goods-number"><strong>{formatGoodsMoney(product.salePrice)}</strong></td>
                <td className={`goods-number${stockStatus === 'low' || stockStatus === 'out' ? ' goods-stock-alert' : ''}`}>{formatGoodsQuantity(product.stockQuantity)}</td>
                <td className="goods-number">{typeof product.minStock === 'number' ? formatGoodsQuantity(product.minStock) : '—'}</td>
                <td><span className={`goods-status goods-status--${stockStatus}`}>{getGoodsStatusLabel(product)}</span></td>
                <td onClick={(event) => event.stopPropagation()}>
                  <div className="goods-row-actions">
                    <button className="goods-text-button" type="button" onClick={() => onView(product)}>Xem</button>
                    <button className="goods-text-button" type="button" onClick={() => onEdit(product)}>Sửa</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}