import { getApps, initializeApp } from 'firebase/app';
import { browserLocalPersistence, getAuth, initializeAuth, type Auth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import { firebaseConfig, firebaseReady } from './config';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const requiredConfig = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.projectId,
  firebaseConfig.appId,
];

export const firebaseReady = requiredConfig.every(Boolean);

if (!firebaseReady) {
  console.warn('Firebase chưa được cấu hình đầy đủ. Hãy kiểm tra file .env.local.');
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
