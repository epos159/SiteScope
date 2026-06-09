import React, { useState } from 'react';
import './DataPanel.css';

export default function SoilCard({ data, isLoading }) {
  const [expanded, setExpanded] = useState(null);
  const units = data?.mapUnits || [];

  return (
    <div className="data-card">
      <div className="data-card-header">
        <span className="data-card-icon">🌱</span>
        <h3 className="data-card-title">Soil Information</h3>
      </div>
      <div className="data-card-body">
        {isLoading && (
          <div className="data-card-loading">
            <span className="data-card-spinner" />
            Loading NRCS soil data…
          </div>
        )}

        {!isLoading && data?.error && (
          <>
            <p className="data-card-unavailable">
              {data.message || 'Data not available for this location.'}
            </p>
            <p className="data-card-source">
              <a
                href="https://websoilsurvey.nrcs.usda.gov/app/WebSoilSurvey.aspx"
                target="_blank"
                rel="noopener noreferrer"
              >
                Open Web Soil Survey →
              </a>
            </p>
          </>
        )}

        {!isLoading && !data?.error && units.length === 0 && (
          <p className="data-card-unavailable">
            {data.message || 'No soil map units found for this area.'}
          </p>
        )}

        {!isLoading && units.length > 0 && (
          <>
            {units.map((unit, i) => (
              <div key={unit.mukey || i} className="soil-unit">
                <div className="soil-unit-header">
                  <span className="soil-unit-symbol">{unit.symbol}</span>
                  <span className="soil-unit-name">{unit.name}</span>
                  {unit.componentPct != null && (
                    <span className="soil-unit-pct">{unit.componentPct}%</span>
                  )}
                </div>

                <div className="field-row">
                  <span className="field-label">Slope Class</span>
                  <span className="field-value">
                    {unit.slopeClass || (
                      unit.slopeMin != null
                        ? `${unit.slopeMin}–${unit.slopeMax}%`
                        : <span className="field-value--muted">—</span>
                    )}
                  </span>
                </div>

                <div className="field-row">
                  <span className="field-label">Drainage Class</span>
                  <span className="field-value">
                    {unit.drainage || <span className="field-value--muted">—</span>}
                  </span>
                </div>

                <div className="field-row">
                  <span className="field-label">Hydrologic Group</span>
                  <span className="field-value">
                    {unit.hydrologicGroup || <span className="field-value--muted">—</span>}
                  </span>
                </div>

                <div className="field-row">
                  <span className="field-label">Hydric Soil</span>
                  <span className="field-value">
                    {unit.hydric
                      ? <span className="badge badge-warning">Yes</span>
                      : <span className="badge badge-success">No</span>}
                  </span>
                </div>

                {unit.taxOrder && (
                  <div className="field-row">
                    <span className="field-label">Taxonomy</span>
                    <span className="field-value">
                      {unit.taxOrder}
                      {unit.taxSubgroup ? ` / ${unit.taxSubgroup}` : ''}
                    </span>
                  </div>
                )}
              </div>
            ))}

            {data.source && (
              <p className="data-card-source">Source: {data.source}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
