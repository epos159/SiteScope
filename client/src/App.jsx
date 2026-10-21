import React, { useCallback, useEffect, useRef, useState } from 'react';
import SearchBar from './components/SearchBar/SearchBar';
import MapView from './components/Map/MapView';
import DataPanel from './components/DataPanel/DataPanel';
import ExportPanel from './components/Export/ExportPanel';
import AlternativeMatches from './components/SearchBar/AlternativeMatches';
import AuthModal from './components/Auth/AuthModal';
import AccountMenu from './components/Auth/AccountMenu';
import { useSiteData } from './hooks/useSiteData';
import { useAuth } from './hooks/useAuth';
import { useFreeSearches } from './hooks/useFreeSearches';
import { SUPPORTED_COUNTIES } from './utils/county';
import { DISCLAIMER_SHORT } from './constants/disclaimer';
import * as api from './services/api';
import { getSessionToken } from './services/firebase';
import './App.css';

const LIMIT_ERRORS = new Set(['free_limit', 'subscription_required']);

const INITIAL_BILLING = { configured: false, enforced: false, active: false, freeRemaining: null };

export default function App() {
  const { state, search, searchByCoords, cancelSearch } = useSiteData();
  const { isAuthConfigured, user, sessionUid } = useAuth();
  const { remaining: localRemaining, recordSearch, hasSearched } = useFreeSearches();
  const mapRef = useRef(null);
  const dataPanelRef = useRef(null);
  const [lastQuery, setLastQuery] = useState(null);
  const [authPrompt, setAuthPrompt] = useState(null);
  const [billing, setBilling] = useState(INITIAL_BILLING);
  const pendingSearchRef = useRef(null);
  const countNextParcelRef = useRef(false);
  const isGuest = isAuthConfigured && !user;

  // Once the server counts free searches, its number is the one that matters.
  // Until then, the browser keeps its own count.
  const remaining = billing.enforced && typeof billing.freeRemaining === 'number'
    ? billing.freeRemaining
    : localRemaining;
  const unlimited = Boolean(user) && (!billing.configured || billing.active);

  // Wake the Render free-tier server as early as possible so the first search
  // doesn't hit a cold start (~30 s delay).
  useEffect(() => { api.pingServer(); }, []);

  useEffect(() => {
    if (isAuthConfigured) api.setAuthTokenProvider(getSessionToken);
  }, [isAuthConfigured]);

  const refreshBilling = useCallback(async (sessionId) => {
    try {
      const status = await api.billingStatus(sessionId);
      const next = {
        configured: Boolean(status.configured),
        enforced: Boolean(status.enforced),
        active: Boolean(status.active),
        freeRemaining: typeof status.freeRemaining === 'number' ? status.freeRemaining : null,
      };
      setBilling(next);
      return next;
    } catch {
      return INITIAL_BILLING;
    }
  }, []);

  useEffect(() => {
    if (!sessionUid) return undefined;
    const params = new URLSearchParams(window.location.search);
    const sessionId = user && params.get('checkout') === 'success' ? params.get('session_id') : null;
    let attempts = 0;
    let timer;
    let cancelled = false;
    const finish = () => {
      if (!params.get('checkout')) return;
      params.delete('checkout');
      params.delete('session_id');
      const next = params.toString();
      window.history.replaceState({}, '', next ? `?${next}` : window.location.pathname);
    };
    const run = async () => {
      const status = await refreshBilling(sessionId);
      if (cancelled) return;
      attempts += 1;
      if (sessionId && !status.active && attempts < 8) {
        timer = setTimeout(run, 1500);
        return;
      }
      if (sessionId) finish();
    };
    run();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionUid, user, refreshBilling]);

  const runSearch = useCallback(
    (address, match = null) => {
      setLastQuery({ address, match });
      countNextParcelRef.current = true;
      search(address, match);
    },
    [search]
  );

  const handleSearch = useCallback(
    (address, match = null) => {
      // The server decides when it is counting. It also lets a visitor reopen
      // places they already searched, which a browser-side check can't know.
      if (!billing.enforced && isGuest) {
        const alreadyCounted = match?.parcelId && hasSearched(`${match.countyKey}|${match.parcelId}`);
        if (localRemaining <= 0 && !alreadyCounted) {
          pendingSearchRef.current = { address, match };
          setAuthPrompt('limit');
          return;
        }
      }
      runSearch(address, match);
    },
    [billing.enforced, isGuest, localRemaining, hasSearched, runSearch]
  );

  // A free search is used only when it actually loads a parcel.
  useEffect(() => {
    if (!state.parcel) return;
    if (typeof state.parcel.freeRemaining === 'number') {
      setBilling(prev => ({ ...prev, freeRemaining: state.parcel.freeRemaining }));
    }
    if (!countNextParcelRef.current) return;
    countNextParcelRef.current = false;
    const parcelId = state.parcel.feature?.properties?.parcelId;
    window.gtag?.('event', 'site_search', {
      county: state.location?.countyKey || 'unsupported',
      parcel_found: Boolean(parcelId),
      signed_in: Boolean(user),
    });
    if (isGuest && !billing.enforced && parcelId) {
      recordSearch(`${state.location?.countyKey}|${parcelId}`);
    }
  }, [state.parcel, state.location?.countyKey, isGuest, user, billing.enforced, recordSearch]);

  // The server refused a search: out of free searches, or no subscription.
  useEffect(() => {
    if (state.status !== 'error' || !LIMIT_ERRORS.has(state.errorMessage)) return;
    pendingSearchRef.current = lastQuery;
    setBilling(prev => ({ ...prev, freeRemaining: 0 }));
    setAuthPrompt(user ? 'subscribe' : 'limit');
  }, [state.status, state.errorMessage, user, lastQuery]);

  const closeAuthPrompt = useCallback(() => {
    pendingSearchRef.current = null;
    setAuthPrompt(null);
  }, []);

  const handleSignedIn = useCallback(async () => {
    const pending = pendingSearchRef.current;
    setAuthPrompt(null);
    const status = await refreshBilling();
    const outOfFree = typeof status.freeRemaining === 'number' && status.freeRemaining <= 0;
    if (status.configured && !status.active && outOfFree) {
      setAuthPrompt('subscribe');
      return;
    }
    pendingSearchRef.current = null;
    if (pending) runSearch(pending.address, pending.match);
  }, [refreshBilling, runSearch]);

  const handleSubscribe = useCallback(async () => {
    const { url } = await api.startCheckout();
    window.location.assign(url);
  }, []);

  const handleManageBilling = useCallback(async () => {
    const { url } = await api.openBillingPortal();
    window.location.assign(url);
  }, []);

  const openSignIn = useCallback(() => setAuthPrompt('signin'), []);
  const openSubscribe = useCallback(() => setAuthPrompt('subscribe'), []);
  const requireAccountForExport = useCallback(
    () => setAuthPrompt(user ? 'subscribe' : 'export'),
    [user]
  );

  const handleAlternativeClick = useCallback(
    alternative => handleSearch(alternative.label, alternative),
    [handleSearch]
  );

  const alternatives = state.location?.alternatives || [];

  const handleParcelClick = useCallback(
    (lat, lng, ownerLabel) => {
      countNextParcelRef.current = false;
      searchByCoords(lat, lng, state.location?.countyKey, ownerLabel || 'Selected parcel');
    },
    [searchByCoords, state.location?.countyKey]
  );

  const hasResults = state.status === 'done' || state.status === 'loading';
  const limitError = state.status === 'error' && LIMIT_ERRORS.has(state.errorMessage);

  return (
    <div className="app">
      {/* ── Header ── */}
      <header className="app-header">
        <div className="app-header-brand">
          <img
            src="/sitescope_logo.png"
            alt="SiteScope — Pre-Construction Site Research"
            className="app-header-logo-img"
          />
        </div>

        <div className="app-header-search">
          <SearchBar
            onSearch={handleSearch}
            onCancel={cancelSearch}
            isLoading={state.status === 'loading'}
          />
        </div>

        <div className="app-header-actions">
          {hasResults && (
            <ExportPanel
              location={state.location}
              parcel={state.parcel}
              flood={state.flood}
              soil={state.soil}
              elevation={state.elevation}
              wetlands={state.wetlands}
              mapRef={mapRef}
              dataPanelRef={dataPanelRef}
              canExport={isAuthConfigured ? unlimited : true}
              onRequireAccount={requireAccountForExport}
            />
          )}
          {isAuthConfigured && (
            <AccountMenu
              remainingSearches={remaining}
              onSignInClick={openSignIn}
              billingConfigured={billing.configured}
              subscriptionActive={billing.active}
              onSubscribe={openSubscribe}
              onManageBilling={handleManageBilling}
            />
          )}
        </div>
      </header>

      {authPrompt && (
        <AuthModal
          reason={authPrompt}
          billingConfigured={billing.configured}
          onClose={closeAuthPrompt}
          onSignedIn={handleSignedIn}
          onSubscribe={handleSubscribe}
        />
      )}

      {hasResults && alternatives.length > 0 && (
        <AlternativeMatches
          alternatives={alternatives}
          currentLabel={state.location?.displayName}
          onSelect={handleAlternativeClick}
        />
      )}

      {/* ── Map ── */}
      <div className="app-map-section" ref={mapRef} id="map-section">
        <MapView
          location={state.location}
          parcelFeature={state.parcel?.feature}
          neighborFeatures={state.parcel?.neighbors}
          floodFeatures={state.flood?.features}
          wetlandFeatures={state.wetlands?.features}
          status={state.status}
          onNeighborClick={handleParcelClick}
          onParcelClick={handleParcelClick}
        />
      </div>

      {/* ── Data Panel ── */}
      {hasResults && (
        <div className="app-data-section" ref={dataPanelRef} id="data-panel-section">
          <DataPanel state={state} onNeighborClick={handleParcelClick} />
        </div>
      )}

      {/* ── Empty state ── */}
      {state.status === 'idle' && (
        <div className="app-empty">
          <div className="app-empty-inner">
            <img
              src="/sitescope_logo.png"
              alt=""
              className="app-empty-logo"
              aria-hidden="true"
            />
            <h2>Search a Pennsylvania address to begin</h2>
            <p>
              SiteScope aggregates parcel data, FEMA flood zones, soils, topography,
              and wetlands into a single pre-construction research report.
            </p>
            <div className="app-empty-counties">
              {SUPPORTED_COUNTIES.map(name => (
                <span key={name} className="badge badge-info">
                  {name}
                </span>
              ))}
              <span className="badge badge-neutral">More counties coming soon</span>
            </div>
          </div>
        </div>
      )}

      {/* ── Error state ── */}
      {limitError && !authPrompt && (
        <div className="app-empty">
          <div className="app-empty-inner">
            {user ? (
              <>
                <h2>Subscription required</h2>
                <p>SiteScope is $30 a month for unlimited searches and exports.</p>
                <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={openSubscribe}>
                  Subscribe
                </button>
              </>
            ) : (
              <>
                <h2>You’ve used your free searches</h2>
                <p>Sign in to keep researching sites.</p>
                <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={openSignIn}>
                  Sign in
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {state.status === 'error' && !limitError && (
        <div className="app-empty">
          <div className="app-empty-inner app-empty-error">
            <div className="app-empty-icon">⚠️</div>
            <h2>Search failed</h2>
            <p>
              {state.errorMessage === 'Could not geocode address. Please try again.'
                ? 'The server may be starting up (this can take ~30 seconds on first use). Please try again.'
                : state.errorMessage === 'auth_required'
                  ? 'Your session could not be started. Refresh the page and try again.'
                  : state.errorMessage || 'Try adding a city, state, or ZIP code to your search.'}
            </p>
            {lastQuery && (
              <button
                className="btn btn-primary"
                style={{ marginTop: '1rem' }}
                onClick={() => handleSearch(lastQuery.address, lastQuery.match)}
              >
                Try again
              </button>
            )}
          </div>
        </div>
      )}

      <footer className="app-footer">
        <p className="app-footer-disclaimer">{DISCLAIMER_SHORT}</p>
        <p className="app-footer-meta">
          SiteScope by Posch Ventures &nbsp;·&nbsp;{' '}
          <a href="mailto:support@poschventures.com">support@poschventures.com</a>
          &nbsp;·&nbsp; <a href="/privacy">Privacy</a>
          &nbsp;·&nbsp; poschventures.com
        </p>
      </footer>
    </div>
  );
}
