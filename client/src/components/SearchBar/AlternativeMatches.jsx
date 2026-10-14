import React, { memo } from 'react';
import { formatCountyMatchLabel } from '../../utils/format';
import './SearchBar.css';

/**
 * Shown when an address matched parcels in more than one place
 * (e.g. "28 E Market St" exists in York City and Lititz).
 */
function AlternativeMatches({ alternatives, currentLabel, onSelect }) {
  const labels = alternatives.map(formatCountyMatchLabel);
  const current = String(currentLabel || '').toUpperCase();

  return (
    <div className="alt-matches" role="status">
      <span className="alt-matches-label">Not the right property? Also found:</span>
      {alternatives.map((alt, i) => {
        const label = labels[i];
        // Separate parcels can share one address — the parcel ID tells them apart.
        const isDuplicate =
          label.toUpperCase() === current ||
          labels.some((other, j) => j !== i && other === label);
        const text = isDuplicate ? `${label} (Parcel ${alt.parcelId})` : label;
        return (
          <button
            key={`${alt.countyKey}-${alt.parcelId}`}
            type="button"
            className="alt-matches-btn"
            onClick={() => onSelect({ ...alt, label })}
          >
            {text}
          </button>
        );
      })}
    </div>
  );
}

export default memo(AlternativeMatches);
