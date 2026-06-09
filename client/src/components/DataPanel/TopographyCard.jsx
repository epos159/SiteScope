import React from 'react';
import './DataPanel.css';

export default function TopographyCard({ data, isLoading }) {
  return (
    <div className="data-card">
      <div className="data-card-header">
        <span className="data-card-icon">⛰️</span>
        <h3 className="data-card-title">Topography</h3>
      </div>
      <div className="data-card-body">
        {isLoading && (
          <div className="data-card-loading">
            <span className="data-card-spinner" />
            Loading USGS elevation data…
          </div>
        )}

        {!isLoading && data?.error && (
          <p className="data-card-unavailable">Data not available for this location.</p>
        )}

        {!isLoading && data && !data.error && (
          <>
            <div className="elev-stat-row">
              <div className="elev-stat">
                <div className="elev-stat-value">
                  {data.minElevationFt != null ? `${data.minElevationFt}'` : '—'}
                </div>
                <div className="elev-stat-label">Min Elev.</div>
              </div>
              <div className="elev-stat">
                <div className="elev-stat-value">
                  {data.maxElevationFt != null ? `${data.maxElevationFt}'` : '—'}
                </div>
                <div className="elev-stat-label">Max Elev.</div>
              </div>
              <div className="elev-stat">
                <div className="elev-stat-value">
                  {data.elevationRangeFt != null ? `${data.elevationRangeFt}'` : '—'}
                </div>
                <div className="elev-stat-label">Range</div>
              </div>
            </div>

            <div className="field-row">
              <span className="field-label">Est. Max Slope</span>
              <span className="field-value">
                {data.estimatedMaxSlopePct != null
                  ? `~${data.estimatedMaxSlopePct}%`
                  : <span className="field-value--muted">Not available</span>}
              </span>
            </div>

            <div className="field-row">
              <span className="field-label">Elevation Samples</span>
              <span className="field-value">{data.sampleCount ?? '—'}</span>
            </div>

            {data.estimatedMaxSlopePct != null && (
              <div
                className={`steep-slope-flag ${data.hasSteepSlopes ? 'has-steep' : 'no-steep'}`}
                style={{ marginTop: 12 }}
              >
                {data.hasSteepSlopes ? (
                  <>⚠️ Slopes exceeding 15% likely present on or near this parcel.</>
                ) : (
                  <>✅ No slopes exceeding 15% detected.</>
                )}
              </div>
            )}

            <p style={{ marginTop: 12, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              Elevation from USGS 3DEP. Slope is estimated from sampled points and should be verified with a survey.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
