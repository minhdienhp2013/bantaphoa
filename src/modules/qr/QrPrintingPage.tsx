import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import type { Product } from '../../types/models';
import { subscribeProducts } from '../products/productService';
import PrintWorkspace, { sanitizeInitialQuantities } from '../printing/PrintWorkspace';
import { BarcodeGraphic, QrGraphic, isValidEan13 } from '../printing/codeGraphics';
import './qrPrinting.css';
import '../printing/printing.css';
import '../printing/printIsolation.css';
import './qrPrintingBrand.css';
import './qrPrintingDesktopMobilePolish.css';

function getRouteInitialQuantities(state: unknown): unknown {
  if (!state || typeof state !== 'object' || Array.isArray(state)) return undefined;
  return (state as { initialQuantities?: unknown }).initialQuantities;
}

export default function QrPrintingPage() {
  const location = useLocation();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [selectedProductId, setSelectedProductId] = useState('');

  useEffect(() => subscribeProducts(
    (nextProducts) => {
      setProducts(nextProducts);
      setLoading(false);
      setLoadError('');
    },
    (error) => {
      setLoading(false);
      setLoadError(error.message);
    },
  ), []);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === selectedProductId) ?? null,
    [products, selectedProductId],
  );

  const routeInitialQuantities = useMemo(
    () => getRouteInitialQuantities(location.state),
    [location.state],
  );

  const validatedInitialQuantities = useMemo(
    () => sanitizeInitialQuantities(products, routeInitialQuantities),
    [products, routeInitialQuantities],
  );

  const qrValue = selectedProduct ? (selectedProduct.qrCode?.trim() || selectedProduct.sku.trim() || selectedProduct.id) : '';
  const barcodeValue = selectedProduct ? (selectedProduct.barcode?.trim() || selectedProduct.sku.trim()) : '';

  return (
    <div className="qr-page">
      <header className="qr-page-header">
        <p className="eyebrow">QR / Barcode / In tem</p>
        <h1>In tem và tạo mã sản phẩm</h1>
        <p className="muted">Chọn sản phẩm, thiết lập số lượng tem và xem trước QR / barcode trước khi in.</p>
      </header>

      {loading ? <div className="qr-info-card">Đang tải sản phẩm…</div> : null}
      {loadError ? <div className="qr-error" role="alert">{loadError}</div> : null}

      {!loading ? (
        <PrintWorkspace
          products={products}
          initialQuantities={validatedInitialQuantities}
        />
      ) : null}

      <section className="qr-generator" aria-labelledby="generator-heading">
        <div className="qr-section-heading">
          <div>
            <p className="eyebrow">Tạo mã sản phẩm</p>
            <h2 id="generator-heading">QR và barcode preview</h2>
          </div>
        </div>
        <label className="qr-field qr-product-select">
          Chọn sản phẩm
          <select value={selectedProductId} onChange={(event) => setSelectedProductId(event.target.value)}>
            <option value="">— Chọn sản phẩm —</option>
            {products.map((product) => <option key={product.id} value={product.id}>{product.sku} — {product.name}</option>)}
          </select>
        </label>

        {selectedProduct ? (
          <div className="qr-code-previews">
            <div className="qr-code-preview-card">
              <h3>QR</h3>
              <QrGraphic value={qrValue} />
              <code>{qrValue}</code>
            </div>
            <div className="qr-code-preview-card qr-code-preview-card--barcode">
              <h3>CODE128</h3>
              <BarcodeGraphic value={barcodeValue} kind="CODE128" />
              <code>{barcodeValue}</code>
            </div>
            <div className="qr-code-preview-card qr-code-preview-card--barcode">
              <h3>EAN-13</h3>
              {isValidEan13(barcodeValue) ? <BarcodeGraphic value={barcodeValue} kind="EAN13" /> : <p className="qr-warning">Giá trị hiện tại không phải EAN-13 hợp lệ. Không tạo mã giả.</p>}
              <code>{barcodeValue || '—'}</code>
            </div>
          </div>
        ) : <p className="muted">Chọn sản phẩm để tạo preview.</p>}
      </section>
    </div>
  );
}
