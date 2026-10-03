export const VND_STEP = 10_000;

export type VndStepDirection = -1 | 1;

export function sanitizeVndInput(value: string): string {
  return value.replace(/\D/gu, '').replace(/^0+(?=\d)/u, '');
}

export function parseVndInteger(value: string | number): number | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
  const trimmed = value.trim();
  if (!trimmed) return 0;
  const normalized = trimmed.replaceAll(',', '');
  if (!/^\d+$/u.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function formatVndInteger(value: string | number): string {
  if (typeof value === 'string' && !value.trim()) return '';
  const parsed = parseVndInteger(value);
  if (parsed === null) return '';
  return String(parsed).replace(/\B(?=(\d{3})+(?!\d))/gu, ',');
}

export function getSteppedVndValue(
  currentValue: string | number,
  direction: VndStepDirection,
  min = 0,
): number | null {
  const current = parseVndInteger(currentValue);
  if (current === null) return null;
  const next = current + direction * VND_STEP;
  if (!Number.isSafeInteger(next) || next < min) return null;
  return next;
}
