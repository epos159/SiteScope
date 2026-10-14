import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

// Firebase web config values are public identifiers, not secrets.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

/** Accounts and the free-search limit stay off until Firebase is configured. */
export const isAuthConfigured = Object.values(firebaseConfig).every(Boolean);

export const auth = isAuthConfigured ? getAuth(initializeApp(firebaseConfig)) : null;
