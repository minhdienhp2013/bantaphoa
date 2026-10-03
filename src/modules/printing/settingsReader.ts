import { onValue, ref, type Unsubscribe } from 'firebase/database';
import { db } from '../../firebase/client';
import type { StoreSettings } from '../../types/models';

export function subscribeStoreSettings(
  onSettings: (settings: StoreSettings | null) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  if (!db) {
    onSettings(null);
    return () => undefined;
  }

  return onValue(
    ref(db, 'settings'),
    (snapshot) => onSettings(snapshot.exists() ? (snapshot.val() as StoreSettings) : null),
    (error) => onError?.(error instanceof Error ? error : new Error('Không thể tải cài đặt cửa hàng.')),
  );
}
