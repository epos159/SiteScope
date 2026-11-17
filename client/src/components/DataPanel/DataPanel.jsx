import React, { useCallback } from 'react';
import ParcelCard from './ParcelCard';
import FloodCard from './FloodCard';
import SoilCard from './SoilCard';
import TopographyCard from './TopographyCard';
import MunicipalityCard from './MunicipalityCard';
import './DataPanel.css';

export default function DataPanel({ state, onNeighborClick, onRetryLayer }) {
  const { location, parcel, flood, soil, elevation, status, retrying = {} } = state;
  const isLoading = status === 'loading';

  const retryFlood = useCallback(() => onRetryLayer?.('flood'), [onRetryLayer]);
  const retrySoil = useCallback(() => onRetryLayer?.('soil'), [onRetryLayer]);
  const retryElevation = useCallback(() => onRetryLayer?.('elevation'), [onRetryLayer]);

  return (
    <div className="data-panel">
      <div className="data-panel-address-bar">
        <div className="data-panel-address-icon">📍</div>
        <div>
          <div className="data-panel-address-main">
            {location?.displayName?.split(',').slice(0, 3).join(', ') || 'Loading…'}
          </div>
          {location?.county && (
            <div className="data-panel-address-sub">{location.county}, {location.state}</div>
          )}
        </div>
      </div>

      <div className="data-panel-grid">
        <ParcelCard data={parcel} isLoading={isLoading && !parcel} location={location} onNeighborClick={onNeighborClick} />
        <FloodCard
          data={flood}
          isLoading={(isLoading && !flood) || Boolean(retrying.flood)}
          onRetry={onRetryLayer ? retryFlood : undefined}
        />
        <SoilCard
          data={soil}
          isLoading={(isLoading && !soil) || Boolean(retrying.soil)}
          onRetry={onRetryLayer ? retrySoil : undefined}
        />
        <TopographyCard
          data={elevation}
          isLoading={(isLoading && !elevation) || Boolean(retrying.elevation)}
          onRetry={onRetryLayer ? retryElevation : undefined}
        />
        <MunicipalityCard parcel={parcel} location={location} />
      </div>

      <p className="data-panel-disclaimer">
        Preliminary research only. Public data may be incomplete or outdated. Verify with
        official records and qualified professionals before design, permitting, or bidding.
        {' '}<a href="/terms">Terms of Service</a>
      </p>
    </div>
  );
}
