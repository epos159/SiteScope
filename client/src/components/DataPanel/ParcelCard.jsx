import React from 'react';
import './DataPanel.css';

export default function ParcelCard({ data, isLoading, onNeighborClick }) {
  const props = data?.feature?.properties;
  const neighbors = data?.neighbors || [];

  return (
    <div className="data-card">
      <div className="data-card-header">
        <span className="data-card-icon">🏠</span>
        <h3 className="data-card-title">Parcel Information</h3>
      </div>
      <div className="data-card-body">
        {isLoading && (
          <div className="data-card-loading">
            <span className="data-card-spinner" />
            Loading parcel data…
          </div>
        )}

        {!isLoading && !data?.supported && data?.message && (
          <p className="data-card-unavailable">{data.message}</p>
        )}

        {!isLoading && data?.error && (
          <p className="data-card-unavailable">Data not available for this location.</p>
        )}

        {!isLoading && data?.geocodeMismatch && props?.siteAddress && (
          <p className="parcel-match-note">
            Matched parcel by county address records: <strong>{props.siteAddress}</strong>
          </p>
        )}

        {!isLoading && props && (
          <>
            <div className="field-row">
              <span className="field-label">Owner</span>
              <span className="field-value">
                {props.ownerName || <span className="field-value--muted">Not available</span>}
                {props.ownerName2 && <><br />{props.ownerName2}</>}
              </span>
            </div>

            <div className="field-row">
              <span className="field-label">Parcel ID</span>
              <span className="field-value">
                {props.parcelId || <span className="field-value--muted">—</span>}
              </span>
            </div>

            <div className="field-row">
              <span className="field-label">Lot Acreage</span>
              <span className="field-value">
                {props.acreage
                  ? `${props.acreage} ac`
                  : <span className="field-value--muted">Not available</span>}
              </span>
            </div>

            <div className="field-row">
              <span className="field-label">Municipality</span>
              <span className="field-value">
                {props.municipality || <span className="field-value--muted">Not available</span>}
              </span>
            </div>

            <div className="field-row">
              <span className="field-label">County</span>
              <span className="field-value">{props.county}</span>
            </div>

            {props.siteAddress && (
              <div className="field-row">
                <span className="field-label">Site Address</span>
                <span className="field-value">{props.siteAddress}</span>
              </div>
            )}

            {neighbors.length > 0 && (
              <>
                <p className="card-section-title" style={{ marginTop: 16 }}>
                  Adjoining Landowners
                  {onNeighborClick && (
                    <span className="neighbor-hint"> — click to view parcel</span>
                  )}
                </p>
                <ul className="neighbor-list">
                  {neighbors.map((n, i) => (
                    <li key={n.parcelId || i} className="neighbor-item">
                      <span className="neighbor-dot" />
                      {onNeighborClick && n.centroid ? (
                        <button
                          className="neighbor-btn"
                          onClick={() => onNeighborClick(n.centroid.lat, n.centroid.lng, n.ownerName)}
                          title={`View parcel for ${n.ownerName}`}
                        >
                          {n.ownerName}
                        </button>
                      ) : (
                        <span>{n.ownerName}</span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}

        {!isLoading && !props && data?.supported !== false && !data?.error && !data?.message && (
          <p className="data-card-unavailable">No parcel found at this location.</p>
        )}
      </div>
    </div>
  );
}
