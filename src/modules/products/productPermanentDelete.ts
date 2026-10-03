import type { Product } from '../../types/models';

export const PRODUCT_PERMANENT_DELETE_REFERENCE_NODES = [
  'sales',
  'purchases',
  'stockOuts',
  'stockMovements',
  'stocktakes',
] as const;

export type ProductPermanentDeleteReferenceNode = typeof PRODUCT_PERMANENT_DELETE_REFERENCE_NODES[number];

export interface ProductReferenceSnapshots {
  sales: unknown;
  purchases: unknown;
  stockOuts: unknown;
  stockMovements: unknown;
  stocktakes: unknown;
}

export interface ProductDeletionLock {
  productId: string;
  actorUid: string;
  createdAt: number;
}

export interface StoredProductRecord {
  storageKey: string;
  storedId?: string;
  product: Product;
}

export interface ProductPermanentDeleteBlocker {
  productId: string;
  sku: string;
  name: string;
  reasons: string[];
}

export interface ProductPermanentDeletePreflight {
  selected: number;
  canDeleteAll: boolean;
  eligibleProducts: StoredProductRecord[];
  blockers: ProductPermanentDeleteBlocker[];
}

function objectValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return Object.values(value as Record<string, unknown>);
}

function nestedItemsReferenceProduct(collection: unknown, productId: string) {
  return objectValues(collection).some((record) => {
    if (!record || typeof record !== 'object') return false;
    const items = (record as { items?: unknown }).items;
    return objectValues(items).some((item) => {
      if (!item || typeof item !== 'object') return false;
      return (item as { productId?: unknown }).productId === productId;
    });
  });
}

function stockMovementsReferenceProduct(collection: unknown, productId: string) {
  return objectValues(collection).some((movement) => {
    if (!movement || typeof movement !== 'object') return false;
    return (movement as { productId?: unknown }).productId === productId;
  });
}

function readDeletionLock(locks: unknown, productId: string): ProductDeletionLock | null {
  if (!locks || typeof locks !== 'object') return null;
  const value = (locks as Record<string, unknown>)[productId];
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Partial<ProductDeletionLock>;
  if (candidate.productId !== productId || typeof candidate.actorUid !== 'string') return null;
  return {
    productId,
    actorUid: candidate.actorUid,
    createdAt: Number(candidate.createdAt) || 0,
  };
}

export function toStoredProductRecord(storageKey: string, rawProduct: Product): StoredProductRecord {
  const storedId = typeof rawProduct.id === 'string' && rawProduct.id ? rawProduct.id : undefined;
  return {
    storageKey,
    ...(storedId ? { storedId } : {}),
    product: { ...rawProduct, id: storageKey },
  };
}

export function findProductPermanentDeleteReferenceNodes(
  productId: string,
  references: ProductReferenceSnapshots,
): ProductPermanentDeleteReferenceNode[] {
  const matched: ProductPermanentDeleteReferenceNode[] = [];
  if (nestedItemsReferenceProduct(references.sales, productId)) matched.push('sales');
  if (nestedItemsReferenceProduct(references.purchases, productId)) matched.push('purchases');
  if (nestedItemsReferenceProduct(references.stockOuts, productId)) matched.push('stockOuts');
  if (stockMovementsReferenceProduct(references.stockMovements, productId)) matched.push('stockMovements');
  if (nestedItemsReferenceProduct(references.stocktakes, productId)) matched.push('stocktakes');
  return matched;
}

export function getProductPermanentDeleteReasons(
  record: StoredProductRecord,
  references: ProductReferenceSnapshots,
  deletionLocks: unknown,
  allowedLockActorUid?: string,
): string[] {
  const reasons: string[] = [];
  const { product, storageKey, storedId } = record;

  if (storedId && storedId !== storageKey) {
    reasons.push('Dữ liệu định danh sản phẩm không hợp lệ.');
  }

  if (!Number.isFinite(product.stockQuantity) || product.stockQuantity !== 0) {
    reasons.push(`Còn tồn kho (${String(product.stockQuantity)}).`);
  }

  const stockVersion = typeof product.stockVersion === 'undefined' ? 0 : product.stockVersion;
  if (!Number.isFinite(stockVersion) || stockVersion !== 0) {
    reasons.push(`stockVersion phải bằng 0 nhưng hiện là ${String(product.stockVersion)}.`);
  }

  const referenceNodes = findProductPermanentDeleteReferenceNodes(storageKey, references);
  if (referenceNodes.length > 0) {
    reasons.push(`Đã có lịch sử giao dịch (${referenceNodes.join(', ')}).`);
  }

  const lock = readDeletionLock(deletionLocks, storageKey);
  if (lock && lock.actorUid !== allowedLockActorUid) {
    reasons.push('Sản phẩm đang được khóa bởi một thao tác xóa khác.');
  }

  return reasons;
}

export function buildProductPermanentDeletePreflight(
  selectedProducts: readonly Product[],
  currentProducts: readonly StoredProductRecord[],
  references: ProductReferenceSnapshots,
  deletionLocks: unknown = null,
  allowedLockActorUid?: string,
): ProductPermanentDeletePreflight {
  const currentByStorageKey = new Map(currentProducts.map((record) => [record.storageKey, record]));
  const uniqueSelected = [...new Map(selectedProducts.map((product) => [product.id, product])).values()];
  const blockers: ProductPermanentDeleteBlocker[] = [];
  const candidates: StoredProductRecord[] = [];

  for (const selected of uniqueSelected) {
    const current = currentByStorageKey.get(selected.id);
    if (!current) {
      blockers.push({
        productId: selected.id,
        sku: selected.sku,
        name: selected.name,
        reasons: ['Sản phẩm không còn tồn tại tại Firebase child key đã chọn.'],
      });
      continue;
    }

    const reasons = getProductPermanentDeleteReasons(
      current,
      references,
      deletionLocks,
      allowedLockActorUid,
    );
    if (reasons.length > 0) {
      blockers.push({
        productId: current.storageKey,
        sku: current.product.sku,
        name: current.product.name,
        reasons,
      });
      continue;
    }

    candidates.push(current);
  }

  const canDeleteAll = uniqueSelected.length > 0 && blockers.length === 0;
  return {
    selected: uniqueSelected.length,
    canDeleteAll,
    eligibleProducts: canDeleteAll ? candidates : [],
    blockers,
  };
}

export function buildLockFailurePreflight(
  source: ProductPermanentDeletePreflight,
): ProductPermanentDeletePreflight {
  if (source.blockers.length > 0) return source;
  return {
    selected: source.selected,
    canDeleteAll: false,
    eligibleProducts: [],
    blockers: source.eligibleProducts.map((record) => ({
      productId: record.storageKey,
      sku: record.product.sku,
      name: record.product.name,
      reasons: ['Không thể khóa sản phẩm để xóa an toàn. Dữ liệu có thể vừa thay đổi; hãy thử lại.'],
    })),
  };
}
