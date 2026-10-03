export interface StocktakeScanSessionState {
  countsByProductId: Record<string, number>;
  acceptedScanCount: number;
  scanUndoStack: string[];
}

export interface ScannableStocktakeProduct {
  id: string;
  active: boolean;
}

export type StocktakeScanRejectReason = 'unknown' | 'inactive' | 'not-in-draft';

export type StocktakeScanOutcome =
  | {
      kind: 'accepted';
      state: StocktakeScanSessionState;
      productId: string;
      quantity: number;
    }
  | {
      kind: 'rejected';
      state: StocktakeScanSessionState;
      reason: StocktakeScanRejectReason;
    };

export interface StocktakeCountInputLike {
  productId: string;
  actualQuantity: number;
}

function roundQuantity(value: number) {
  return Math.round(value * 1000) / 1000;
}

function hasOwnCount(counts: Record<string, number>, productId: string) {
  return Object.prototype.hasOwnProperty.call(counts, productId);
}

export function createStocktakeScanSession(
  countsByProductId: Record<string, number> = {},
): StocktakeScanSessionState {
  return {
    countsByProductId: { ...countsByProductId },
    acceptedScanCount: 0,
    scanUndoStack: [],
  };
}

export function setConfirmedQuantity(
  state: StocktakeScanSessionState,
  productId: string,
  quantity: number | null,
): StocktakeScanSessionState {
  if (!productId) return state;

  const countsByProductId = { ...state.countsByProductId };
  if (quantity === null) {
    delete countsByProductId[productId];
  } else {
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error('Số lượng thực tế phải là số từ 0 trở lên.');
    }
    countsByProductId[productId] = roundQuantity(quantity);
  }

  return { ...state, countsByProductId };
}

export function adjustConfirmedQuantity(
  state: StocktakeScanSessionState,
  productId: string,
  delta: number,
): StocktakeScanSessionState {
  if (!productId || !Number.isFinite(delta)) return state;
  const current = hasOwnCount(state.countsByProductId, productId)
    ? state.countsByProductId[productId]
    : 0;
  const next = Math.max(0, roundQuantity(current + delta));
  return setConfirmedQuantity(state, productId, next);
}

export function acceptResolvedStocktakeScan(
  state: StocktakeScanSessionState,
  product: ScannableStocktakeProduct | null,
  allowedProductIds?: ReadonlySet<string>,
): StocktakeScanOutcome {
  if (!product) {
    return { kind: 'rejected', state, reason: 'unknown' };
  }
  if (!product.active) {
    return { kind: 'rejected', state, reason: 'inactive' };
  }
  if (allowedProductIds && !allowedProductIds.has(product.id)) {
    return { kind: 'rejected', state, reason: 'not-in-draft' };
  }

  const quantity = roundQuantity((state.countsByProductId[product.id] ?? 0) + 1);
  return {
    kind: 'accepted',
    productId: product.id,
    quantity,
    state: {
      countsByProductId: {
        ...state.countsByProductId,
        [product.id]: quantity,
      },
      acceptedScanCount: state.acceptedScanCount + 1,
      scanUndoStack: [...state.scanUndoStack, product.id],
    },
  };
}

export function undoLastAcceptedScan(state: StocktakeScanSessionState): {
  state: StocktakeScanSessionState;
  undoneProductId: string | null;
} {
  if (state.scanUndoStack.length === 0) {
    return { state, undoneProductId: null };
  }

  const undoneProductId = state.scanUndoStack[state.scanUndoStack.length - 1];
  const scanUndoStack = state.scanUndoStack.slice(0, -1);
  const countsByProductId = { ...state.countsByProductId };

  if (hasOwnCount(countsByProductId, undoneProductId)) {
    countsByProductId[undoneProductId] = Math.max(
      0,
      roundQuantity(countsByProductId[undoneProductId] - 1),
    );
  }

  return {
    undoneProductId,
    state: {
      countsByProductId,
      acceptedScanCount: Math.max(0, state.acceptedScanCount - 1),
      scanUndoStack,
    },
  };
}

export function getScannedProductCount(state: StocktakeScanSessionState) {
  return new Set(state.scanUndoStack).size;
}

export function toStocktakeCountInputs(
  countsByProductId: Record<string, number>,
): StocktakeCountInputLike[] {
  return Object.entries(countsByProductId)
    .filter(([, quantity]) => Number.isFinite(quantity) && quantity >= 0)
    .map(([productId, actualQuantity]) => ({
      productId,
      actualQuantity: roundQuantity(actualQuantity),
    }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}
