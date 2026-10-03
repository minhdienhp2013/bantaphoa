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
import { searchPurchaseProducts } from '../purchases/purchaseProductSearch';

interface StockOutProductSearchProps {
  products: readonly Product[];
  productId: string;
  disabled?: boolean;
  onSelect: (productId: string) => void;
}

function productLabel(product: Product) {
  return `${product.sku} - ${product.name}`;
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(Number(value) || 0);
}

export default function StockOutProductSearch({
  products,
  productId,
  disabled = false,
  onSelect,
}: StockOutProductSearchProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const previousProductIdRef = useRef(productId);
  const editingSelectionRef = useRef(false);
  const selectedProduct = products.find((product) => product.id === productId && product.active);
  const [query, setQuery] = useState(selectedProduct ? productLabel(selectedProduct) : '');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const results = useMemo(
    () => searchPurchaseProducts(products, query, undefined, 8),
    [products, query],
  );

  useEffect(() => {
    const previousProductId = previousProductIdRef.current;

    if (productId) {
      const product = products.find((item) => item.id === productId && item.active);
      if (product) setQuery(productLabel(product));
    } else if (previousProductId && !editingSelectionRef.current) {
      setQuery('');
    }

    editingSelectionRef.current = false;
    previousProductIdRef.current = productId;
  }, [productId, products]);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(0, results.length - 1)));
  }, [results.length]);

  useEffect(() => {
    if (!open) return undefined;

    function closeOnOutsidePointer(event: PointerEvent) {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return;
      setOpen(false);
    }

    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [open]);

  function choose(product: Product) {
    setQuery(productLabel(product));
    setOpen(false);
    onSelect(product.id);
  }

  function handleInput(value: string) {
    setQuery(value);
    setOpen(Boolean(value.trim()));
    setActiveIndex(0);

    if (productId) {
      editingSelectionRef.current = true;
      onSelect('');
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setOpen(false);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      if (results.length > 0) setActiveIndex((current) => Math.min(results.length - 1, current + 1));
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (results.length > 0) setActiveIndex((current) => Math.max(0, current - 1));
      return;
    }

    if (event.key === 'Enter' && open) {
      event.preventDefault();
      const product = results[activeIndex]?.product;
      if (product) choose(product);
    }
  }

  return (
    <div className="stockout-product-search" ref={rootRef} onBlur={handleBlur}>
      <input
        type="search"
        role="combobox"
        aria-label="Tìm sản phẩm xuất kho"
        aria-autocomplete="list"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && results[activeIndex] ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        placeholder="Tên, SKU, barcode, QR..."
        value={query}
        disabled={disabled}
        onChange={(event) => handleInput(event.target.value)}
        onFocus={() => { if (query.trim() && !productId) setOpen(true); }}
        onKeyDown={handleKeyDown}
      />

      {open && query.trim() ? (
        <div className="stockout-product-results" id={listId} role="listbox" aria-label="Kết quả tìm sản phẩm">
          {results.length > 0 ? results.map((result, index) => {
            const product = result.product;
            const out = product.stockQuantity <= 0;
            return (
              <button
                id={`${listId}-${index}`}
                key={product.id}
                className={`stockout-product-result${index === activeIndex ? ' is-active' : ''}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                onMouseEnter={() => setActiveIndex(index)}
                onPointerDown={(event) => {
                  event.preventDefault();
                  choose(product);
                }}
              >
                <span className="stockout-product-result__main">
                  <strong>{product.name}</strong>
                  <small>SKU: {product.sku}</small>
                </span>
                <span className={`stockout-product-result__stock${out ? ' is-out' : ''}`}>
                  <small>Tồn</small>
                  <strong>{formatQuantity(product.stockQuantity)} {product.unit || ''}</strong>
                </span>
              </button>
            );
          }) : (
            <div className="stockout-product-empty">Không tìm thấy sản phẩm hoạt động phù hợp.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
