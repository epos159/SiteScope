import React from 'react';
import ParcelCard from './ParcelCard';
import FloodCard from './FloodCard';
import SoilCard from './SoilCard';
import TopographyCard from './TopographyCard';
import BuildingsCard from './BuildingsCard';
import MunicipalityCard from './MunicipalityCard';
import './DataPanel.css';

export default function DataPanel({ state }) {
  const { location, parcel, flood, soil, elevation, buildings, wetlands, status } = state;
  const isLoading = status === 'loading';

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
        <ParcelCard data={parcel} isLoading={isLoading && !parcel} />
        <FloodCard data={flood} isLoading={isLoading && !flood} />
        <SoilCard data={soil} isLoading={isLoading && !soil} />
        <TopographyCard data={elevation} isLoading={isLoading && !elevation} />
        <BuildingsCard data={buildings} isLoading={isLoading && !buildings} />
        <MunicipalityCard parcel={parcel} location={location} />
      </div>
    </div>
  );
}
