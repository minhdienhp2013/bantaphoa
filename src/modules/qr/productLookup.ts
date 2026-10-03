import type { Product } from '../../types/models';

export type ProductCodeField = 'qrCode' | 'barcode' | 'sku';

export interface ProductCodeMatch {
  product: Product;
  field: ProductCodeField;
}

function normalize(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase('vi') ?? '';
}

export function findProductByScannedCode(products: Product[], code: string): ProductCodeMatch | null {
  const target = normalize(code);
  if (!target) return null;

  const fields: ProductCodeField[] = ['qrCode', 'barcode', 'sku'];
  for (const field of fields) {
    const product = products.find((item) => normalize(item[field]) === target);
    if (product) return { product, field };
  }
  return null;
}

export function createDuplicateSuppressor(windowMs = 1400) {
  let lastCode = '';
  let lastAcceptedAt = 0;

  return {
    shouldAccept(code: string, now = Date.now()) {
      const normalized = code.trim();
      if (!normalized) return false;
      if (normalized === lastCode && now - lastAcceptedAt < windowMs) return false;
      lastCode = normalized;
      lastAcceptedAt = now;
      return true;
    },
    reset() {
      lastCode = '';
      lastAcceptedAt = 0;
    },
  };
}
