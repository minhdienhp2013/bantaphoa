import {
  get,
  onDisconnect,
  onValue,
  push,
  ref,
  update,
  type OnDisconnect,
  type Unsubscribe,
} from 'firebase/database';
import { db } from '../../firebase/client';
import { invalidateReferenceCache } from '../../shared/data/referenceDataCache';
import type { AuditLog, Product } from '../../types/models';
import {
  buildLockFailurePreflight,
  buildProductPermanentDeletePreflight,
  toStoredProductRecord,
  type ProductPermanentDeletePreflight,
  type ProductReferenceSnapshots,
  type StoredProductRecord,
} from './productPermanentDelete';

export interface ProductInput {
  sku: string;
  name: string;
  aliases?: string[];
  barcode?: string;
  qrCode?: string;
  categoryId?: string;
  unit?: string;
  costPrice: number;
  salePrice: number;
  minStock?: number;
  active: boolean;
}

function requireDatabase() {
  if (!db) {
    throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  }
  return db;
}

function cleanOptional(value?: string) {
  const cleaned = value?.trim();
  return cleaned ? cleaned : undefined;
}

function normalizeProductAliases(values?: readonly string[]) {
  if (!values) return [];
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function buildAuditLog(
  id: string,
  actorUid: string,
  action: string,
  productId: string,
  summary: string,
  createdAt: number,
): AuditLog {
  return {
    id,
    actorUid,
    action,
    entityType: 'product',
    entityId: productId,
    summary,
    createdAt,
  };
}

export function subscribeProducts(
  onProducts: (products: Product[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const database = requireDatabase();

  return onValue(
    ref(database, 'products'),
    (snapshot) => {
      if (!snapshot.exists()) {
        onProducts([]);
        return;
      }

      const raw = snapshot.val() as Record<string, Product>;
      const products = Object.entries(raw)
        .map(([key, product]) => ({
          ...product,
          // Firebase child key is the physical identity. A malformed stored id is
          // intentionally not allowed to redirect selection or destructive writes.
          id: key,
          stockQuantity: Number(product.stockQuantity) || 0,
          stockVersion: Number(product.stockVersion) || 0,
        }))
        .sort((a, b) => {
          if (a.active !== b.active) return a.active ? -1 : 1;
          return a.name.localeCompare(b.name, 'vi');
        });

      onProducts(products);
    },
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải sản phẩm.')),
  );
}

export async function createProduct(input: ProductInput, actorUid: string): Promise<Product> {
  const database = requireDatabase();
  const productKey = push(ref(database, 'products')).key;
  const auditKey = push(ref(database, 'auditLogs')).key;

  if (!productKey || !auditKey) {
    throw new Error('Không thể tạo mã nội bộ cho sản phẩm.');
  }

  const now = Date.now();
  const aliases = normalizeProductAliases(input.aliases);
  const product: Product = {
    id: productKey,
    sku: input.sku.trim(),
    name: input.name.trim(),
    costPrice: Math.round(input.costPrice),
    salePrice: Math.round(input.salePrice),
    stockQuantity: 0,
    stockVersion: 0,
    active: input.active,
    createdAt: now,
    updatedAt: now,
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(cleanOptional(input.barcode) ? { barcode: cleanOptional(input.barcode) } : {}),
    ...(cleanOptional(input.qrCode) ? { qrCode: cleanOptional(input.qrCode) } : {}),
    ...(cleanOptional(input.categoryId) ? { categoryId: cleanOptional(input.categoryId) } : {}),
    ...(cleanOptional(input.unit) ? { unit: cleanOptional(input.unit) } : {}),
    ...(typeof input.minStock === 'number' ? { minStock: input.minStock } : {}),
  };

  const auditLog = buildAuditLog(
    auditKey,
    actorUid,
    'PRODUCT_CREATED',
    productKey,
    `Tạo sản phẩm ${product.sku} - ${product.name}`,
    now,
  );

  await update(ref(database), {
    [`products/${productKey}`]: product,
    [`auditLogs/${auditKey}`]: auditLog,
  });
  invalidateReferenceCache('products');

  return product;
}

export async function updateProduct(
  existing: Product,
  input: ProductInput,
  actorUid: string,
): Promise<Product> {
  const database = requireDatabase();
  const auditKey = push(ref(database, 'auditLogs')).key;

  if (!auditKey) {
    throw new Error('Không thể tạo nhật ký thay đổi sản phẩm.');
  }

  const now = Date.now();
  const barcode = cleanOptional(input.barcode);
  const qrCode = cleanOptional(input.qrCode);
  const unit = cleanOptional(input.unit);
  const categoryId = cleanOptional(input.categoryId);
  const aliasesProvided = Object.prototype.hasOwnProperty.call(input, 'aliases');
  const aliases = aliasesProvided
    ? normalizeProductAliases(input.aliases)
    : (existing.aliases ?? []);
  const product: Product = {
    id: existing.id,
    sku: input.sku.trim(),
    name: input.name.trim(),
    costPrice: Math.round(input.costPrice),
    salePrice: Math.round(input.salePrice),
    stockQuantity: existing.stockQuantity,
    stockVersion: Number(existing.stockVersion) || 0,
    active: input.active,
    createdAt: existing.createdAt,
    updatedAt: now,
    ...(categoryId ? { categoryId } : {}),
    ...(aliases.length > 0 ? { aliases } : {}),
    ...(barcode ? { barcode } : {}),
    ...(qrCode ? { qrCode } : {}),
    ...(unit ? { unit } : {}),
    ...(typeof input.minStock === 'number' ? { minStock: input.minStock } : {}),
    ...(existing.imageKey ? { imageKey: existing.imageKey } : {}),
    ...(typeof existing.imageUpdatedAt === 'number' ? { imageUpdatedAt: existing.imageUpdatedAt } : {}),
  };

  const auditLog = buildAuditLog(
    auditKey,
    actorUid,
    'PRODUCT_UPDATED',
    existing.id,
    `Sửa sản phẩm ${product.sku} - ${product.name}`,
    now,
  );

  // Chỉ cập nhật metadata. Không ghi lại stockQuantity/stockVersion từ state UI cũ,
  // vì tồn kho có thể vừa thay đổi trên một thiết bị khác.
  const updates: Record<string, unknown> = {
    [`products/${existing.id}/sku`]: product.sku,
    [`products/${existing.id}/name`]: product.name,
    [`products/${existing.id}/costPrice`]: product.costPrice,
    [`products/${existing.id}/salePrice`]: product.salePrice,
    [`products/${existing.id}/active`]: product.active,
    [`products/${existing.id}/updatedAt`]: now,
    [`products/${existing.id}/barcode`]: barcode ?? null,
    [`products/${existing.id}/qrCode`]: qrCode ?? null,
    [`products/${existing.id}/categoryId`]: categoryId ?? null,
    [`products/${existing.id}/unit`]: unit ?? null,
    [`products/${existing.id}/minStock`]: typeof input.minStock === 'number' ? input.minStock : null,
    [`auditLogs/${auditKey}`]: auditLog,
  };
  if (aliasesProvided) {
    updates[`products/${existing.id}/aliases`] = aliases.length > 0 ? aliases : null;
  }

  await update(ref(database), updates);
  invalidateReferenceCache('products');

  return product;
}

export async function patchProductImageMetadata(
  productId: string,
  metadata: { imageKey: string; imageUpdatedAt: number } | null,
  actorUid: string,
  action: 'PRODUCT_IMAGE_UPDATED' | 'PRODUCT_IMAGE_REMOVED',
): Promise<void> {
  const database = requireDatabase();
  const auditKey = push(ref(database, 'auditLogs')).key;
  if (!auditKey) throw new Error('Không thể tạo nhật ký thay đổi ảnh sản phẩm.');

  const now = Date.now();
  const auditLog = buildAuditLog(
    auditKey,
    actorUid,
    action,
    productId,
    action === 'PRODUCT_IMAGE_REMOVED' ? 'Xóa ảnh sản phẩm' : 'Cập nhật ảnh sản phẩm',
    now,
  );

  // Image metadata is intentionally patched by path. Never write a Product snapshot:
  // stockQuantity/stockVersion/lastStockOperationId may change concurrently on another device.
  await update(ref(database), {
    [`products/${productId}/imageKey`]: metadata?.imageKey ?? null,
    [`products/${productId}/imageUpdatedAt`]: metadata?.imageUpdatedAt ?? null,
    [`products/${productId}/updatedAt`]: now,
    [`auditLogs/${auditKey}`]: auditLog,
  });
  invalidateReferenceCache('products');
}

export async function setProductActive(
  product: Product,
  active: boolean,
  actorUid: string,
): Promise<void> {
  const database = requireDatabase();
  const auditKey = push(ref(database, 'auditLogs')).key;

  if (!auditKey) {
    throw new Error('Không thể tạo nhật ký thay đổi trạng thái sản phẩm.');
  }

  const now = Date.now();
  const auditLog = buildAuditLog(
    auditKey,
    actorUid,
    active ? 'PRODUCT_ACTIVATED' : 'PRODUCT_DEACTIVATED',
    product.id,
    `${active ? 'Kích hoạt' : 'Ngừng sử dụng'} sản phẩm ${product.sku} - ${product.name}`,
    now,
  );

  await update(ref(database), {
    [`products/${product.id}/active`]: active,
    [`products/${product.id}/updatedAt`]: now,
    [`auditLogs/${auditKey}`]: auditLog,
  });
  invalidateReferenceCache('products');
}

async function readPermanentDeletePreflight(
  selectedProducts: readonly Product[],
  allowedLockActorUid?: string,
): Promise<ProductPermanentDeletePreflight> {
  const database = requireDatabase();
  const [
    productsSnapshot,
    salesSnapshot,
    purchasesSnapshot,
    stockOutsSnapshot,
    movementsSnapshot,
    stocktakesSnapshot,
    deletionLocksSnapshot,
  ] = await Promise.all([
    get(ref(database, 'products')),
    get(ref(database, 'sales')),
    get(ref(database, 'purchases')),
    get(ref(database, 'stockOuts')),
    get(ref(database, 'stockMovements')),
    get(ref(database, 'stocktakes')),
    get(ref(database, 'productDeletionLocks')),
  ]);

  const rawProducts = (productsSnapshot.val() ?? {}) as Record<string, Product>;
  const currentProducts: StoredProductRecord[] = Object.entries(rawProducts)
    .map(([storageKey, product]) => toStoredProductRecord(storageKey, product));
  const references: ProductReferenceSnapshots = {
    sales: salesSnapshot.val(),
    purchases: purchasesSnapshot.val(),
    stockOuts: stockOutsSnapshot.val(),
    stockMovements: movementsSnapshot.val(),
    stocktakes: stocktakesSnapshot.val(),
  };

  return buildProductPermanentDeletePreflight(
    selectedProducts,
    currentProducts,
    references,
    deletionLocksSnapshot.val(),
    allowedLockActorUid,
  );
}

export async function preflightPermanentProductDeletion(
  selectedProducts: readonly Product[],
): Promise<ProductPermanentDeletePreflight> {
  return readPermanentDeletePreflight(selectedProducts);
}

function deletionLockUpdates(products: readonly StoredProductRecord[], actorUid: string) {
  const createdAt = Date.now();
  return Object.fromEntries(products.map((record) => [
    `productDeletionLocks/${record.storageKey}`,
    { productId: record.storageKey, actorUid, createdAt },
  ]));
}

async function registerDeletionLockDisconnectCleanup(productKeys: readonly string[]): Promise<OnDisconnect[]> {
  const database = requireDatabase();
  const handlers = productKeys.map((productKey) => onDisconnect(ref(database, `productDeletionLocks/${productKey}`)));
  try {
    await Promise.all(handlers.map((handler) => handler.remove()));
    return handlers;
  } catch {
    await Promise.allSettled(handlers.map((handler) => handler.cancel()));
    throw new Error('Không thể chuẩn bị cơ chế giải phóng khóa xóa an toàn. Không có sản phẩm nào bị xóa.');
  }
}

async function cancelDeletionLockDisconnectCleanup(handlers: readonly OnDisconnect[]) {
  await Promise.allSettled(handlers.map((handler) => handler.cancel()));
}

async function releaseDeletionLocks(productKeys: readonly string[]) {
  if (productKeys.length === 0) return;
  const database = requireDatabase();
  await update(ref(database), Object.fromEntries(productKeys.map((productKey) => [
    `productDeletionLocks/${productKey}`,
    null,
  ])));
}

export async function deleteProductsPermanently(
  selectedProducts: readonly Product[],
  actorUid: string,
): Promise<{ deleted: number; preflight: ProductPermanentDeletePreflight }> {
  if (!actorUid) throw new Error('Không thể xác định người dùng xóa sản phẩm.');

  const initialPreflight = await readPermanentDeletePreflight(selectedProducts);
  if (!initialPreflight.canDeleteAll) return { deleted: 0, preflight: initialPreflight };

  const productKeys = initialPreflight.eligibleProducts.map((record) => record.storageKey);
  const disconnectCleanup = await registerDeletionLockDisconnectCleanup(productKeys);
  let locksAcquired = false;
  let committed = false;

  try {
    try {
      await update(ref(requireDatabase()), deletionLockUpdates(initialPreflight.eligibleProducts, actorUid));
      locksAcquired = true;
    } catch {
      await cancelDeletionLockDisconnectCleanup(disconnectCleanup);
      const freshPreflight = await readPermanentDeletePreflight(selectedProducts);
      return { deleted: 0, preflight: buildLockFailurePreflight(freshPreflight) };
    }

    // Once locks exist, Rules reject every new Product reference and every non-delete
    // Product write. Re-read the full eligibility state inside that exclusion window.
    const lockedPreflight = await readPermanentDeletePreflight(selectedProducts, actorUid);
    if (!lockedPreflight.canDeleteAll) {
      return { deleted: 0, preflight: lockedPreflight };
    }

    const database = requireDatabase();
    const now = Date.now();
    const updates: Record<string, unknown> = {};

    for (const record of lockedPreflight.eligibleProducts) {
      const productKey = record.storageKey;
      const product = record.product;
      const auditKey = push(ref(database, 'auditLogs')).key;
      if (!auditKey) throw new Error('Không thể tạo nhật ký xóa sản phẩm.');
      const audit = buildAuditLog(
        auditKey,
        actorUid,
        'PRODUCT_DELETED',
        productKey,
        `Xóa vĩnh viễn sản phẩm ${product.sku} - ${product.name}`,
        now,
      );
      updates[`products/${productKey}`] = null;
      updates[`auditLogs/${auditKey}`] = audit;
      updates[`productDeletionLocks/${productKey}`] = null;
    }

    await update(ref(database), updates);
    invalidateReferenceCache('products');
    committed = true;
    locksAcquired = false;
    await cancelDeletionLockDisconnectCleanup(disconnectCleanup);
    return { deleted: lockedPreflight.eligibleProducts.length, preflight: lockedPreflight };
  } catch {
    throw new Error('Không thể hoàn tất xóa vĩnh viễn an toàn. Không có sản phẩm nào được báo là đã xóa.');
  } finally {
    if (locksAcquired && !committed) {
      try {
        await releaseDeletionLocks(productKeys);
        await cancelDeletionLockDisconnectCleanup(disconnectCleanup);
      } catch {
        // onDisconnect handlers stay registered as the crash/network fail-safe.
      }
    }
  }
}