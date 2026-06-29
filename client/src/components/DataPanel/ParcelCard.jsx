import React from 'react';
import './DataPanel.css';
import { shouldShowParcelMatchWarning } from '../../utils/parcelMatch';

export default function ParcelCard({ data, isLoading, location, onNeighborClick }) {
  const props = data?.feature?.properties;
  const neighbors = data?.neighbors || [];
  const hadAddressSearch = Boolean(location?.searchedAddress?.trim());
  const showMatchWarning = shouldShowParcelMatchWarning({
    data,
    location,
    siteAddress: props?.siteAddress,
  });

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

        {!isLoading && hadAddressSearch && data?.matchConfidence === 'high' && props && (
          <p className="parcel-match-note parcel-match-note--ok">
            Matched to {props.county || 'county'} assessor records
            {props.siteAddress ? (
              <> for <strong>{props.siteAddress}</strong></>
            ) : null}
            .
          </p>
        )}

        {!isLoading && showMatchWarning && (
          <p className="parcel-match-note parcel-match-note--warn">
            We found a nearby parcel, but it may not match your search
            {props?.siteAddress ? (
              <> (<strong>{props.siteAddress}</strong>)</>
            ) : null}
            . Click the correct lot on the map if needed.
          </p>
        )}

        {!isLoading && props && (