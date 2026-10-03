import { get, onValue, push, ref, type Unsubscribe } from 'firebase/database';
import { db } from '../../firebase/client';
import type { Purchase, PurchaseItem, Supplier } from '../../types/models';
import { commitStockOperation } from '../inventory/inventoryService';
import { roundStockQuantity } from '../inventory/stockOperationCas';

export interface PurchaseLineInput {
  productId: string;
  quantity: number;
  unitCost: number;
  salePrice: number;
}

export interface CreatePurchaseInput {
  supplierId?: string;
  supplierName?: string;
  note?: string;
  items: PurchaseLineInput[];
}

function requireDatabase() {
  if (!db) throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  return db;
}

function makeCode(prefix: string, key: string) {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${prefix}-${y}${m}${d}-${key.slice(-6).toUpperCase()}`;
}

function normalizePurchaseQuantity(value: unknown) {
  const quantity = roundStockQuantity(Number(value));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Số lượng nhập phải lớn hơn 0.');
  }
  return quantity;
}

function validateLines(items: PurchaseLineInput[]) {
  if (items.length === 0) throw new Error('Phiếu nhập phải có ít nhất một sản phẩm.');
  const seen = new Set<string>();
  for (const item of items) {
    if (!item.productId) throw new Error('Vui lòng chọn sản phẩm cho tất cả các dòng.');
    if (seen.has(item.productId)) throw new Error('Một sản phẩm chỉ nên xuất hiện một lần trong phiếu nhập.');
    seen.add(item.productId);
    normalizePurchaseQuantity(item.quantity);
    if (!Number.isFinite(item.unitCost) || item.unitCost < 0) throw new Error('Giá nhập không hợp lệ.');
    if (!Number.isFinite(item.salePrice) || item.salePrice < 0) throw new Error('Giá bán không hợp lệ.');
  }
}

export async function createPurchase(input: CreatePurchaseInput, actorUid: string): Promise<Purchase> {
  if (!actorUid) throw new Error('Phiên đăng nhập không hợp lệ.');
  validateLines(input.items);
  const database = requireDatabase();
  const productsSnapshot = await get(ref(database, 'products'));
  const products = (productsSnapshot.val() ?? {}) as Record<string, { id?: string; sku?: string; name?: string }>;
  const id = push(ref(database, 'purchases')).key;
  if (!id) throw new Error('Không thể tạo mã phiếu nhập.');

  const now = Date.now();
  const items: PurchaseItem[] = input.items.map((line) => {
    const product = products[line.productId];
    if (!product?.sku || !product.name) throw new Error(`Không tìm thấy sản phẩm ${line.productId}.`);
    const quantity = normalizePurchaseQuantity(line.quantity);
    return {
      productId: line.productId,
      sku: product.sku,
      name: product.name,
      quantity,
      unitCost: Math.round(line.unitCost),
      lineTotal: Math.round(quantity * line.unitCost),
    };
  });

  const purchase: Purchase = {
    id,
    code: makeCode('PN', id),
    items,
    total: items.reduce((sum, item) => sum + item.lineTotal, 0),
    status: 'completed',
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
    ...(input.supplierId?.trim() ? { supplierId: input.supplierId.trim() } : {}),
    ...(input.supplierName?.trim() ? { supplierName: input.supplierName.trim() } : {}),
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };

  const productFieldUpdates: Record<string, Record<string, unknown>> = {};
  items.forEach((item, index) => {
    productFieldUpdates[item.productId] = {
      costPrice: item.unitCost,
      salePrice: Math.round(input.items[index].salePrice),
    };
  });

  await commitStockOperation({
    type: 'PURCHASE',
    referenceType: 'purchase',
    referenceId: id,
    actorUid,
    changes: items.map((item) => ({
      productId: item.productId,
      quantityDelta: item.quantity,
      unitCost: item.unitCost,
      note: `Nhập hàng ${purchase.code}`,
    })),
    productFieldUpdates,
    extraUpdates: { [`purchases/${id}`]: purchase },
    audit: {
      action: 'PURCHASE_COMPLETED',
      entityType: 'purchase',
      entityId: id,
      summary: `Hoàn tất phiếu nhập ${purchase.code}, ${items.length} mặt hàng`,
    },
  });

  return purchase;
}

export async function cancelPurchase(purchaseId: string, actorUid: string): Promise<void> {
  if (!actorUid) throw new Error('Phiên đăng nhập không hợp lệ.');
  if (!purchaseId) throw new Error('Thiếu mã phiếu nhập.');
  const database = requireDatabase();
  const snapshot = await get(ref(database, `purchases/${purchaseId}`));
  if (!snapshot.exists()) throw new Error('Không tìm thấy phiếu nhập.');
  const purchase = snapshot.val() as Purchase;
  if (purchase.status === 'cancelled') return;
  if (purchase.status !== 'completed') throw new Error('Phiếu nhập không ở trạng thái có thể hủy.');

  const linkedDebtSnapshot = await get(ref(database, `debts/purchase_${purchaseId}`));
  if (linkedDebtSnapshot.exists() && linkedDebtSnapshot.child('status').val() !== 'cancelled') {
    throw new Error('Phiếu nhập đang có công nợ. Hãy hoàn tác các lần trả tiền (nếu có) và hủy công nợ trước khi hủy phiếu nhập.');
  }

  const now = Date.now();
  await commitStockOperation({
    type: 'PURCHASE_RETURN',
    referenceType: 'purchase',
    referenceId: purchaseId,
    actorUid,
    changes: purchase.items.map((item) => ({
      productId: item.productId,
      quantityDelta: -Math.abs(item.quantity),
      unitCost: item.unitCost,
      note: `Hủy phiếu nhập ${purchase.code}`,
    })),
    extraUpdates: {
      [`purchases/${purchaseId}/status`]: 'cancelled',
      [`purchases/${purchaseId}/updatedAt`]: now,
    },
    audit: {
      action: 'PURCHASE_CANCELLED',
      entityType: 'purchase',
      entityId: purchaseId,
      summary: `Hủy phiếu nhập ${purchase.code} và hoàn tác tồn kho`,
    },
  });
}

export function subscribePurchases(
  onData: (purchases: Purchase[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const database = requireDatabase();
  return onValue(ref(database, 'purchases'), (snapshot) => {
    const raw = snapshot.val() as Record<string, Purchase> | null;
    onData(raw ? Object.entries(raw).map(([id, item]) => ({ ...item, id: item.id || id })).sort((a, b) => b.createdAt - a.createdAt) : []);
  }, (error) => onError(error instanceof Error ? error : new Error('Không thể tải phiếu nhập.')));
}

export function subscribeSuppliers(
  onData: (suppliers: Supplier[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const database = requireDatabase();
  return onValue(ref(database, 'suppliers'), (snapshot) => {
    const raw = snapshot.val() as Record<string, Supplier> | null;
    onData(raw ? Object.entries(raw).map(([id, item]) => ({ ...item, id: item.id || id })).filter((item) => item.active).sort((a, b) => a.name.localeCompare(b.name, 'vi')) : []);
  }, (error) => onError(error instanceof Error ? error : new Error('Không thể tải nhà cung cấp.')));
}
