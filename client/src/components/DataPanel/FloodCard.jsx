import React from 'react';
import './DataPanel.css';

export default function FloodCard({ data, isLoading }) {
  const isSFHA = data?.sfha;

  return (
    <div className="data-card">
      <div className="data-card-header">
        <span className="data-card-icon">🌊</span>
        <h3 className="data-card-title">Flood Information</h3>
      </div>
      <div className="data-card-body">
        {isLoading && (
          <div className="data-card-loading">
            <span className="data-card-spinner" />
            Loading FEMA data…
          </div>
        )}

        {!isLoading && data?.error && (
          <>
            <p className="data-card-unavailable">
              {data.message || 'Data not available for this location.'}
            </p>
            {data.femaMapLink && (
              <p className="data-card-source">
                <a href={data.femaMapLink} target="_blank" rel="noopener noreferrer">
                  Check FEMA map directly →
                </a>
              </p>
            )}
          </>
        )}

        {!isLoading && data && !data.error && (
          <>
            <div className={`flood-zone-banner ${isSFHA ? 'sfha' : 'no-sfha'}`}>
              <div>
                <div className="flood-zone-code">Zone {data.zone || '—'}</div>
              </div>
              <div className="flood-zone-desc">
                {isSFHA
                  ? '⚠️ Special Flood Hazard Area'
                  : '✅ Outside Special Flood Hazard Area'}
                <br />
                {data.description}
              </div>
            </div>

            <div className="field-row">
              <span className="field-label">Zone</span>
              <span className="field-value">{data.zone || '—'}</span>
            </div>

            {data.zoneSubtype && (
              <div className="field-row">
                <span className="field-label">Zone Subtype</span>
                <span className="field-value">{data.zoneSubtype}</span>
              </div>
            )}

            <div className="field-row">
              <span className="field-label">SFHA</span>
              <span className="field-value">
                {isSFHA
                  ? <span className="badge badge-error">Yes</span>
                  : <span className="badge badge-success">No</span>}
              </span>
            </div>

            {data.staticBfe && (
              <div className="field-row">
                <span className="field-label">Base Flood Elevation</span>
                <span className="field-value">
                  {data.staticBfe} {data.lenUnit || 'ft'}
                </span>
              </div>
            )}

            <div className="field-row">
              <span className="field-label">FIRM Panel</span>
              <span className="field-value">
                {data.firmPanel || <span className="field-value--muted">Not available</span>}
              </span>
            </div>

            {data.femaMapLink && (
              <div className="field-row">
                <span className="field-label">FEMA Map</span>
                <span className="field-value">
                  <a href={data.femaMapLink} target="_blank" rel="noopener noreferrer">
                    View Official Map →
                  </a>
                </span>
              </div>
            )}

            {data.source && (
              <p className="data-card-source">Source: {data.source}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
