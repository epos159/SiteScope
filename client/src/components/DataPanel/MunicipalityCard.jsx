import React from 'react';
import './DataPanel.css';

function buildSearchLink(...terms) {
  const q = encodeURIComponent(terms.filter(Boolean).join(' '));
  return `https://www.google.com/search?q=${q}`;
}

export default function MunicipalityCard({ parcel, location }) {
  const props = parcel?.feature?.properties;
  const municipality = props?.municipality || location?.municipality || null;
  const county = props?.county || location?.county || null;

  const websiteSearchLink = municipality
    ? buildSearchLink(municipality, county, 'Pennsylvania official website')
    : null;
  const zoningSearchLink = municipality
    ? buildSearchLink(municipality, county, 'Pennsylvania zoning ordinance map')
    : null;

  return (
    <div className="data-card">
      <div className="data-card-header">
        <span className="data-card-icon">🏛️</span>
        <h3 className="data-card-title">Municipality</h3>
      </div>
      <div className="data-card-body">
        {!props && !location && (
          <p className="data-card-unavailable">Search an address to view municipality info.</p>
        )}

        {(props || location) && (
          <>
            <div className="field-row">
              <span className="field-label">Township / Borough</span>
              <span className="field-value">
                {municipality || <span className="field-value--muted">Not available</span>}
              </span>
            </div>

            <div className="field-row">
              <span className="field-label">County</span>
              <span className="field-value">
                {county || <span className="field-value--muted">Not available</span>}
              </span>
            </div>

            <div className="field-row">
              <span className="field-label">State</span>
              <span className="field-value">{location?.state || 'Pennsylvania'}</span>
            </div>

            <div className="field-row">
              <span className="field-label">Municipal Website</span>
              <span className="field-value">
                {websiteSearchLink ? (
                  <a href={websiteSearchLink} target="_blank" rel="noopener noreferrer">
                    Search for website →
                  </a>
                ) : (
                  <span className="field-value--muted">Not available</span>
                )}
              </span>
            </div>

            <div className="field-row">
              <span className="field-label">Zoning / Ordinance</span>
              <span className="field-value">
                {zoningSearchLink ? (
                  <a href={zoningSearchLink} target="_blank" rel="noopener noreferrer">
                    Search for zoning →
                  </a>
                ) : (
                  <span className="field-value--muted">Not available</span>
                )}
              </span>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
