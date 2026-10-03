import { useEffect, useMemo, useState, type FormEvent } from 'react';
import VndMoneyInput from '../../shared/numeric/VndMoneyInput';
import type { Category, Product } from '../../types/models';
import type { ProductInput } from './productService';
import {
  createProductFormState,
  getProductFormValidationError,
  productFormToInput,
  type ProductFormInitialValues,
  type ProductFormState,
} from './productFormModel';
import './productEditorModal.css';

export type ProductEditorMode = 'create' | 'edit';

export interface ProductStockAdjustmentDraft {
  quantity: number;
  note?: string;
}

interface ProductEditorFormProps {
  mode: ProductEditorMode;
  initialValues?: ProductFormInitialValues;
  products: readonly Product[];
  categories: readonly Category[];
  editingProductId?: string;
  currentStockQuantity?: number;
  canAdjustStock?: boolean;
  saving: boolean;
  error?: string | null;
  onSubmit: (input: ProductInput, stockAdjustment?: ProductStockAdjustmentDraft) => void | Promise<void>;
  onCancel: () => void;
}

export default function ProductEditorForm({
  mode,
  initialValues,
  products,
  categories,
  editingProductId,
  currentStockQuantity = 0,
  canAdjustStock = false,
  saving,
  error,
  onSubmit,
  onCancel,
}: ProductEditorFormProps) {
  const initialSignature = useMemo(
    () => JSON.stringify([
      initialValues?.sku ?? '',
      initialValues?.name ?? '',
      initialValues?.aliases ?? '',
      initialValues?.barcode ?? '',
      initialValues?.qrCode ?? '',
      initialValues?.categoryId ?? '',
      initialValues?.unit ?? '',
      initialValues?.costPrice ?? '0',
      initialValues?.salePrice ?? '0',
      initialValues?.minStock ?? '',
      initialValues?.active ?? true,
    ]),
    [
      initialValues?.sku,
      initialValues?.name,
      initialValues?.aliases,
      initialValues?.barcode,
      initialValues?.qrCode,
      initialValues?.categoryId,
      initialValues?.unit,
      initialValues?.costPrice,
      initialValues?.salePrice,
      initialValues?.minStock,
      initialValues?.active,
    ],
  );
  const [form, setForm] = useState<ProductFormState>(() => createProductFormState(initialValues));
  const [stockQuantity, setStockQuantity] = useState(() => String(currentStockQuantity));
  const [stockAdjustmentNote, setStockAdjustmentNote] = useState('');
  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setForm(createProductFormState(initialValues));
    setStockQuantity(String(currentStockQuantity));
    setStockAdjustmentNote('');
    setValidationError(null);
  }, [mode, initialSignature, initialValues, currentStockQuantity]);

  function patchForm(patch: Partial<ProductFormState>) {
    setForm((current) => ({ ...current, ...patch }));
    setValidationError(null);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;

    const nextError = getProductFormValidationError(form, products, editingProductId);
    if (nextError) {
      setValidationError(nextError);
      return;
    }

    let stockAdjustment: ProductStockAdjustmentDraft | undefined;
    if (mode === 'edit' && canAdjustStock) {
      const stockInput = stockQuantity.trim();
      const nextStock = Number(stockInput);
      if (!stockInput || !Number.isFinite(nextStock) || nextStock < 0) {
        setValidationError('Số lượng tồn kho phải là số từ 0 trở lên.');
        return;
      }

      const normalizedCurrent = Math.round((Number(currentStockQuantity) || 0) * 1000) / 1000;
      const normalizedNext = Math.round(nextStock * 1000) / 1000;
      if (normalizedNext !== normalizedCurrent) {
        stockAdjustment = {
          quantity: normalizedNext,
          ...(stockAdjustmentNote.trim() ? { note: stockAdjustmentNote.trim() } : {}),
        };
      }
    }

    setValidationError(null);
    void onSubmit(productFormToInput(form), stockAdjustment);
  }

  return (
    <form className="product-form" onSubmit={handleSubmit}>
      <label>SKU *<input value={form.sku} onChange={(event) => patchForm({ sku: event.target.value })} required /></label>
      <label className="form-field--wide">Tên sản phẩm *<input value={form.name} onChange={(event) => patchForm({ name: event.target.value })} required /></label>
      <label className="form-field--wide">Tên gọi khác<input placeholder="bàn ăn; bàn mặt đá; bàn 4 ghế" value={form.aliases} onChange={(event) => patchForm({ aliases: event.target.value })} /></label>
      <label>Barcode<input value={form.barcode} onChange={(event) => patchForm({ barcode: event.target.value })} /></label>
      <label>Mã QR<input value={form.qrCode} onChange={(event) => patchForm({ qrCode: event.target.value })} /></label>
      <label>Danh mục hàng hóa<select value={form.categoryId} onChange={(event) => patchForm({ categoryId: event.target.value })}><option value="">Chưa phân loại</option>{categories.filter((category) => category.active || category.id === form.categoryId).map((category) => <option key={category.id} value={category.id}>{category.name}{category.active ? '' : ' (ngừng sử dụng)'}</option>)}</select></label>
      <label>Đơn vị tính<input placeholder="Cái, hộp, bộ..." value={form.unit} onChange={(event) => patchForm({ unit: event.target.value })} /></label>
      <VndMoneyInput label="Giá vốn hiện tại (VND)" value={form.costPrice} onChange={(value) => patchForm({ costPrice: value })} />
      <VndMoneyInput label="Giá bán (VND)" value={form.salePrice} onChange={(value) => patchForm({ salePrice: value })} />
      <label>Tồn tối thiểu<input type="number" min="0" step="1" placeholder="Không cảnh báo" value={form.minStock} onChange={(event) => patchForm({ minStock: event.target.value })} /></label>
      {mode === 'edit' ? (
        <>
          <label className="product-stock-field">
            Số lượng tồn kho
            <input
              type="number"
              min="0"
              step="0.001"
              inputMode="decimal"
              value={stockQuantity}
              onChange={(event) => { setStockQuantity(event.target.value); setValidationError(null); }}
              readOnly={!canAdjustStock}
              aria-describedby="product-stock-help"
            />
            <small id="product-stock-help">
              {canAdjustStock
                ? `Tồn hiện tại: ${currentStockQuantity}. Thay đổi sẽ được ghi vào biến động kho.`
                : 'Bạn cần quyền Kho để điều chỉnh số lượng tồn.'}
            </small>
          </label>
          {canAdjustStock ? (
            <label className="form-field--wide">
              Lý do điều chỉnh tồn kho
              <input
                placeholder="Ví dụ: kiểm kê thực tế, hàng hỏng, sai số liệu..."
                value={stockAdjustmentNote}
                onChange={(event) => setStockAdjustmentNote(event.target.value)}
              />
            </label>
          ) : null}
        </>
      ) : null}
      <label className="checkbox-field"><input type="checkbox" checked={form.active} onChange={(event) => patchForm({ active: event.target.checked })} />Đang kinh doanh</label>

      {validationError || error ? <p className="form-error form-field--full" role="alert">{validationError ?? error}</p> : null}
      <div className="form-actions form-field--full">
        <button className="button button--secondary goods-touch" type="button" onClick={onCancel} disabled={saving}>Hủy</button>
        <button className="button button--primary goods-touch" type="submit" disabled={saving}>{saving ? 'Đang lưu...' : mode === 'edit' ? 'Lưu thay đổi' : 'Tạo sản phẩm'}</button>
      </div>
    </form>
  );
}