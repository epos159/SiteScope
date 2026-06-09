import React from 'react';
import './DataPanel.css';

/**
 * Known municipality website lookup for York & Adams County, PA.
 * Key format: "municipality name" (lowercase).
 */
const MUNI_WEBSITES = {
  'york city': 'https://www.yorkpa.gov',
  'york township': 'https://www.yorktownship.net',
  'spring garden township': 'https://www.springgardentownship.org',
  'west york borough': 'https://www.westyorkborough.org',
  'springettsbury township': 'https://www.springettsbury.com',
  'manchester township': 'https://www.manchestertownshipyork.org',
  'north york borough': 'https://www.northyorkborough.org',
  'shrewsbury township': 'https://www.shrewsburytownship.org',
  'gettysburg borough': 'https://www.gettysburgpa.gov',
  'straban township': 'https://www.strabantownship.org',
  'hamiltonban township': 'https://hamiltonbantownship.com',
  'mount joy township': 'https://www.mountjoytownshipadamscountypa.gov',
  'union township': 'https://www.uniontownshipadamscountypa.gov',
};

function getMuniWebsite(municipality) {
  if (!municipality) return null;
  return MUNI_WEBSITES[municipality.toLowerCase()] || null;
}

function getSearchLink(municipality, county) {
  const q = encodeURIComponent(`${municipality} ${county} Pennsylvania official website`);
  return `https://www.google.com/search?q=${q}`;
}

export default function MunicipalityCard({ parcel, location }) {
  const props = parcel?.feature?.properties;
  const municipality = props?.municipality || location?.municipality || null;
  const county = props?.county || location?.county || null;

  const knownWebsite = municipality ? getMuniWebsite(municipality) : null;
  const searchLink = municipality && county ? getSearchLink(municipality, county) : null;

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
                {knownWebsite ? (
                  <a href={knownWebsite} target="_blank" rel="noopener noreferrer">
                    Visit Website →
                  </a>
                ) : searchLink ? (
                  <a href={searchLink} target="_blank" rel="noopener noreferrer">
                    Search Online →
                  </a>
                ) : (
                  <span className="field-value--muted">Not available</span>
                )}
              </span>
            </div>

            <div className="field-row">
              <span className="field-label">Zoning / Ordinance</span>
              <span className="field-value">
                {searchLink ? (
                  <a
                    href={`https://www.google.com/search?q=${encodeURIComponent(`${municipality} ${county} Pennsylvania zoning ordinance map`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Search Online →
                  </a>
                ) : (
                  <span className="field-value--muted">Not available</span>
                )}
              </span>
            </div>

            <p style={{ marginTop: 12, fontSize: 'var(--font-size-xs)', color: 'var(--color-text-muted)' }}>
              Direct links shown where known. Use search links to find current municipal and zoning resources.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
