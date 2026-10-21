import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  linkWithCredential,
  linkWithPopup,
  onIdTokenChanged,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { auth, ensureSession, isAuthConfigured } from '../services/firebase';

const AuthContext = createContext(null);

function trackEvent(name, params) {
  window.gtag?.('event', name, params);
}

/** A plain copy so React re-renders when an anonymous login is upgraded in place. */
function snapshot(firebaseUser) {
  if (!firebaseUser) return null;
  return {
    uid: firebaseUser.uid,
    isAnonymous: firebaseUser.isAnonymous,
    email: firebaseUser.email,
    displayName: firebaseUser.displayName,
    photoURL: firebaseUser.photoURL,
  };
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null);
  const [initializing, setInitializing] = useState(isAuthConfigured);

  useEffect(() => {
    if (!auth) return undefined;
    return onIdTokenChanged(auth, nextUser => {
      setSession(snapshot(nextUser));
      setInitializing(false);
      window.gtag?.('set', { user_id: nextUser && !nextUser.isAnonymous ? nextUser.uid : null });
      if (!nextUser) ensureSession().catch(() => {});
    });
  }, []);

  const refresh = useCallback(() => setSession(snapshot(auth.currentUser)), []);

  // Signing up from an anonymous session keeps the same account, so the free
  // searches already used carry over instead of resetting.
  const signInWithGoogle = useCallback(async () => {
    const provider = new GoogleAuthProvider();
    const current = auth.currentUser;
    let user;
    if (current?.isAnonymous) {
      try {
        user = (await linkWithPopup(current, provider)).user;
      } catch (err) {
        const credential = err.code === 'auth/credential-already-in-use'
          ? GoogleAuthProvider.credentialFromError(err)
          : null;
        if (!credential) throw err;
        user = (await signInWithCredential(auth, credential)).user;
      }
    } else {
      user = (await signInWithPopup(auth, provider)).user;
    }
    refresh();
    trackEvent('login', { method: 'google' });
    return user;
  }, [refresh]);

  const signInWithEmail = useCallback(async (email, password) => {
    const result = await signInWithEmailAndPassword(auth, email, password);
    refresh();
    trackEvent('login', { method: 'email' });
    return result.user;
  }, [refresh]);

  const signUpWithEmail = useCallback(async (email, password) => {
    const current = auth.currentUser;
    const result = current?.isAnonymous
      ? await linkWithCredential(current, EmailAuthProvider.credential(email, password))
      : await createUserWithEmailAndPassword(auth, email, password);
    refresh();
    trackEvent('sign_up', { method: 'email' });
    return result.user;
  }, [refresh]);

  const resetPassword = useCallback(email => sendPasswordResetEmail(auth, email), []);

  const signOut = useCallback(() => firebaseSignOut(auth), []);

  const user = session && !session.isAnonymous ? session : null;

  const value = useMemo(
    () => ({
      isAuthConfigured,
      user,
      sessionUid: session?.uid || null,
      initializing,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      resetPassword,
      signOut,
    }),
    [user, session?.uid, initializing, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
