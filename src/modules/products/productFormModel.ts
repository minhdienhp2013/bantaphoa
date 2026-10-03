import type { Product } from '../../types/models';
import type { ProductInput } from './productService';

export interface ProductFormState {
  sku: string;
  name: string;
  aliases: string;
  barcode: string;
  qrCode: string;
  categoryId: string;
  unit: string;
  costPrice: string;
  salePrice: string;
  minStock: string;
  active: boolean;
}

export type ProductFormInitialValues = Partial<ProductFormState>;

const DEFAULT_PRODUCT_FORM_STATE: ProductFormState = {
  sku: '',
  name: '',
  aliases: '',
  barcode: '',
  qrCode: '',
  categoryId: '',
  unit: '',
  costPrice: '0',
  salePrice: '0',
  minStock: '',
  active: true,
};

export function createProductFormState(initialValues: ProductFormInitialValues = {}): ProductFormState {
  return {
    ...DEFAULT_PRODUCT_FORM_STATE,
    ...initialValues,
  };
}

export function productToFormState(product: Product): ProductFormState {
  return createProductFormState({
    sku: product.sku,
    name: product.name,
    aliases: (product.aliases ?? []).join('; '),
    barcode: product.barcode ?? '',
    qrCode: product.qrCode ?? '',
    categoryId: product.categoryId ?? '',
    unit: product.unit ?? '',
    costPrice: String(product.costPrice),
    salePrice: String(product.salePrice),
    minStock: typeof product.minStock === 'number' ? String(product.minStock) : '',
    active: product.active,
  });
}

function normalizeSku(value: string) {
  return value.trim().toLocaleLowerCase('vi');
}

function parseAliases(value: string) {
  return [...new Set(value.split(';').map((alias) => alias.trim()).filter(Boolean))];
}

export function getProductFormValidationError(
  form: ProductFormState,
  products: readonly Product[],
  editingProductId?: string,
): string | null {
  const sku = form.sku.trim();
  const name = form.name.trim();
  const costPrice = Number(form.costPrice);
  const salePrice = Number(form.salePrice);
  const minStock = form.minStock.trim() ? Number(form.minStock) : undefined;

  if (!sku) return 'SKU là bắt buộc.';
  if (!name) return 'Tên sản phẩm là bắt buộc.';
  if (!Number.isFinite(costPrice) || costPrice < 0) return 'Giá vốn phải là số từ 0 trở lên.';
  if (!Number.isFinite(salePrice) || salePrice < 0) return 'Giá bán phải là số từ 0 trở lên.';
  if (typeof minStock === 'number' && (!Number.isFinite(minStock) || minStock < 0)) {
    return 'Tồn tối thiểu phải là số từ 0 trở lên.';
  }

  const others = products.filter((product) => product.id !== editingProductId);
  if (others.some((product) => normalizeSku(product.sku) === normalizeSku(sku))) {
    return `SKU “${sku}” đã được sử dụng.`;
  }

  const barcode = form.barcode.trim();
  if (barcode && others.some((product) => product.barcode?.trim() === barcode)) {
    return `Barcode “${barcode}” đã được sử dụng.`;
  }

  const qrCode = form.qrCode.trim();
  if (qrCode && others.some((product) => product.qrCode?.trim() === qrCode)) {
    return `Mã QR “${qrCode}” đã được sử dụng.`;
  }

  return null;
}

export function productFormToInput(form: ProductFormState): ProductInput {
  return {
    sku: form.sku.trim(),
    name: form.name.trim(),
    aliases: parseAliases(form.aliases),
    barcode: form.barcode.trim() || undefined,
    qrCode: form.qrCode.trim() || undefined,
    ...(form.categoryId.trim() ? { categoryId: form.categoryId.trim() } : {}),
    unit: form.unit.trim() || undefined,
    costPrice: Number(form.costPrice),
    salePrice: Number(form.salePrice),
    minStock: form.minStock.trim() ? Number(form.minStock) : undefined,
    active: form.active,
  };
}