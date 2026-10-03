export type PurchaseModalFocusTarget = 'first' | 'last' | 'dialog' | null;

interface PurchaseModalFocusState {
  focusableCount: number;
  activeIndex: number;
  activeInsideDialog: boolean;
  shiftKey: boolean;
}

export function resolvePurchaseModalFocusTarget({
  focusableCount,
  activeIndex,
  activeInsideDialog,
  shiftKey,
}: PurchaseModalFocusState): PurchaseModalFocusTarget {
  if (focusableCount <= 0) return 'dialog';

  if (!activeInsideDialog || activeIndex < 0 || activeIndex >= focusableCount) {
    return shiftKey ? 'last' : 'first';
  }

  if (shiftKey && activeIndex === 0) return 'last';
  if (!shiftKey && activeIndex === focusableCount - 1) return 'first';
  return null;
}
