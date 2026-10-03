export type StockPlanErrorCode = 'STALE_STOCK' | 'INSUFFICIENT_STOCK';

export class StockPlanError extends Error {
  code: StockPlanErrorCode;

  constructor(code: StockPlanErrorCode, message: string) {
    super(message);
    this.name = 'StockPlanError';
    this.code = code;
  }
}

export interface StockVersionSnapshot {
  productId: string;
  stockQuantity: number;
  stockVersion?: number;
}

export interface StockDeltaInput {
  productId: string;
  quantityDelta: number;
  expectedQuantityBefore?: number;
}

export interface PlannedStockDelta {
  productId: string;
  quantityDelta: number;
  quantityBefore: number;
  quantityAfter: number;
  stockVersionBefore: number;
  stockVersionAfter: number;
}

export function roundStockQuantity(value: number) {
  return Math.round(value * 1000) / 1000;
}

export function normalizeStockVersion(value: unknown) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

export function hasStockCasSnapshotChanged(
  before: StockVersionSnapshot,
  after: StockVersionSnapshot,
) {
  return (
    roundStockQuantity(Number(before.stockQuantity) || 0) !==
      roundStockQuantity(Number(after.stockQuantity) || 0) ||
    normalizeStockVersion(before.stockVersion) !== normalizeStockVersion(after.stockVersion)
  );
}

export function buildStockOperationId(type: string, referenceId: string) {
  const operationId = `${type}_${referenceId}`;
  if (!referenceId || /[.#$\[\]/]/.test(operationId)) {
    throw new Error('Mã nghiệp vụ kho không hợp lệ.');
  }
  return operationId;
}

export function planStockDelta(
  change: StockDeltaInput,
  snapshot: StockVersionSnapshot,
): PlannedStockDelta {
  const quantityBefore = roundStockQuantity(Number(snapshot.stockQuantity) || 0);
  if (
    typeof change.expectedQuantityBefore === 'number' &&
    quantityBefore !== roundStockQuantity(change.expectedQuantityBefore)
  ) {
    throw new StockPlanError(
      'STALE_STOCK',
      `Tồn kho đã thay đổi từ ${change.expectedQuantityBefore} thành ${quantityBefore}.`,
    );
  }

  const quantityDelta = roundStockQuantity(change.quantityDelta);
  const quantityAfter = roundStockQuantity(quantityBefore + quantityDelta);
  if (quantityAfter < 0) {
    throw new StockPlanError(
      'INSUFFICIENT_STOCK',
      `Tồn hiện tại ${quantityBefore}, yêu cầu thay đổi ${quantityDelta}.`,
    );
  }

  const stockVersionBefore = normalizeStockVersion(snapshot.stockVersion);
  return {
    productId: change.productId,
    quantityDelta,
    quantityBefore,
    quantityAfter,
    stockVersionBefore,
    stockVersionAfter: stockVersionBefore + 1,
  };
}

export function stableStockOperationHash(parts: Array<string | number | undefined>) {
  const text = parts.map((part) => String(part ?? '')).join('|');
  let hash = 1469598103934665603n;
  const prime = 1099511628211n;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, '0');
}
