import React, { useEffect, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import { FREE_SEARCH_LIMIT } from '../../hooks/useFreeSearches';
import './Auth.css';

const REASON_COPY = {
  limit: {
    title: 'Keep researching sites for free',
    body: `You've used your ${FREE_SEARCH_LIMIT} free searches. Create a free account to keep searching — it takes about 20 seconds.`,
  },
  export: {
    title: 'Create a free account to export',
    body: 'PDF, print, PNG, and CSV reports are available with a free SiteScope account.',
  },
  signin: {
    title: 'Sign in to SiteScope',
    body: 'Unlimited searches and report exports with a free account.',
  },
};

const ERROR_MESSAGES = {
  'auth/invalid-email': 'That email address doesn’t look right.',
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/wrong-password': 'Email or password is incorrect.',
  'auth/user-not-found': 'No account with that email — try creating one.',
  'auth/email-already-in-use': 'An account already exists for that email — try signing in.',
  'auth/weak-password': 'Use at least 6 characters for your password.',
  'auth/popup-blocked': 'Your browser blocked the Google window. Allow pop-ups for this site and try again.',
  'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
  'auth/network-request-failed': 'Network error — check your connection and try again.',
};

const SILENT_ERRORS = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request']);

function messageFor(err) {
  return ERROR_MESSAGES[err?.code] || 'Something went wrong. Please try again.';
}

export default function AuthModal({ reason = 'signin', onClose, onSignedIn }) {
  const { signInWithGoogle, signInWithEmail, signUpWithEmail, resetPassword } = useAuth();
  const [mode, setMode] = useState(reason === 'signin' ? 'signin' : 'signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const copy = REASON_COPY[reason] || REASON_COPY.signin;

  useEffect(() => {
    const onKey = e => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const run = async action => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      onSignedIn?.();
    } catch (err) {
      if (!SILENT_ERRORS.has(err?.code)) setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  const handleGoogle = () => run(signInWithGoogle);

  const handleSubmit = e => {
    e.preventDefault();
    const trimmed = email.trim();
    run(() => (mode === 'signup' ? signUpWithEmail(trimmed, password) : signInWithEmail(trimmed, password)));
  };

  const handleReset = async () => {
    if (!email.trim()) {
      setError('Enter your email above, then click “Forgot password?” again.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await resetPassword(email.trim());
      setNotice('Check your email for a link to reset your password.');
    } catch (err) {
      setError(messageFor(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-overlay" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <div className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button type="button" className="auth-close" onClick={onClose} aria-label="Close">
          ×
        </button>

        <h2 id="auth-title" className="auth-title">{copy.title}</h2>
        <p className="auth-body">{copy.body}</p>

        <button type="button" className="auth-google" onClick={handleGoogle} disabled={busy}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
          </svg>
          Continue with Google
        </button>

        <div className="auth-divider"><span>or</span></div>

        <form className="auth-form" onSubmit={handleSubmit}>
          <label className="auth-label">
            Email
            <input
              className="auth-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </label>
          <label className="auth-label">
            Password
            <input
              className="auth-input"
              type="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              minLength={6}
              required
            />
          </label>

          {error && <p className="auth-error" role="alert">{error}</p>}
          {notice && <p className="auth-notice">{notice}</p>}

          <button type="submit" className="auth-submit" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'signup' ? 'Create free account' : 'Sign in'}
          </button>
        </form>

        <div className="auth-footer">
          {mode === 'signup' ? (
            <span>
              Already have an account?{' '}
              <button type="button" className="auth-link" onClick={() => setMode('signin')}>
                Sign in
              </button>
            </span>
          ) : (
            <>
              <span>
                New to SiteScope?{' '}
                <button type="button" className="auth-link" onClick={() => setMode('signup')}>
                  Create a free account
                </button>
              </span>
              <button type="button" className="auth-link" onClick={handleReset} disabled={busy}>
                Forgot password?
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
