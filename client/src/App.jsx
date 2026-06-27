import React, { useCallback, useRef } from 'react';
import SearchBar from './components/SearchBar/SearchBar';
import MapView from './components/Map/MapView';
import DataPanel from './components/DataPanel/DataPanel';
import ExportPanel from './components/Export/ExportPanel';
import { useSiteData } from './hooks/useSiteData';
import { SUPPORTED_COUNTIES } from './utils/county';
import './App.css';

export default function App() {
  const { state, search, searchByCoords, cancelSearch } = useSiteData();
  const mapRef = useRef(null);
  const dataPanelRef = useRef(null);

  const handleSearch = useCallback(
    address => search(address),
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
              buildings={state.buildings}
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
          buildingFeatures={state.buildings?.features}
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
              SiteScope aggregates parcel data, FEMA flood zones, soils, topography, building
              footprints, and wetlands into a single pre-construction research report.
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
            <h2>Address not found</h2>
            <p>{state.errorMessage || 'Try adding a city, state, or ZIP code to your search.'}</p>
          </div>
        </div>
      )}

      <footer className="app-footer">
        SiteScope by Posch Ventures &nbsp;·&nbsp;{' '}
        <a href="mailto:support@poschventures.com">support@poschventures.com</a>
        &nbsp;·&nbsp; poschventures.com
      </footer>
    </div>
  );
}
