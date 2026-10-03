import type { Category, Product } from '../../types/models';
import ProductThumbnail from './ProductThumbnail';
import {
  formatGoodsMoney,
  formatGoodsQuantity,
  getGoodsStatusLabel,
  getGoodsStockStatus,
} from './goodsViewModel';

interface GoodsResponsiveListProps {
  products: Product[];
  categories: readonly Category[];
  selectedIds: ReadonlySet<string>;
  onToggleProduct: (productId: string) => void;
  onView: (product: Product) => void;
  onEdit: (product: Product) => void;
}

export default function GoodsResponsiveList({
  products,
  categories,
  selectedIds,
  onToggleProduct,
  onView,
  onEdit,
}: GoodsResponsiveListProps) {
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name] as const));
  return (
    <div className="goods-responsive-list">
      {products.map((product) => {
        const stockStatus = getGoodsStockStatus(product);
        return (
          <article className={`goods-product-card${!product.active ? ' goods-product-card--inactive' : ''}`} key={product.id}>
            <div
              className="goods-product-card__top"
              style={{ gridTemplateColumns: 'auto minmax(0,1fr) auto' }}
            >
              <label
                className="goods-card-check"
                style={{
                  display: 'flex',
                  width: 44,
                  minWidth: 44,
                  height: 44,
                  padding: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: 'pointer',
                }}
              >
                <input type="checkbox" checked={selectedIds.has(product.id)} onChange={() => onToggleProduct(product.id)} />
                <span className="sr-only">Chọn {product.name}</span>
              </label>
              <div className="goods-product-card__identity goods-product-card__identity--image">
                <ProductThumbnail product={product} className="goods-card-thumbnail" />
                <div className="goods-product-card__identity-text">
                  <button type="button" onClick={() => onView(product)}>{product.name}</button>
                  <span>{product.sku}</span>
                </div>
              </div>
              <button className="goods-card-view" type="button" onClick={() => onView(product)}>Xem ›</button>
            </div>
            <div className="goods-product-card__meta">
              <strong>{formatGoodsMoney(product.salePrice)}</strong>
              <span>{product.categoryId ? (categoryNameById.get(product.categoryId) ?? 'Chưa phân loại') : 'Chưa phân loại'}</span>
              <span>Tồn {formatGoodsQuantity(product.stockQuantity)}{typeof product.minStock === 'number' ? ` / min ${formatGoodsQuantity(product.minStock)}` : ''}</span>
              <span className={`goods-status goods-status--${stockStatus}`}>{getGoodsStatusLabel(product)}</span>
            </div>
            <div className="goods-product-card__actions">
              <button className="button button--secondary goods-touch" type="button" onClick={() => onView(product)}>Xem chi tiết</button>
              <button className="button button--secondary goods-touch" type="button" onClick={() => onEdit(product)}>Sửa</button>
            </div>
          </article>
        );
      })}
    </div>
  );
}