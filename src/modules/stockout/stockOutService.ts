import { get, onValue, push, ref, type Unsubscribe } from 'firebase/database';
import { db } from '../../firebase/client';
import type { StockOut, StockOutItem, StockOutReason } from '../../types/models';
import { commitStockOperation } from '../inventory/inventoryService';
import { roundStockQuantity } from '../inventory/stockOperationCas';

export interface StockOutLineInput { productId: string; quantity: number; }
export interface CreateStockOutInput { reason: StockOutReason; note?: string; items: StockOutLineInput[]; }

function requireDatabase() {
  if (!db) throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  return db;
}

function normalizeStockOutQuantity(value: unknown) {
  const quantity = roundStockQuantity(Number(value));
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error('Số lượng xuất phải lớn hơn 0.');
  }
  return quantity;
}

function makeCode(key: string) {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `PX-${y}${m}${d}-${key.slice(-6).toUpperCase()}`;
}

export async function createStockOut(input: CreateStockOutInput, actorUid: string): Promise<StockOut> {
  if (!actorUid) throw new Error('Phiên đăng nhập không hợp lệ.');
  if (input.items.length === 0) throw new Error('Phiếu xuất phải có ít nhất một sản phẩm.');
  const seen = new Set<string>();
  for (const item of input.items) {
    if (!item.productId) throw new Error('Vui lòng chọn sản phẩm cho tất cả các dòng.');
    if (seen.has(item.productId)) throw new Error('Một sản phẩm chỉ nên xuất hiện một lần trong phiếu xuất.');
    seen.add(item.productId);
    normalizeStockOutQuantity(item.quantity);
  }

  const database = requireDatabase();
  const productsSnapshot = await get(ref(database, 'products'));
  const products = (productsSnapshot.val() ?? {}) as Record<string, { id?: string; sku?: string; name?: string; costPrice?: number }>;
  const id = push(ref(database, 'stockOuts')).key;
  if (!id) throw new Error('Không thể tạo mã phiếu xuất.');
  const now = Date.now();
  const items: StockOutItem[] = input.items.map((line) => {
    const product = products[line.productId];
    if (!product?.sku || !product.name) throw new Error(`Không tìm thấy sản phẩm ${line.productId}.`);
    return {
      productId: line.productId,
      sku: product.sku,
      name: product.name,
      quantity: normalizeStockOutQuantity(line.quantity),
      costPrice: Math.round(Number(product.costPrice) || 0),
    };
  });

  const stockOut: StockOut = {
    id,
    code: makeCode(id),
    reason: input.reason,
    items,
    status: 'completed',
    createdBy: actorUid,
    createdAt: now,
    updatedAt: now,
    ...(input.note?.trim() ? { note: input.note.trim() } : {}),
  };

  await commitStockOperation({
    type: 'STOCK_OUT',
    referenceType: 'stockout',
    referenceId: id,
    actorUid,
    changes: items.map((item) => ({
      productId: item.productId,
      quantityDelta: -Math.abs(item.quantity),
      unitCost: item.costPrice,
      note: `Xuất hàng ${stockOut.code}`,
    })),
    extraUpdates: { [`stockOuts/${id}`]: stockOut },
    audit: {
      action: 'STOCK_OUT_COMPLETED',
      entityType: 'stockout',
      entityId: id,
      summary: `Hoàn tất phiếu xuất ${stockOut.code}, ${items.length} mặt hàng`,
    },
  });
  return stockOut;
}

export async function cancelStockOut(stockOutId: string, actorUid: string): Promise<void> {
  if (!actorUid) throw new Error('Phiên đăng nhập không hợp lệ.');
  if (!stockOutId) throw new Error('Thiếu mã phiếu xuất.');
  const database = requireDatabase();
  const snapshot = await get(ref(database, `stockOuts/${stockOutId}`));
  if (!snapshot.exists()) throw new Error('Không tìm thấy phiếu xuất.');
  const stockOut = snapshot.val() as StockOut;
  if (stockOut.status === 'cancelled') return;
  if (stockOut.status !== 'completed') throw new Error('Phiếu xuất không ở trạng thái có thể hủy.');
  const now = Date.now();

  await commitStockOperation({
    type: 'STOCK_OUT_REVERSAL',
    referenceType: 'stockout',
    referenceId: stockOutId,
    actorUid,
    changes: stockOut.items.map((item) => ({
      productId: item.productId,
      quantityDelta: Math.abs(item.quantity),
      unitCost: item.costPrice,
      note: `Hủy phiếu xuất ${stockOut.code}`,
    })),
    extraUpdates: {
      [`stockOuts/${stockOutId}/status`]: 'cancelled',
      [`stockOuts/${stockOutId}/updatedAt`]: now,
    },
    audit: {
      action: 'STOCK_OUT_CANCELLED',
      entityType: 'stockout',
      entityId: stockOutId,
      summary: `Hủy phiếu xuất ${stockOut.code} và hoàn tồn kho`,
    },
  });
}

export function subscribeStockOuts(
  onData: (records: StockOut[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const database = requireDatabase();
  return onValue(ref(database, 'stockOuts'), (snapshot) => {
    const raw = snapshot.val() as Record<string, StockOut> | null;
    onData(raw ? Object.entries(raw).map(([id, item]) => ({ ...item, id: item.id || id })).sort((a, b) => b.createdAt - a.createdAt) : []);
  }, (error) => onError(error instanceof Error ? error : new Error('Không thể tải phiếu xuất.')));
}
