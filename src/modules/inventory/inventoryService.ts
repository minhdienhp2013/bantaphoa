import {
  equalTo,
  get,
  limitToLast,
  onValue,
  orderByChild,
  push,
  query,
  ref,
  update,
  type Database,
  type Unsubscribe,
} from 'firebase/database';
import { db } from '../../firebase/client';
import { invalidateReferenceCache } from '../../shared/data/referenceDataCache';
import type {
  AuditLog,
  Product,
  StockMovement,
  StockMovementType,
  StockOperationReceipt,
  StockReferenceType,
} from '../../types/models';
import {
  buildStockOperationId,
  hasStockCasSnapshotChanged,
  normalizeStockVersion,
  planStockDelta,
  roundStockQuantity,
  stableStockOperationHash,
  StockPlanError,
} from './stockOperationCas';

const MAX_STOCK_OPERATION_ATTEMPTS = 4;

export interface StockChangeInput {
  productId: string;
  quantityDelta: number;
  unitCost?: number;
  note?: string;
  expectedQuantityBefore?: number;
}

export interface StockOperationInput {
  type: StockMovementType;
  referenceType: StockReferenceType;
  referenceId: string;
  actorUid: string;
  changes: StockChangeInput[];
  extraUpdates?: Record<string, unknown>;
  productFieldUpdates?: Record<string, Record<string, unknown>>;
  audit?: {
    action: string;
    entityType: string;
    entityId?: string;
    summary?: string;
  };
}

function requireDatabase() {
  if (!db) {
    throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  }
  return db;
}

function asProducts(value: unknown): Record<string, Product> {
  if (!value || typeof value !== 'object') return {};
  return value as Record<string, Product>;
}

function assertValidDelta(delta: number) {
  if (!Number.isFinite(delta) || delta === 0) {
    throw new Error('Số lượng thay đổi tồn kho phải là số khác 0.');
  }
}

function aggregateChanges(changes: StockChangeInput[]) {
  const aggregated = new Map<string, StockChangeInput>();

  for (const change of changes) {
    assertValidDelta(change.quantityDelta);
    const current = aggregated.get(change.productId);
    if (!current) {
      aggregated.set(change.productId, { ...change });
      continue;
    }

    if (
      typeof current.expectedQuantityBefore === 'number' &&
      typeof change.expectedQuantityBefore === 'number' &&
      roundStockQuantity(current.expectedQuantityBefore) !== roundStockQuantity(change.expectedQuantityBefore)
    ) {
      throw new Error(`Có nhiều điều kiện tồn kho khác nhau cho sản phẩm ${change.productId}.`);
    }

    const quantityDelta = roundStockQuantity(current.quantityDelta + change.quantityDelta);
    aggregated.set(change.productId, {
      productId: change.productId,
      quantityDelta,
      ...(typeof change.unitCost === 'number'
        ? { unitCost: change.unitCost }
        : typeof current.unitCost === 'number'
          ? { unitCost: current.unitCost }
          : {}),
      ...(change.note ? { note: change.note } : current.note ? { note: current.note } : {}),
      ...(typeof current.expectedQuantityBefore === 'number'
        ? { expectedQuantityBefore: current.expectedQuantityBefore }
        : typeof change.expectedQuantityBefore === 'number'
          ? { expectedQuantityBefore: change.expectedQuantityBefore }
          : {}),
    });
  }

  return [...aggregated.values()].filter((change) => change.quantityDelta !== 0);
}

function assertProtectedPathsAreNotOverwritten(input: StockOperationInput) {
  for (const path of Object.keys(input.extraUpdates ?? {})) {
    if (
      /^products\/[^/]+\/(stockQuantity|stockVersion|lastStockOperationId)(\/|$)/.test(path) ||
      path === 'stockMovements' ||
      path.startsWith('stockMovements/') ||
      path === 'stockOperations' ||
      path.startsWith('stockOperations/')
    ) {
      throw new Error(`Đường dẫn ${path} phải do stock operation service quản lý.`);
    }
  }
}

async function readOperationReceipt(
  database: Database,
  operationId: string,
): Promise<StockOperationReceipt | null> {
  const snapshot = await get(ref(database, `stockOperations/${operationId}`));
  return snapshot.exists() ? (snapshot.val() as StockOperationReceipt) : null;
}

function assertReceiptMatchesInput(receipt: StockOperationReceipt, input: StockOperationInput) {
  if (
    receipt.id !== buildStockOperationId(input.type, input.referenceId) ||
    receipt.type !== input.type ||
    receipt.referenceType !== input.referenceType ||
    receipt.referenceId !== input.referenceId
  ) {
    throw new Error('Phát hiện trùng operationId với một nghiệp vụ kho khác.');
  }
}

async function readCommittedMovements(
  database: Database,
  input: StockOperationInput,
): Promise<StockMovement[]> {
  const snapshot = await get(
    query(ref(database, 'stockMovements'), orderByChild('referenceId'), equalTo(input.referenceId)),
  );
  if (!snapshot.exists()) return [];
  const raw = snapshot.val() as Record<string, StockMovement>;
  return Object.entries(raw)
    .map(([id, movement]) => ({ ...movement, id: movement.id || id }))
    .filter((movement) => movement.type === input.type)
    .sort((a, b) => a.createdAt - b.createdAt);
}

async function readProductsForAttempt(
  database: Database,
  changes: StockChangeInput[],
): Promise<Record<string, Product>> {
  const entries = await Promise.all(
    changes.map(async (change) => {
      const snapshot = await get(ref(database, `products/${change.productId}`));
      if (!snapshot.exists()) {
        throw new Error(`Không tìm thấy sản phẩm ${change.productId}.`);
      }
      const product = snapshot.val() as Product;
      return [
        change.productId,
        {
          ...product,
          id: product.id || change.productId,
          stockQuantity: Number(product.stockQuantity) || 0,
          stockVersion: normalizeStockVersion(product.stockVersion),
        },
      ] as const;
    }),
  );
  return Object.fromEntries(entries);
}

function isCasRuleRejection(error: unknown) {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  const code = String(candidate.code ?? '').toLowerCase();
  const message = String(candidate.message ?? '').toLowerCase();
  return (
    code.includes('permission_denied') ||
    code.includes('permission-denied') ||
    message.includes('permission_denied') ||
    message.includes('permission denied')
  );
}

function buildOpeningBalanceReferenceId(rows: OpeningBalanceInput[]) {
  const normalized = [...rows]
    .sort((a, b) => a.productId.localeCompare(b.productId))
    .flatMap((row) => [
      row.productId,
      roundStockQuantity(row.quantity),
      typeof row.unitCost === 'number' ? Math.round(row.unitCost) : undefined,
    ]);
  return `opening-${stableStockOperationHash(normalized)}`;
}

export async function getProductsOnce(): Promise<Product[]> {
  const database = requireDatabase();
  const snapshot = await get(ref(database, 'products'));
  const products = asProducts(snapshot.val());

  return Object.entries(products).map(([id, product]) => ({
    ...product,
    id: product.id || id,
    stockQuantity: Number(product.stockQuantity) || 0,
    stockVersion: normalizeStockVersion(product.stockVersion),
  }));
}

export async function commitStockOperation(input: StockOperationInput): Promise<StockMovement[]> {
  if (!input.actorUid) throw new Error('Phiên đăng nhập không hợp lệ.');
  const database = requireDatabase();
  assertProtectedPathsAreNotOverwritten(input);
  const changes = aggregateChanges(input.changes);
  if (changes.length === 0) {
    throw new Error('Nghiệp vụ không có thay đổi tồn kho để ghi nhận.');
  }

  const operationId = buildStockOperationId(input.type, input.referenceId);

  for (let attempt = 1; attempt <= MAX_STOCK_OPERATION_ATTEMPTS; attempt += 1) {
    const existingReceipt = await readOperationReceipt(database, operationId);
    if (existingReceipt) {
      assertReceiptMatchesInput(existingReceipt, input);
      invalidateReferenceCache('products');
      return readCommittedMovements(database, input);
    }

    const products = await readProductsForAttempt(database, changes);
    const now = Date.now();
    const updates: Record<string, unknown> = { ...(input.extraUpdates ?? {}) };
    const movements: StockMovement[] = [];

    for (const change of changes) {
      const product = products[change.productId];
      if (!product) {
        throw new Error(`Không tìm thấy sản phẩm ${change.productId}.`);
      }

      let plan;
      try {
        plan = planStockDelta(change, {
          productId: change.productId,
          stockQuantity: product.stockQuantity,
          stockVersion: product.stockVersion,
        });
      } catch (error) {
        if (error instanceof StockPlanError && error.code === 'STALE_STOCK') {
          throw new Error(
            `Tồn của ${product.sku} - ${product.name} đã thay đổi. ${error.message} Vui lòng tải lại dữ liệu trước khi tiếp tục.`,
          );
        }
        if (error instanceof StockPlanError && error.code === 'INSUFFICIENT_STOCK') {
          throw new Error(`Không đủ tồn cho ${product.sku} - ${product.name}. ${error.message}`);
        }
        throw error;
      }

      const movementId = push(ref(database, 'stockMovements')).key;
      if (!movementId) {
        throw new Error('Không thể tạo mã nhật ký kho.');
      }

      const movement: StockMovement = {
        id: movementId,
        productId: product.id || change.productId,
        type: input.type,
        quantityDelta: plan.quantityDelta,
        quantityBefore: plan.quantityBefore,
        quantityAfter: plan.quantityAfter,
        referenceType: input.referenceType,
        referenceId: input.referenceId,
        createdBy: input.actorUid,
        createdAt: now,
        ...(typeof change.unitCost === 'number' ? { unitCost: Math.round(change.unitCost) } : {}),
        ...(change.note?.trim() ? { note: change.note.trim() } : {}),
      };

      movements.push(movement);
      updates[`products/${change.productId}/stockQuantity`] = plan.quantityAfter;
      updates[`products/${change.productId}/stockVersion`] = plan.stockVersionAfter;
      updates[`products/${change.productId}/lastStockOperationId`] = operationId;
      updates[`products/${change.productId}/updatedAt`] = now;
      updates[`stockMovements/${movementId}`] = movement;

      const fieldUpdates = input.productFieldUpdates?.[change.productId];
      if (fieldUpdates) {
        for (const [field, value] of Object.entries(fieldUpdates)) {
          if (
            field === 'stockQuantity' ||
            field === 'stockVersion' ||
            field === 'lastStockOperationId' ||
            field === 'id'
          ) continue;
          updates[`products/${change.productId}/${field}`] = value;
        }
      }
    }

    const receipt: StockOperationReceipt = {
      id: operationId,
      type: input.type,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      actorUid: input.actorUid,
      createdAt: now,
    };
    updates[`stockOperations/${operationId}`] = receipt;

    if (input.audit) {
      const auditId = push(ref(database, 'auditLogs')).key;
      if (!auditId) {
        throw new Error('Không thể tạo nhật ký kiểm toán.');
      }

      const auditLog: AuditLog = {
        id: auditId,
        actorUid: input.actorUid,
        action: input.audit.action,
        entityType: input.audit.entityType,
        createdAt: now,
        ...(input.audit.entityId ? { entityId: input.audit.entityId } : {}),
        ...(input.audit.summary ? { summary: input.audit.summary } : {}),
      };
      updates[`auditLogs/${auditId}`] = auditLog;
    }

    try {
      await update(ref(database), updates);
      invalidateReferenceCache('products');
      return movements;
    } catch (error) {
      const committedReceipt = await readOperationReceipt(database, operationId);
      if (committedReceipt) {
        assertReceiptMatchesInput(committedReceipt, input);
        invalidateReferenceCache('products');
        return readCommittedMovements(database, input);
      }

      if (!isCasRuleRejection(error)) throw error;

      // Firebase RTDB reports both a genuine authorization/rule rejection and a
      // CAS/version race as permission_denied. Only retry when the stock snapshot
      // actually changed since this attempt; otherwise preserve the original error.
      let latestProducts: Record<string, Product>;
      try {
        latestProducts = await readProductsForAttempt(database, changes);
      } catch {
        throw error;
      }
      const hasConcurrentStockChange = changes.some((change) => {
        const before = products[change.productId];
        const after = latestProducts[change.productId];
        return Boolean(before && after && hasStockCasSnapshotChanged(
          {
            productId: change.productId,
            stockQuantity: before.stockQuantity,
            stockVersion: before.stockVersion,
          },
          {
            productId: change.productId,
            stockQuantity: after.stockQuantity,
            stockVersion: after.stockVersion,
          },
        ));
      });

      if (!hasConcurrentStockChange) throw error;
      if (attempt === MAX_STOCK_OPERATION_ATTEMPTS) {
        throw new Error(
          `Tồn kho thay đổi đồng thời quá nhiều lần. Nghiệp vụ chưa được ghi sau ${MAX_STOCK_OPERATION_ATTEMPTS} lần thử; vui lòng thử lại.`,
        );
      }
      // CAS conflict thật: vòng lặp đọc lại toàn bộ product snapshots, dựng lại
      // quantityBefore/quantityAfter + movement rồi thử atomic update mới.
    }
  }

  throw new Error('Không thể ghi nghiệp vụ kho.');
}

export function subscribeStockMovements(
  onMovements: (movements: StockMovement[]) => void,
  onError: (error: Error) => void,
  limit = 100,
): Unsubscribe {
  const database = requireDatabase();
  const movementsQuery = query(
    ref(database, 'stockMovements'),
    orderByChild('createdAt'),
    limitToLast(limit),
  );

  return onValue(
    movementsQuery,
    (snapshot) => {
      const raw = snapshot.val() as Record<string, StockMovement> | null;
      const movements = raw
        ? Object.entries(raw)
            .map(([id, movement]) => ({ ...movement, id: movement.id || id }))
            .sort((a, b) => b.createdAt - a.createdAt)
        : [];
      onMovements(movements);
    },
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải lịch sử kho.')),
  );
}

export async function hasReferenceMovement(
  referenceId: string,
  type?: StockMovementType,
): Promise<boolean> {
  const database = requireDatabase();
  const snapshot = await get(
    query(ref(database, 'stockMovements'), orderByChild('referenceId'), equalTo(referenceId)),
  );
  if (!snapshot.exists()) return false;

  const raw = snapshot.val() as Record<string, StockMovement>;
  return Object.values(raw).some((movement) => !type || movement.type === type);
}

export interface OpeningBalanceInput {
  productId: string;
  quantity: number;
  unitCost?: number;
}

export async function applyOpeningBalances(
  rows: OpeningBalanceInput[],
  actorUid: string,
): Promise<number> {
  const changes: StockChangeInput[] = [];

  for (const row of rows) {
    if (!row.productId) throw new Error('Dòng tồn đầu kỳ thiếu sản phẩm.');
    if (!Number.isFinite(row.quantity) || row.quantity < 0) {
      throw new Error(`Tồn đầu kỳ của sản phẩm ${row.productId} không hợp lệ.`);
    }
    if (row.quantity === 0) continue;
    changes.push({
      productId: row.productId,
      quantityDelta: row.quantity,
      ...(typeof row.unitCost === 'number' ? { unitCost: row.unitCost } : {}),
      note: 'Tồn đầu kỳ từ Excel',
      expectedQuantityBefore: 0,
    });
  }

  if (changes.length === 0) return 0;
  const referenceId = buildOpeningBalanceReferenceId(rows);
  await commitStockOperation({
    type: 'OPENING_BALANCE',
    referenceType: 'opening',
    referenceId,
    actorUid,
    changes,
    audit: {
      action: 'OPENING_BALANCE_EXCEL_IMPORTED',
      entityType: 'inventory',
      entityId: referenceId,
      summary: `Ghi tồn đầu kỳ cho ${changes.length} sản phẩm từ Excel`,
    },
  });

  return changes.length;
}

export interface ManualStockAdjustmentInput {
  productId: string;
  quantityBefore: number;
  quantityAfter: number;
  actorUid: string;
  note?: string;
}

export async function adjustProductStock(
  input: ManualStockAdjustmentInput,
): Promise<StockMovement[]> {
  const quantityBefore = roundStockQuantity(Number(input.quantityBefore));
  const quantityAfter = roundStockQuantity(Number(input.quantityAfter));

  if (!input.productId) throw new Error('Thiếu sản phẩm cần điều chỉnh tồn.');
  if (!Number.isFinite(quantityBefore) || quantityBefore < 0) {
    throw new Error('Tồn hiện tại không hợp lệ.');
  }
  if (!Number.isFinite(quantityAfter) || quantityAfter < 0) {
    throw new Error('Tồn mới phải là số từ 0 trở lên.');
  }
  if (quantityBefore === quantityAfter) return [];

  const database = requireDatabase();
  const referenceKey = push(ref(database, 'stockOperations')).key;
  if (!referenceKey) throw new Error('Không thể tạo mã điều chỉnh tồn kho.');

  const referenceId = `manual-${referenceKey}`;
  const note = input.note?.trim() || 'Điều chỉnh tồn từ sửa hàng hóa';

  return commitStockOperation({
    type: 'MANUAL_ADJUSTMENT',
    referenceType: 'manual',
    referenceId,
    actorUid: input.actorUid,
    changes: [{
      productId: input.productId,
      quantityDelta: roundStockQuantity(quantityAfter - quantityBefore),
      expectedQuantityBefore: quantityBefore,
      note,
    }],
    audit: {
      action: 'PRODUCT_STOCK_MANUALLY_ADJUSTED',
      entityType: 'inventory',
      entityId: input.productId,
      summary: `Điều chỉnh tồn ${quantityBefore} → ${quantityAfter}`,
    },
  });
}

