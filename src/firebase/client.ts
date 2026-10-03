import { getApps, initializeApp } from 'firebase/app';
import { browserLocalPersistence, getAuth, initializeAuth, type Auth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { firebaseConfig, firebaseReady } from './config';

if (!firebaseReady) {
  console.warn('Firebase chưa được cấu hình đầy đủ.');
}

export const firebaseApp = getApps()[0] ?? initializeApp(firebaseConfig);

function createAuth(): Auth {
  try {
    return initializeAuth(firebaseApp, {
      persistence: browserLocalPersistence,
    });
  } catch {
    return getAuth(firebaseApp);
  }
}

export const auth = createAuth();
export { firebaseReady };

export const realtimeDatabaseReady = Boolean(firebaseConfig.databaseURL);
export const db = realtimeDatabaseReady
  ? getDatabase(firebaseApp, firebaseConfig.databaseURL)
  : null;
