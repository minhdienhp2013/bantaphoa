export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyD_VXbXWbt-Qqm6DSjEcCFQsdUTMf092ZA',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'ban-hang-tap-hoa-2fca9.firebaseapp.com',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || 'https://ban-hang-tap-hoa-2fca9-default-rtdb.asia-southeast1.firebasedatabase.app',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'ban-hang-tap-hoa-2fca9',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'ban-hang-tap-hoa-2fca9.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '31388852918',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:31388852918:web:35b8780fddaaf7b150fc17',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-H92K5GDZYT',
} as const;

export const firebaseReady = [
  firebaseConfig.apiKey,
  firebaseConfig.authDomain,
  firebaseConfig.databaseURL,
  firebaseConfig.projectId,
  firebaseConfig.appId,
].every((value) => typeof value === 'string' && value.trim().length > 0);
