import React, { memo, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../hooks/useAuth';
import './Auth.css';

function AccountMenu({
  remainingSearches,
  onSignInClick,
  billingConfigured = false,
  subscriptionActive = false,
  onSubscribe,
  onManageBilling,
}) {
  const { user, initializing, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onClick = e => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  if (initializing) return null;

  if (!user) {
    return (
      <div className="account-signed-out">
        <span className="account-remaining" title="Free searches without an account">
          {remainingSearches} free {remainingSearches === 1 ? 'search' : 'searches'} left
        </span>
        <button type="button" className="account-signin-btn" onClick={onSignInClick}>
          Sign in
        </button>
      </div>
    );
  }

  const label = user.displayName || user.email || 'Account';
  const initial = label.trim().charAt(0).toUpperCase();

  return (
    <div className="account-menu" ref={menuRef}>
      <button
        type="button"
        className="account-avatar"
        onClick={() => setOpen(o => !o)}
        aria-label="Account menu"
        aria-expanded={open}
      >
        {user.photoURL ? <img src={user.photoURL} alt="" referrerPolicy="no-referrer" /> : initial}
      </button>
      {open && (
        <div className="account-dropdown">
          <div className="account-dropdown-email">{user.email || label}</div>
          {billingConfigured && subscriptionActive && (
            <button
              type="button"
              className="account-dropdown-item"
              onClick={() => {
                setOpen(false);
                onManageBilling();
              }}
            >
              Manage billing
            </button>
          )}
          {billingConfigured && !subscriptionActive && (
            <button
              type="button"
              className="account-dropdown-item"
              onClick={() => {
                setOpen(false);
                onSubscribe();
              }}
            >
              Subscribe — $30/month
            </button>
          )}
          <button
            type="button"
            className="account-dropdown-item"
            onClick={() => {
              setOpen(false);
              signOut();
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default memo(AccountMenu);
