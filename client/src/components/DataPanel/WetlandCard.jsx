import React from 'react';
import './DataPanel.css';

export default function WetlandCard({ data, isLoading }) {
  const present = data?.present;

  return (
    <div className="data-card">
      <div className="data-card-header">
        <span className="data-card-icon">💧</span>
        <h3 className="data-card-title">Wetlands</h3>
      </div>
      <div className="data-card-body">
        {isLoading && (
          <div className="data-card-loading">
            <span className="data-card-spinner" />
            Loading NWI wetlands data…
          </div>
        )}

        {!isLoading && data?.error && (
          <>
            <p className="data-card-unavailable">
              {data.message || 'Data not available for this location.'}
            </p>
            {data.nwiMapLink && (
              <p className="data-card-source">
                <a href={data.nwiMapLink} target="_blank" rel="noopener noreferrer">
                  Check NWI mapper directly →
                </a>
              </p>
            )}
          </>
        )}

        {!isLoading && data && !data.error && (
          <>
            <div className={`wetland-banner ${present ? 'present' : 'none'}`}>
              <div className="wetland-banner-status">
                {present ? 'Yes' : 'No'}
              </div>
              <div className="wetland-banner-desc">
                {present
                  ? data.clipped
                    ? '⚠️ NWI wetlands intersect this parcel'
                    : '⚠️ NWI wetlands found near this location'
                  : '✅ No NWI wetlands on this parcel'}
                <br />
                {present && data.clipped
                  ? 'Acreage and map shading are limited to the parcel footprint.'
                  : present
                    ? 'Parcel boundary unavailable — nearby wetlands only.'
                    : 'No wetland polygons from the National Wetlands Inventory overlap this parcel.'}
              </div>
            </div>

            {present && (
              <>
                <div className="field-row">
                  <span className="field-label">Types</span>
                  <span className="field-value">
                    {(data.types || []).join(', ') || '—'}
                  </span>
                </div>

                <div className="field-row">
                  <span className="field-label">
                    {data.clipped ? 'Acres on Parcel' : 'Nearby Acres (NWI)'}
                  </span>
                  <span className="field-value">
                    {data.totalAcres != null ? `${data.totalAcres} ac` : '—'}
                  </span>
                </div>

                {data.count > 1 && (
                  <div className="field-row">
                    <span className="field-label">Features</span>
                    <span className="field-value">{data.count}</span>
                  </div>
                )}
              </>
            )}

            {data.nwiMapLink && (
              <div className="field-row">
                <span className="field-label">NWI Mapper</span>
                <span className="field-value">
                  <a href={data.nwiMapLink} target="_blank" rel="noopener noreferrer">
                    View Official Map →
                  </a>
                </span>
              </div>
            )}

            <p className="data-card-screening-note">
              NWI is a screening dataset, not a jurisdictional wetland delineation.
              Boundaries are approximate and should be confirmed by a qualified consultant.
            </p>

            {data.source && (
              <p className="data-card-source">Source: {data.source}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
