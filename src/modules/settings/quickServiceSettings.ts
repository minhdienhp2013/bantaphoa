import { get, onValue, ref, update, type Unsubscribe } from 'firebase/database';
import { db } from '../../firebase/client';
import type { QuickServiceCategory, QuickServiceProfitRatesPercent } from '../../types/models';
import {
  resolveQuickServiceProfitRates,
  validateQuickServiceProfitRatesForWrite,
} from './quickServiceProfitRates';

export {
  DEFAULT_QUICK_SERVICE_PROFIT_RATES_PERCENT,
  QUICK_SERVICE_CATEGORIES,
  QUICK_SERVICE_CATEGORY_LABELS,
  resolveQuickServiceProfitRates,
  validateQuickServiceProfitRatesForWrite,
} from './quickServiceProfitRates';

function requireDatabase() {
  if (!db) throw new Error('Realtime Database chưa được cấu hình cho ứng dụng.');
  return db;
}

export async function readQuickServiceProfitRates(): Promise<Record<QuickServiceCategory, number>> {
  const snapshot = await get(ref(requireDatabase(), 'settings/quickServiceProfitRatesPercent'));
  return resolveQuickServiceProfitRates(snapshot.exists() ? snapshot.val() : null);
}

export async function readQuickServiceProfitRate(category: QuickServiceCategory): Promise<number> {
  const rates = await readQuickServiceProfitRates();
  return rates[category];
}

export function subscribeQuickServiceProfitRates(
  onData: (rates: Record<QuickServiceCategory, number>) => void,
  onError: (error: Error) => void,
): Unsubscribe {
  return onValue(
    ref(requireDatabase(), 'settings/quickServiceProfitRatesPercent'),
    (snapshot) => {
      try {
        onData(resolveQuickServiceProfitRates(snapshot.exists() ? snapshot.val() : null));
      } catch (cause) {
        onError(cause instanceof Error ? cause : new Error('Cấu hình tỷ lệ dịch vụ không hợp lệ.'));
      }
    },
    (error) => onError(error instanceof Error ? error : new Error('Không thể tải tỷ lệ lợi nhuận dịch vụ.')),
  );
}

export async function saveQuickServiceProfitRates(
  value: QuickServiceProfitRatesPercent,
): Promise<Record<QuickServiceCategory, number>> {
  const validated = validateQuickServiceProfitRatesForWrite(value);
  await update(ref(requireDatabase()), {
    'settings/quickServiceProfitRatesPercent': validated,
    'settings/updatedAt': Date.now(),
  });
  return validated;
}
