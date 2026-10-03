import { get, onValue, push, ref, update, type Unsubscribe } from 'firebase/database';
import { db } from '../../firebase/client';
import type { AuditLog, Product, Stocktake, StocktakeItem } from '../../types/models';
import { commitStockOperation, getProductsOnce } from '../inventory/inventoryService';
import { roundStockQuantity } from '../inventory/stockOperationCas';
import {
  buildStocktakeApplyChanges,
  getStocktakeApplyModeLabel,
  type StocktakeApplyMode,
} from './stocktakeApplyPlan';

export interface StocktakeCountInput { productId: string; actualQuantity: number; }

function requireDatabase() {
  if (!db) throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  return db;
}

function makeCode(key: string) {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `KK-${y}${m}${d}-${key.slice(-6).toUpperCase()}`;
}

function normalizeStocktakeQuantity(value: unknown) {
  const quantity = roundStockQuantity(Number(value));
  if (!Number.isFinite(quantity) || quantity < 0) {
    throw new Error('Số lượng thực tế không hợp lệ.');
  }
  return quantity;
}

function validateCounts(counts: StocktakeCountInput[]) {
  if (counts.length === 0) throw new Error('Hãy nhập số lượng thực tế cho ít nhất một sản phẩm.');
  const seen = new Set<string>();
  for (const count of counts) {
    if (!count.productId) throw new Error('Dòng kiểm kê thiếu sản phẩm.');
    if (seen.has(count.productId)) throw new Error('Sản phẩm bị lặp trong phiếu kiểm kê.');
    seen.add(count.productId);
    normalizeStocktakeQuantity(count.actualQuantity);
  }
}

export async function createStocktakeDraft(
  counts: StocktakeCountInput[],
  actorUid: string,
  note?: string,
): Promise<Stocktake> {
  if (!actorUid) throw new Error('Phiên đăng nhập không hợp lệ.');
  validateCounts(counts);
  const database = requireDatabase();
  const productsSnapshot = await get(ref(database, 'products'));
  const products = (productsSnapshot.val() ?? {}) as Record<string, Product>;
  const id = push(ref(database, 'stocktakes')).key;
  const auditId = push(ref(database, 'auditLogs')).key;
  if (!id || !auditId) throw new Error('Không thể tạo mã phiếu kiểm kê.');
  const now = Date.now();
  const items: StocktakeItem[] = counts.map((count) => {
    const product = products[count.productId];
    if (!product) throw new Error(`Không tìm thấy sản phẩm ${count.productId}.`);
    const systemQuantity = roundStockQuantity(Number(product.stockQuantity) || 0);
    const actualQuantity = normalizeStocktakeQuantity(count.actualQuantity);
    return {
      productId: count.productId,
      systemQuantity,
      actualQuantity,
      difference: roundStockQuantity(actualQuantity - systemQuantity),
    };
  });
  const stocktake: Stocktake = {
    id,
    code: makeCode(id),
    status: 'draft',
    items,
    createdBy: actorUid,
    createdAt: now,
    ...(note?.trim() ? { note: note.trim() } : {}),
  };
  const audit: AuditLog = {
    id: auditId,
    actorUid,
    action: 'STOCKTAKE_DRAFT_CREATED',
    entityType: 'stocktake',
    entityId: id,
    summary: `Tạo phiếu kiểm kê nháp ${stocktake.code} với ${items.length} sản phẩm`,
    createdAt: now,
  };
  await update(ref(database), { [`stocktakes/${id}`]: stocktake, [`auditLogs/${auditId}`]: audit });
  return stocktake;
}

export async function updateStocktakeDraft(
  draft: Stocktake,
  counts: StocktakeCountInput[],
  actorUid: string,
  note?: string,
): Promise<void> {
  if (!actorUid) throw new Error('Phiên đăng nhập không hợp lệ.');
  if (draft.status !== 'draft') throw new Error('Chỉ phiếu nháp mới được sửa.');
  validateCounts(counts);
  const byProduct = new Map(draft.items.map((item) => [item.productId, item]));
  const items: StocktakeItem[] = counts.map((count) => {
    const existing = byProduct.get(count.productId);
    if (!existing) throw new Error('Không thể thêm sản phẩm mới vào phiếu nháp đã chụp tồn. Hãy tạo phiếu mới.');
    const systemQuantity = roundStockQuantity(existing.systemQuantity);
    const actualQuantity = normalizeStocktakeQuantity(count.actualQuantity);
    return {
      productId: count.productId,
      systemQuantity,
      actualQuantity,
      difference: roundStockQuantity(actualQuantity - systemQuantity),
    };
  });
  const database = requireDatabase();
  const auditId = push(ref(database, 'auditLogs')).key;
  if (!auditId) throw new Error('Không thể tạo nhật ký kiểm kê.');
  const now = Date.now();
  const updated: Stocktake = { ...draft, items };
  if (note?.trim()) updated.note = note.trim();
  else delete updated.note;
  const audit: AuditLog = {
    id: auditId, actorUid, action: 'STOCKTAKE_DRAFT_UPDATED', entityType: 'stocktake', entityId: draft.id,
    summary: `Cập nhật phiếu kiểm kê nháp ${draft.code}`, createdAt: now,
  };
  await update(ref(database), { [`stocktakes/${draft.id}`]: updated, [`auditLogs/${auditId}`]: audit });
}

export async function applyStocktake(
  stocktakeId: string,
  actorUid: string,
  mode: StocktakeApplyMode,
): Promise<void> {
  if (!actorUid) throw new Error('Phiên đăng nhập không hợp lệ.');
  if (!stocktakeId) throw new Error('Thiếu mã phiếu kiểm kê.');
  const database = requireDatabase();
  const snapshot = await get(ref(database, `stocktakes/${stocktakeId}`));
  if (!snapshot.exists()) throw new Error('Không tìm thấy phiếu kiểm kê.');
  const stocktake = snapshot.val() as Stocktake;
  if (stocktake.status === 'completed') return;
  if (stocktake.status !== 'draft') throw new Error('Phiếu kiểm kê không còn ở trạng thái nháp.');

  const products = await getProductsOnce();
  const changes = buildStocktakeApplyChanges(stocktake.items, products, mode);
  const now = Date.now();
  const modeLabel = getStocktakeApplyModeLabel(mode);

  if (changes.length === 0) {
    const auditId = push(ref(database, 'auditLogs')).key;
    if (!auditId) throw new Error('Không thể tạo nhật ký kiểm kê.');
    const audit: AuditLog = {
      id: auditId,
      actorUid,
      action: mode === 'replace' ? 'STOCKTAKE_APPLIED_REPLACE_NO_CHANGE' : 'STOCKTAKE_APPLIED_ADD_NO_CHANGE',
      entityType: 'stocktake',
      entityId: stocktakeId,
      summary: `${modeLabel} cho ${stocktake.code}; không phát sinh thay đổi tồn kho`,
      createdAt: now,
    };
    await update(ref(database), {
      [`stocktakes/${stocktakeId}/status`]: 'completed',
      [`stocktakes/${stocktakeId}/completedAt`]: now,
      [`auditLogs/${auditId}`]: audit,
    });
    return;
  }

  await commitStockOperation({
    type: 'STOCKTAKE_ADJUSTMENT',
    referenceType: 'stocktake',
    referenceId: stocktakeId,
    actorUid,
    changes: changes.map((change) => ({
      ...change,
      note: `${modeLabel} từ ${stocktake.code}`,
    })),
    extraUpdates: {
      [`stocktakes/${stocktakeId}/status`]: 'completed',
      [`stocktakes/${stocktakeId}/completedAt`]: now,
    },
    audit: {
      action: mode === 'replace' ? 'STOCKTAKE_APPLIED_REPLACE' : 'STOCKTAKE_APPLIED_ADD',
      entityType: 'stocktake',
      entityId: stocktakeId,
      summary: `${modeLabel} cho ${stocktake.code}, điều chỉnh ${changes.length} sản phẩm`,
    },
  });
}

export async function cancelStocktakeDraft(stocktakeId: string, actorUid: string): Promise<void> {
  if (!actorUid) throw new Error('Phiên đăng nhập không hợp lệ.');
  if (!stocktakeId) throw new Error('Thiếu mã phiếu kiểm kê.');
  const database = requireDatabase();
  const snapshot = await get(ref(database, `stocktakes/${stocktakeId}`));
  if (!snapshot.exists()) throw new Error('Không tìm thấy phiếu kiểm kê.');
  const stocktake = snapshot.val() as Stocktake;
  if (stocktake.status === 'cancelled') return;
  if (stocktake.status !== 'draft') throw new Error('Chỉ phiếu nháp mới có thể hủy.');
  const auditId = push(ref(database, 'auditLogs')).key;
  if (!auditId) throw new Error('Không thể tạo nhật ký kiểm kê.');
  const now = Date.now();
  const audit: AuditLog = {
    id: auditId, actorUid, action: 'STOCKTAKE_CANCELLED', entityType: 'stocktake', entityId: stocktakeId,
    summary: `Hủy phiếu kiểm kê nháp ${stocktake.code}`, createdAt: now,
  };
  await update(ref(database), {
    [`stocktakes/${stocktakeId}/status`]: 'cancelled',
    [`auditLogs/${auditId}`]: audit,
  });
}

export function subscribeStocktakes(
  onData: (stocktakes: Stocktake[]) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  const database = requireDatabase();
  return onValue(ref(database, 'stocktakes'), (snapshot) => {
    const raw = snapshot.val() as Record<string, Stocktake> | null;
    onData(raw ? Object.entries(raw).map(([id, item]) => ({ ...item, id: item.id || id })).sort((a, b) => b.createdAt - a.createdAt) : []);
  }, (error) => onError(error instanceof Error ? error : new Error('Không thể tải phiếu kiểm kê.')));
}
