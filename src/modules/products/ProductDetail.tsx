import type { Category, Product } from '../../types/models';
import { BarcodeGraphic, QrGraphic } from '../printing/codeGraphics';
import '../printing/printing.css';
import ProductImagePanel from './ProductImagePanel';
import {
  formatGoodsMoney,
  formatGoodsQuantity,
  getGoodsStatusLabel,
  getGoodsStockStatus,
} from './goodsViewModel';

interface ProductDetailProps {
  product: Product;
  categories: readonly Category[];
  changingStatus: boolean;
  actorUid: string;
  onClose: () => void;
  onEdit: (product: Product) => void;
  onToggleActive: (product: Product) => void;
  onScan: () => void;
  onPrint: (product: Product) => void;
}

export default function ProductDetail({
  product,
  categories,
  changingStatus,
  actorUid,
  onClose,
  onEdit,
  onToggleActive,
  onScan,
  onPrint,
}: ProductDetailProps) {
  const categoryName = product.categoryId ? categories.find((category) => category.id === product.categoryId)?.name : undefined;
  const stockStatus = getGoodsStockStatus(product);
  const qrValue = product.qrCode?.trim() || product.sku.trim() || product.id;
  const barcodeValue = product.barcode?.trim() || product.sku.trim();

  return (
    <div className="goods-modal-backdrop" role="presentation">
      <div className="goods-modal goods-detail" role="dialog" aria-modal="true" aria-labelledby="goods-detail-title">
        <div className="goods-modal-heading goods-detail-heading">
          <div>
            <p className="eyebrow">Hàng hóa / Chi tiết</p>
            <h2 id="goods-detail-title">{product.name}</h2>
            <p className="muted">{product.sku} · {product.active ? 'Đang kinh doanh' : 'Ngừng kinh doanh'}</p>
          </div>
          <button className="goods-modal-close" type="button" onClick={onClose} aria-label="Đóng chi tiết sản phẩm">×</button>
        </div>

        <div className="goods-detail-grid">
          <div className="goods-detail-main">
            <ProductImagePanel product={product} actorUid={actorUid} />
            <section className="goods-detail-card">
              <h3>Thông tin chung</h3>
              <dl className="goods-detail-dl">
                <div><dt>Mã hàng</dt><dd>{product.sku}</dd></div>
                <div><dt>Barcode</dt><dd>{product.barcode || '—'}</dd></div>
                <div><dt>Mã QR</dt><dd>{product.qrCode || '—'}</dd></div>
                <div><dt>Danh mục</dt><dd>{categoryName || 'Chưa phân loại'}</dd></div>
                <div><dt>Đơn vị</dt><dd>{product.unit || '—'}</dd></div>
                <div><dt>Giá vốn hiện tại</dt><dd>{formatGoodsMoney(product.costPrice)}</dd></div>
                <div><dt>Giá bán</dt><dd><strong>{formatGoodsMoney(product.salePrice)}</strong></dd></div>
                <div><dt>Tồn tối thiểu</dt><dd>{typeof product.minStock === 'number' ? formatGoodsQuantity(product.minStock) : '—'}</dd></div>
                <div><dt>Trạng thái</dt><dd>{product.active ? 'Đang kinh doanh' : 'Ngừng kinh doanh'}</dd></div>
              </dl>
            </section>

            <section className="goods-detail-card goods-stock-card">
              <h3>Tồn kho</h3>
              <div className="goods-stock-summary">
                <div><span>Tồn hiện tại</span><strong>{formatGoodsQuantity(product.stockQuantity)}</strong></div>
                <div><span>Tồn tối thiểu</span><strong>{typeof product.minStock === 'number' ? formatGoodsQuantity(product.minStock) : '—'}</strong></div>
                <span className={`goods-status goods-status--${stockStatus}`}>{getGoodsStatusLabel(product)}</span>
              </div>
              <strong className="goods-readonly-note">Tồn kho chỉ đọc tại đây.</strong>
              <p>Muốn thay đổi tồn phải qua Nhập hàng / Xuất kho / Kiểm kê / Bán hàng.</p>
            </section>
          </div>

          <div className="goods-detail-side">
            <section className="goods-detail-card goods-code-card">
              <h3>Mã sản phẩm</h3>
              <div className="goods-code-preview"><QrGraphic value={qrValue} /><code>QR: {qrValue}</code></div>
              <div className="goods-code-preview goods-code-preview--barcode"><BarcodeGraphic value={barcodeValue} kind="CODE128" /><code>CODE128 · {barcodeValue}</code></div>
            </section>

            <section className="goods-detail-card">
              <h3>Thao tác</h3>
              <div className="goods-detail-actions">
                <button className="button button--primary goods-touch" type="button" onClick={() => onEdit(product)}>Sửa</button>
                <button className="button button--secondary goods-touch" type="button" onClick={onScan}>Quét mã</button>
                <button className="button button--secondary goods-touch" type="button" onClick={() => onPrint(product)}>In tem</button>
                <button className="button button--secondary goods-touch" type="button" onClick={() => onToggleActive(product)} disabled={changingStatus}>
                  {changingStatus ? 'Đang lưu...' : product.active ? 'Ngừng kinh doanh' : 'Kích hoạt lại'}
                </button>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}