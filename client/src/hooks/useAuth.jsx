import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { auth, isAuthConfigured } from '../services/firebase';

const AuthContext = createContext(null);

function trackEvent(name, params) {
  window.gtag?.('event', name, params);
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [initializing, setInitializing] = useState(isAuthConfigured);

  useEffect(() => {
    if (!auth) return undefined;
    return onAuthStateChanged(auth, nextUser => {
      setUser(nextUser);
      setInitializing(false);
      window.gtag?.('set', { user_id: nextUser?.uid ?? null });
    });
  }, []);

  const signInWithGoogle = useCallback(async () => {
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    trackEvent('login', { method: 'google' });
    return result.user;
  }, []);

  const signInWithEmail = useCallback(async (email, password) => {
    const result = await signInWithEmailAndPassword(auth, email, password);
    trackEvent('login', { method: 'email' });
    return result.user;
  }, []);

  const signUpWithEmail = useCallback(async (email, password) => {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    trackEvent('sign_up', { method: 'email' });
    return result.user;
  }, []);

  const resetPassword = useCallback(email => sendPasswordResetEmail(auth, email), []);

  const signOut = useCallback(() => firebaseSignOut(auth), []);

  const value = useMemo(
    () => ({
      isAuthConfigured,
      user,
      initializing,
      signInWithGoogle,
      signInWithEmail,
      signUpWithEmail,
      resetPassword,
      signOut,
    }),
    [user, initializing, signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
