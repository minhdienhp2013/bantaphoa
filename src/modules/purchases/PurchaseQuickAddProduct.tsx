import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Category, Product } from '../../types/models';
import ProductEditorForm from '../products/ProductEditorForm';
import { subscribeCategories } from '../products/categoryService';
import { createProduct, type ProductInput } from '../products/productService';
import '../products/products.css';
import { resolvePurchaseModalFocusTarget } from './purchaseModalFocus';

interface PurchaseQuickAddProductProps {
  products: readonly Product[];
  actorUid: string;
  initialName?: string;
  onCreated: (product: Product) => void;
  onClose: () => void;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[href]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export default function PurchaseQuickAddProduct({
  products,
  actorUid,
  initialName = '',
  onCreated,
  onClose,
}: PurchaseQuickAddProductProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const savingRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const initialValues = useMemo(() => ({ name: initialName.trim() }), [initialName]);

  useEffect(() => {
    try {
      return subscribeCategories(setCategories, () => undefined);
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    savingRef.current = saving;
  }, [saving]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const frame = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const first = dialog?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
      (first ?? dialog)?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog) return;

      if (event.key === 'Escape') {
        if (savingRef.current) return;
        event.preventDefault();
        closeRef.current();
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)]
        .filter((element) => !element.hasAttribute('disabled') && element.getAttribute('aria-hidden') !== 'true');
      const activeElement = document.activeElement;
      const activeIndex = activeElement ? focusable.indexOf(activeElement as HTMLElement) : -1;
      const focusTarget = resolvePurchaseModalFocusTarget({
        focusableCount: focusable.length,
        activeIndex,
        activeInsideDialog: Boolean(activeElement && dialog.contains(activeElement)),
        shiftKey: event.shiftKey,
      });

      if (!focusTarget) return;
      event.preventDefault();

      if (focusTarget === 'dialog') {
        dialog.focus();
        return;
      }

      const target = focusTarget === 'first' ? focusable[0] : focusable[focusable.length - 1];
      target?.focus();
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  async function handleSubmit(input: ProductInput) {
    if (saving) return;
    if (!actorUid) {
      setError('Không thể xác định người dùng tạo sản phẩm.');
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const created = await createProduct(input, actorUid);
      onCreated(created);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Không thể thêm sản phẩm.');
      setSaving(false);
    }
  }

  function requestClose() {
    if (saving) return;
    onClose();
  }

  return (
    <div
      className="purchase-product-modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={dialogRef}
        className="purchase-product-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="purchase-product-modal-heading">
          <div>
            <p className="eyebrow">Thêm nhanh hàng hóa</p>
            <h2 id={titleId}>Thêm sản phẩm mới</h2>
            <p className="muted">Sản phẩm được tạo trong danh mục chung và bắt đầu với tồn kho 0.</p>
          </div>
          <button className="button button--secondary purchase-touch" type="button" onClick={requestClose} disabled={saving}>Đóng</button>
        </div>

        <div className="purchase-product-modal-body">
          <ProductEditorForm
            mode="create"
            initialValues={initialValues}
            products={products}
            categories={categories}
            saving={saving}
            error={error}
            onSubmit={handleSubmit}
            onCancel={requestClose}
          />
        </div>
      </div>
    </div>
  );
}