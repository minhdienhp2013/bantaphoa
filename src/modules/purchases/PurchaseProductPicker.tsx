import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
} from 'react';
import type { Product } from '../../types/models';
import { findProductByScannedCode } from '../qr/productLookup';
import { searchPurchaseProducts } from './purchaseProductSearch';

interface PurchaseProductPickerProps {
  lineKey: string;
  products: readonly Product[];
  productId: string;
  historicalSku?: string;
  historicalName?: string;
  disabled: boolean;
  onSelect: (product: Product) => void;
  onClearSelection: () => void;
  onScanRequest: (lineKey: string) => void;
  onQuickAddRequest: (lineKey: string, query: string, opener: HTMLButtonElement) => void;
}

function productLabel(product: Product) {
  return `${product.sku} - ${product.name}`;
}

export default function PurchaseProductPicker({
  lineKey,
  products,
  productId,
  historicalSku,
  historicalName,
  disabled,
  onSelect,
  onClearSelection,
  onScanRequest,
  onQuickAddRequest,
}: PurchaseProductPickerProps) {
  const listId = useId();
  const pickerRef = useRef<HTMLDivElement>(null);
  const selectedProduct = products.find((product) => product.id === productId && product.active);
  const historicalLabel = historicalSku || historicalName
    ? `${historicalSku || productId} - ${historicalName || 'Sản phẩm cũ'}`
    : '';
  const initialLabel = historicalLabel || (selectedProduct ? productLabel(selectedProduct) : '');
  const [query, setQuery] = useState(initialLabel);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState('');

  const results = useMemo(() => searchPurchaseProducts(products, query, undefined, 10), [products, query]);

  useEffect(() => {
    if (historicalSku || historicalName) return;
    const current = products.find((product) => product.id === productId && product.active);
    if (current) setQuery(productLabel(current));
  }, [historicalName, historicalSku, productId, products]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    if (!open) return undefined;

    function handleOutsidePointer(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && pickerRef.current?.contains(target)) return;
      setOpen(false);
      setError('');
    }

    document.addEventListener('pointerdown', handleOutsidePointer);
    return () => document.removeEventListener('pointerdown', handleOutsidePointer);
  }, [open]);

  function closeResults() {
    setOpen(false);
    setError('');
  }

  function choose(product: Product) {
    setQuery(productLabel(product));
    closeResults();
    onSelect(product);
  }

  function handleInput(value: string) {
    setQuery(value);
    setOpen(Boolean(value.trim()));
    setActiveIndex(0);
    setError('');
    if (productId) onClearSelection();
  }

  function handlePickerBlur(event: FocusEvent<HTMLDivElement>) {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    closeResults();
  }

  function handleScanRequest() {
    closeResults();
    onScanRequest(lineKey);
  }

  function handleQuickAddRequest(opener: HTMLButtonElement) {
    closeResults();
    onQuickAddRequest(lineKey, query, opener);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      closeResults();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(0);
        return;
      }
      if (results.length > 0) setActiveIndex((current) => Math.min(results.length - 1, current + 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) setOpen(true);
      if (results.length > 0) setActiveIndex((current) => Math.max(0, current - 1));
      return;
    }

    if (event.key !== 'Enter') return;
    event.preventDefault();

    const exact = findProductByScannedCode([...products], query.trim());
    if (exact) {
      if (!exact.product.active) {
        setError('Sản phẩm đã ngừng sử dụng.');
        setOpen(false);
        return;
      }
      choose(exact.product);
      return;
    }

    const highlighted = results[activeIndex]?.product;
    if (highlighted) {
      choose(highlighted);
      return;
    }

    setError(query.trim() ? `Không tìm thấy sản phẩm phù hợp với “${query.trim()}”.` : 'Nhập tên hoặc mã sản phẩm để tìm.');
  }

  return (
    <div ref={pickerRef} className="purchase-product-picker" onBlur={handlePickerBlur}>
      <div className="purchase-product-picker-row">
        <div className="purchase-product-search-box">
          <input
            type="search"
            role="combobox"
            aria-label="Tìm sản phẩm"
            aria-autocomplete="list"
            aria-expanded={open && results.length > 0}
            aria-controls={listId}
            aria-activedescendant={open && results[activeIndex] ? `${listId}-${activeIndex}` : undefined}
            autoComplete="off"
            placeholder="Tên hàng, SKU, barcode, QR..."
            value={query}
            disabled={disabled}
            onChange={(event) => handleInput(event.target.value)}
            onFocus={() => { if (query.trim() && !productId) setOpen(true); }}
            onKeyDown={handleKeyDown}
          />

          {open && query.trim() ? (
            <div className="purchase-product-results" id={listId} role="listbox" aria-label="Kết quả tìm sản phẩm">
              {results.length > 0 ? results.map((result, index) => (
                <button
                  id={`${listId}-${index}`}
                  key={result.product.id}
                  className={`purchase-product-result${index === activeIndex ? ' is-active' : ''}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseEnter={() => setActiveIndex(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(result.product);
                  }}
                >
                  <span><strong>{result.product.name}</strong><small>SKU: {result.product.sku}</small></span>
                  <span className="purchase-product-result-meta">
                    {result.product.barcode ? <small>Barcode: {result.product.barcode}</small> : null}
                    {result.product.qrCode ? <small>QR: {result.product.qrCode}</small> : null}
                    <small>Giá vốn: {new Intl.NumberFormat('vi-VN').format(Math.round(result.product.costPrice))} đ</small>
                  </span>
                </button>
              )) : (
                <div className="purchase-product-no-result">Không có sản phẩm hoạt động phù hợp.</div>
              )}
            </div>
          ) : null}
        </div>

        <button
          className="purchase-product-icon-button"
          type="button"
          aria-label="Quét QR hoặc mã vạch"
          title="Quét QR hoặc mã vạch"
          disabled={disabled}
          onClick={handleScanRequest}
        >
          ▣
        </button>
        <button
          className="purchase-product-icon-button"
          type="button"
          aria-label="Thêm nhanh hàng hóa mới"
          title="Thêm nhanh hàng hóa mới"
          disabled={disabled}
          onClick={(event) => handleQuickAddRequest(event.currentTarget)}
        >
          +
        </button>
      </div>
      {error ? <p className="purchase-product-error" role="alert">{error}</p> : null}
    </div>
  );
}
