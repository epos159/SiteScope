import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously } from 'firebase/auth';

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

let anonymousSignIn = null;

/**
 * The current Firebase user. Visitors who never signed in get a silent
 * anonymous login so the server can count their free searches.
 */
export async function ensureSession() {
  if (!auth) return null;
  await auth.authStateReady();
  if (auth.currentUser) return auth.currentUser;
  if (!anonymousSignIn) {
    anonymousSignIn = signInAnonymously(auth)
      .then(result => result.user)
      .finally(() => {
        anonymousSignIn = null;
      });
  }
  return anonymousSignIn;
}

/** ID token for API requests, or null if Firebase is off or sign-in failed. */
export async function getSessionToken() {
  try {
    const user = await ensureSession();
    return user ? await user.getIdToken() : null;
  } catch (err) {
    console.warn('[auth] could not start a session:', err.code || err.message);
    return null;
  }
}
