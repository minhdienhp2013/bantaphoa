export const PURCHASE_DRAFT_VERSION = 1 as const;

export interface PurchaseDraftLine {
  productId: string;
  quantity: number;
  unitCost: number;
  salePrice?: number;
  historicalSku?: string;
  historicalName?: string;
}

export interface PurchaseDraft {
  version: typeof PURCHASE_DRAFT_VERSION;
  supplierId: string;
  supplierName: string;
  note: string;
  lines: PurchaseDraftLine[];
}

function storageOrNull(storage?: Storage | null): Storage | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function optionalFiniteNonNegative(value: unknown): value is number | undefined {
  return typeof value === 'undefined' || isFiniteNonNegative(value);
}

function optionalString(value: unknown): value is string | undefined {
  return typeof value === 'undefined' || typeof value === 'string';
}

export function getPurchaseDraftKey(uid: string) {
  return `purchaseDraft:v${PURCHASE_DRAFT_VERSION}:${uid}`;
}

export function parsePurchaseDraft(raw: string | null): PurchaseDraft | null {
  if (!raw) return null;

  try {
    const value: unknown = JSON.parse(raw);
    if (!isPlainObject(value) || value.version !== PURCHASE_DRAFT_VERSION) return null;
    if (typeof value.supplierId !== 'string' || typeof value.supplierName !== 'string' || typeof value.note !== 'string') return null;
    if (!Array.isArray(value.lines) || value.lines.length === 0 || value.lines.length > 1000) return null;

    const lines: PurchaseDraftLine[] = [];
    for (const line of value.lines) {
      if (!isPlainObject(line)) return null;
      if (typeof line.productId !== 'string') return null;
      if (!isFiniteNonNegative(line.quantity) || !isFiniteNonNegative(line.unitCost)) return null;
      if (!optionalFiniteNonNegative(line.salePrice)) return null;
      if (!optionalString(line.historicalSku) || !optionalString(line.historicalName)) return null;

      lines.push({
        productId: line.productId,
        quantity: line.quantity,
        unitCost: line.unitCost,
        ...(typeof line.salePrice === 'number' ? { salePrice: line.salePrice } : {}),
        ...(typeof line.historicalSku === 'string' ? { historicalSku: line.historicalSku } : {}),
        ...(typeof line.historicalName === 'string' ? { historicalName: line.historicalName } : {}),
      });
    }

    return {
      version: PURCHASE_DRAFT_VERSION,
      supplierId: value.supplierId,
      supplierName: value.supplierName,
      note: value.note,
      lines,
    };
  } catch {
    return null;
  }
}

export function loadPurchaseDraft(uid: string, storage?: Storage | null): PurchaseDraft | null {
  if (!uid) return null;
  const target = storageOrNull(storage);
  if (!target) return null;
  try {
    return parsePurchaseDraft(target.getItem(getPurchaseDraftKey(uid)));
  } catch {
    return null;
  }
}

export function savePurchaseDraft(uid: string, draft: PurchaseDraft, storage?: Storage | null): boolean {
  if (!uid) return false;
  const target = storageOrNull(storage);
  if (!target) return false;
  try {
    target.setItem(getPurchaseDraftKey(uid), JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

export function clearPurchaseDraft(uid: string, storage?: Storage | null): boolean {
  if (!uid) return false;
  const target = storageOrNull(storage);
  if (!target) return false;
  try {
    target.removeItem(getPurchaseDraftKey(uid));
    return true;
  } catch {
    return false;
  }
}

export function isMeaningfulPurchaseDraft(draft: PurchaseDraft): boolean {
  if (draft.supplierId.trim() || draft.supplierName.trim() || draft.note.trim()) return true;
  if (draft.lines.length !== 1) return true;

  const line = draft.lines[0];
  return Boolean(
    line.productId.trim()
    || line.historicalSku?.trim()
    || line.historicalName?.trim()
    || line.quantity !== 1
    || line.unitCost !== 0
    || (typeof line.salePrice === 'number' && line.salePrice !== 0),
  );
}

export function guardPurchaseDraftReplacement(
  uid: string,
  confirmDiscard: (message: string) => boolean,
  storage?: Storage | null,
): boolean {
  const existingDraft = loadPurchaseDraft(uid, storage);
  if (!existingDraft || !isMeaningfulPurchaseDraft(existingDraft)) return true;
  if (!confirmDiscard('Bỏ phiếu nhập đang soạn?')) return false;
  return clearPurchaseDraft(uid, storage);
}
