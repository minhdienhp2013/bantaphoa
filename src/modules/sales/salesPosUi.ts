import type { QuickServiceCategory, Sale } from '../../types/models';

export type QuickServiceId = QuickServiceCategory;

export interface QuickServiceTile {
  id: QuickServiceId;
  label: string;
  description: string;
  tone: 'blue' | 'violet' | 'mint' | 'amber' | 'rose' | 'slate';
}

export const FIXED_SERVICE_TILES: readonly QuickServiceTile[] = [
  { id: 'photo', label: 'Photocopy', description: 'Photocopy giấy tờ và tài liệu', tone: 'blue' },
  { id: 'printing', label: 'In & ép', description: 'In giấy và ép plastic', tone: 'violet' },
  { id: 'scan', label: 'Scan', description: 'Scan tài liệu, ảnh sang file mềm', tone: 'mint' },
  { id: 'computer', label: 'Vi tính', description: 'Đánh máy và soạn thảo văn bản', tone: 'amber' },
  { id: 'stationery', label: 'Văn phòng phẩm', description: 'Giấy, bút, mực và đồ dùng văn phòng', tone: 'rose' },
  { id: 'other', label: 'Khác', description: 'Hàng hóa và dịch vụ lẻ khác', tone: 'slate' },
] as const;

export type QuickAmountParseResult =
  | { state: 'empty'; amount: null; message: '' }
  | { state: 'invalid'; amount: null; message: string }
  | { state: 'valid'; amount: number; message: '' };

export interface RecentSaleSummary {
  label: string;
  quantity: number | null;
  note: string;
}

const MAX_SAFE_THOUSANDS = Math.floor(Number.MAX_SAFE_INTEGER / 1000);
const HIDDEN_RECENT_NOTE_FALLBACK = '\u2060';

export function parseQuickServiceAmount(rawValue: string): QuickAmountParseResult {
  const value = rawValue.trim();
  if (!value) return { state: 'empty', amount: null, message: '' };
  if (!/^\d+$/.test(value)) {
    return { state: 'invalid', amount: null, message: 'Chỉ nhập số nguyên, không nhập dấu chấm, dấu phẩy hoặc ký tự khác.' };
  }

  const thousands = Number(value);
  if (!Number.isSafeInteger(thousands) || thousands > MAX_SAFE_THOUSANDS) {
    return { state: 'invalid', amount: null, message: 'Số tiền quá lớn để xử lý an toàn.' };
  }
  if (thousands <= 0) {
    return { state: 'invalid', amount: null, message: 'Số tiền phải lớn hơn 0.' };
  }

  return { state: 'valid', amount: thousands * 1000, message: '' };
}

export function getRecentSales(sales: readonly Sale[], limit = 4): Sale[] {
  const safeLimit = Math.max(0, Math.min(4, Math.floor(limit)));
  return [...sales].sort((left, right) => right.createdAt - left.createdAt).slice(0, safeLimit);
}

export function summarizeRecentSale(sale: Sale): RecentSaleSummary {
  if (sale.saleKind === 'quick_service') {
    const service = FIXED_SERVICE_TILES.find((item) => item.id === sale.serviceCategory);
    return {
      label: service?.label ?? sale.serviceCategory,
      quantity: null,
      note: sale.note?.trim() || HIDDEN_RECENT_NOTE_FALLBACK,
    };
  }

  const items = sale.items;
  const first = items[0];
  const totalQuantity = items.reduce<number>((sum, item) => sum + (Number(item.quantity) || 0), 0);
  const extraCount = Math.max(0, items.length - 1);
  return {
    label: first ? `${first.name}${extraCount ? ` +${extraCount}` : ''}` : sale.code,
    quantity: totalQuantity,
    note: sale.note?.trim() || HIDDEN_RECENT_NOTE_FALLBACK,
  };
}
