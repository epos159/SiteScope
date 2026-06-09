import React from 'react';
import './DataPanel.css';

export default function BuildingsCard({ data, isLoading }) {
  const structures = data?.structures || [];

  return (
    <div className="data-card">
      <div className="data-card-header">
        <span className="data-card-icon">🏗️</span>
        <h3 className="data-card-title">Building Footprints</h3>
      </div>
      <div className="data-card-body">
        {isLoading && (
          <div className="data-card-loading">
            <span className="data-card-spinner" />
            Loading footprint data…
          </div>
        )}

        {!isLoading && data?.error && (
          <p className="data-card-unavailable">Data not available for this location.</p>
        )}

        {!isLoading && !data?.error && (
          <>
            <div className="field-row">
              <span className="field-label">Structures Detected</span>
              <span className="field-value">
                {data?.count != null ? (
                  <span className={data.count > 0 ? 'badge badge-info' : 'badge badge-neutral'}>
                    {data.count}
                  </span>
                ) : '—'}
              </span>
            </div>

            {structures.length > 0 && (
              <>
                <p className="card-section-title" style={{ marginTop: 14 }}>
                  Footprint Detail
                </p>
                <div className="building-list">
                  {structures.map(s => (
                    <div key={s.id} className="building-item">
                      <span className="building-item-label">Structure {s.id}</span>
                      <span className="building-item-value">
                        {s.squareFeet != null
                          ? `${s.squareFeet.toLocaleString()} sq ft`
                          : 'Area not available'}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {!data?.count && (
              <p className="data-card-unavailable">
                No structures detected in this area by Microsoft Building Footprints (MSBFP2).
              </p>
            )}

            <p style={{ marginTop: 12, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              Source: Microsoft Building Footprints (MSBFP2). AI-derived from satellite imagery — verify on-site.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
