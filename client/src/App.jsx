import React, { useCallback, useEffect, useRef, useState } from 'react';
import SearchBar from './components/SearchBar/SearchBar';
import MapView from './components/Map/MapView';
import DataPanel from './components/DataPanel/DataPanel';
import ExportPanel from './components/Export/ExportPanel';
import { useSiteData } from './hooks/useSiteData';
import { SUPPORTED_COUNTIES } from './utils/county';
import { DISCLAIMER_SHORT } from './constants/disclaimer';
import { pingServer } from './services/api';
import './App.css';

export default function App() {
  const { state, search, searchByCoords, cancelSearch } = useSiteData();
  const mapRef = useRef(null);
  const dataPanelRef = useRef(null);
  const [lastQuery, setLastQuery] = useState('');

  // Wake the Render free-tier server as early as possible so the first search
  // doesn't hit a cold start (~30 s delay).
  useEffect(() => { pingServer(); }, []);

  const handleSearch = useCallback(
    address => { setLastQuery(address); search(address); },
    [search]
  );

  const handleParcelClick = useCallback(
    (lat, lng, ownerLabel) => {
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
            />
          )}
        </div>
      </header>

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
                onClick={() => handleSearch(lastQuery)}
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
          &nbsp;·&nbsp; poschventures.com
        </p>
      </footer>
    </div>
  );
}
