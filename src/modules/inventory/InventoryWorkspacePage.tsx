import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../auth/AuthContext';
import type { Product, StockMovement } from '../../types/models';
import { subscribeProducts } from '../products/productService';
import OpeningBalanceImportPanel from './OpeningBalanceImportPanel';
import { subscribeStockMovements } from './inventoryService';
import './inventory.css';
import './inventoryBrand.css';
import './inventoryDesktopMobilePolish.css';

function formatNumber(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value);
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(value);
}

export default function InventoryWorkspacePage() {
  const { appUser } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [search, setSearch] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let productsReady = false;
    let movementsReady = false;
    const markReady = () => {
      if (productsReady && movementsReady) setLoading(false);
    };

    try {
      const unsubscribeProducts = subscribeProducts(
        (next) => { productsReady = true; setProducts(next); markReady(); },
        (cause) => { setError(cause.message); setLoading(false); },
      );
      const unsubscribeMovements = subscribeStockMovements(
        (next) => { movementsReady = true; setMovements(next); markReady(); },
        (cause) => { setError(cause.message); setLoading(false); },
      );
      return () => { unsubscribeProducts(); unsubscribeMovements(); };
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể tải dữ liệu kho.');
      setLoading(false);
      return undefined;
    }
  }, []);

  const filteredProducts = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('vi');
    if (!q) return products;
    return products.filter((product) => [product.sku, product.name, product.barcode, product.qrCode]
      .filter(Boolean).some((value) => String(value).toLocaleLowerCase('vi').includes(q)));
  }, [products, search]);

  const summary = useMemo(() => {
    const active = products.filter((product) => product.active);
    const low = active.filter((product) => typeof product.minStock === 'number' && product.stockQuantity <= product.minStock).length;
    const out = active.filter((product) => product.stockQuantity <= 0).length;
    const units = active.reduce((sum, product) => sum + (Number(product.stockQuantity) || 0), 0);
    return { active: active.length, low, out, units };
  }, [products]);

  return (
    <div className="inv-shell">
      <header className="inv-page-header">
        <div><p className="eyebrow">INV-001 / INV-002</p><h1>Kho hàng</h1><p className="muted">Tồn hiện tại và lịch sử biến động được đồng bộ realtime từ Firebase.</p></div>
      </header>

      {error && <p className="form-error">{error}</p>}
      <div className="inv-summary-grid">
        <div className="inv-stat"><span>Sản phẩm hoạt động</span><strong>{summary.active}</strong></div>
        <div className="inv-stat"><span>Tổng lượng tồn</span><strong>{formatNumber(summary.units)}</strong></div>
        <div className="inv-stat"><span>Sắp/hết hàng</span><strong>{summary.low}</strong></div>
        <div className="inv-stat"><span>Hết hàng</span><strong>{summary.out}</strong></div>
      </div>

      {appUser && <OpeningBalanceImportPanel products={products} actorUid={appUser.uid} />}

      <section className="inv-card inv-movement-card"><div className="inv-card__header"><div><h2>Biến động kho gần đây</h2><p className="muted">Mỗi nghiệp vụ thay đổi tồn đều phải xuất hiện tại đây.</p></div></div>
        {movements.length === 0 ? <p className="muted">Chưa có giao dịch kho.</p> : <div className="inv-movement-list">{movements.map((movement) => { const product = products.find((item) => item.id === movement.productId); return <article key={movement.id} className="inv-movement"><div><strong>{product ? `${product.sku} - ${product.name}` : movement.productId}</strong><span>{movement.type} · {formatDate(movement.createdAt)}</span></div><strong className={movement.quantityDelta > 0 ? 'inv-positive' : 'inv-negative'}>{movement.quantityDelta > 0 ? '+' : ''}{formatNumber(movement.quantityDelta)}</strong></article>; })}</div>}
      </section>

      <section className="inv-card inv-stock-card">
        <div className="inv-card__header"><div><h2>Tồn kho hiện tại</h2><p className="muted">Tìm theo tên, SKU, barcode hoặc QR.</p></div>
          <input className="inv-search" type="search" placeholder="Tìm sản phẩm..." value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        {loading ? <p className="muted">Đang tải dữ liệu kho...</p> : filteredProducts.length === 0 ? <p className="muted">Không có sản phẩm phù hợp.</p> : (
          <>
            <div className="inv-table-wrap inv-desktop-table"><table className="inv-table"><thead><tr><th>SKU</th><th>Sản phẩm</th><th>Tồn</th><th>Tồn tối thiểu</th><th>Trạng thái</th></tr></thead><tbody>
              {filteredProducts.map((product) => <tr key={product.id}><td>{product.sku}</td><td><strong>{product.name}</strong><small>{product.unit || ''}</small></td><td>{formatNumber(product.stockQuantity)}</td><td>{typeof product.minStock === 'number' ? formatNumber(product.minStock) : '—'}</td><td>{product.stockQuantity <= 0 ? 'Hết hàng' : typeof product.minStock === 'number' && product.stockQuantity <= product.minStock ? 'Sắp hết' : 'Ổn định'}</td></tr>)}
            </tbody></table></div>
            <div className="inv-mobile-list">{filteredProducts.map((product) => {
              const isOut = product.stockQuantity <= 0;
              const isLow = !isOut && typeof product.minStock === 'number' && product.stockQuantity <= product.minStock;
              return (
                <article className="inv-mobile-card" key={product.id}>
                  <div className="inv-mobile-card__main">
                    <strong>{product.name}</strong>
                    <span>{product.sku}{product.unit ? ` · ${product.unit}` : ''}</span>
                    <small>Tối thiểu: {typeof product.minStock === 'number' ? formatNumber(product.minStock) : '—'}</small>
                  </div>
                  <div className="inv-mobile-card__qty">
                    <span>Tồn</span>
                    <strong>{formatNumber(product.stockQuantity)}</strong>
                    <small className={`inv-stock-status inv-stock-status--${isOut ? 'out' : isLow ? 'low' : 'ok'}`}>
                      {isOut ? 'Hết hàng' : isLow ? 'Sắp hết' : 'Ổn định'}
                    </small>
                  </div>
                </article>
              );
            })}</div>
          </>
        )}
      </section>

    </div>
  );
}
