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
import { pingServer } from './services/api';
import './App.css';

export default function App() {
  const { state, search, searchByCoords, cancelSearch } = useSiteData();
  const { isAuthConfigured, user } = useAuth();
  const { remaining, recordSearch, hasSearched } = useFreeSearches();
  const mapRef = useRef(null);
  const dataPanelRef = useRef(null);
  const [lastQuery, setLastQuery] = useState(null);
  const [authPrompt, setAuthPrompt] = useState(null);
  const pendingSearchRef = useRef(null);
  const countNextParcelRef = useRef(false);
  const isGuest = isAuthConfigured && !user;

  // Wake the Render free-tier server as early as possible so the first search
  // doesn't hit a cold start (~30 s delay).
  useEffect(() => { pingServer(); }, []);

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
      const alreadyCounted = match?.parcelId && hasSearched(`${match.countyKey}|${match.parcelId}`);
      if (isGuest && remaining <= 0 && !alreadyCounted) {
        pendingSearchRef.current = { address, match };
        setAuthPrompt('limit');
        return;
      }
      runSearch(address, match);
    },
    [isGuest, remaining, hasSearched, runSearch]
  );

  // A free search is used only when it actually loads a parcel.
  useEffect(() => {
    if (!countNextParcelRef.current || !state.parcel) return;
    countNextParcelRef.current = false;
    const parcelId = state.parcel.feature?.properties?.parcelId;
    window.gtag?.('event', 'site_search', {
      county: state.location?.countyKey || 'unsupported',
      parcel_found: Boolean(parcelId),
      signed_in: Boolean(user),
    });
    if (isGuest && parcelId) {
      recordSearch(`${state.location?.countyKey}|${parcelId}`);
    }
  }, [state.parcel, state.location?.countyKey, isGuest, user, recordSearch]);

  const closeAuthPrompt = useCallback(() => {
    pendingSearchRef.current = null;
    setAuthPrompt(null);
  }, []);

  const handleSignedIn = useCallback(() => {
    const pending = pendingSearchRef.current;
    pendingSearchRef.current = null;
    setAuthPrompt(null);
    if (pending) runSearch(pending.address, pending.match);
  }, [runSearch]);

  const openSignIn = useCallback(() => setAuthPrompt('signin'), []);
  const requireAccountForExport = useCallback(() => setAuthPrompt('export'), []);

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
              canExport={!isGuest}
              onRequireAccount={requireAccountForExport}
            />
          )}
          {isAuthConfigured && (
            <AccountMenu remainingSearches={remaining} onSignInClick={openSignIn} />
          )}
        </div>
      </header>

      {authPrompt && (
        <AuthModal reason={authPrompt} onClose={closeAuthPrompt} onSignedIn={handleSignedIn} />
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
      {state.status === 'error' && (
        <div className="app-empty">
          <div className="app-empty-inner app-empty-error">
            <div className="app-empty-icon">⚠️</div>
            <h2>Search failed</h2>
            <p>
              {state.errorMessage === 'Could not geocode address. Please try again.'
                ? 'The server may be starting up (this can take ~30 seconds on first use). Please try again.'
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
