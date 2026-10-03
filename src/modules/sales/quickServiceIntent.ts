import type { QuickServiceCategory, QuickServiceSale } from '../../types/models';

export interface QuickServiceBusinessIntent {
  serviceCategory: QuickServiceCategory;
  amount: number;
  paymentMethod: 'cash' | 'bank_transfer';
  customerId?: string;
  note?: string;
}

export function normalizeQuickServiceOptionalText(value?: string) {
  const cleaned = value?.trim();
  return cleaned || undefined;
}

export function quickServiceSaleMatchesIntent(
  sale: QuickServiceSale,
  input: QuickServiceBusinessIntent,
  actorUid: string,
) {
  return sale.createdBy === actorUid
    && sale.serviceCategory === input.serviceCategory
    && sale.subtotal === input.amount
    && sale.total === input.amount
    && sale.discount === 0
    && sale.paymentMethod === input.paymentMethod
    && (sale.customerId ?? '') === (normalizeQuickServiceOptionalText(input.customerId) ?? '')
    && (sale.note ?? '') === (normalizeQuickServiceOptionalText(input.note) ?? '');
}
