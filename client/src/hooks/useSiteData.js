import { useState, useCallback, useRef } from 'react';
import axios from 'axios';
import * as api from '../services/api';
import { getFeatureCentroid } from '../utils/geo';
import { inferCountyKey, getCountyDisplayName } from '../utils/county';

const initialState = {
  status: 'idle', // 'idle' | 'loading' | 'done' | 'error'
  errorMessage: null,
  location: null,
  parcel: null,
  flood: null,
  soil: null,
  elevation: null,
  wetlands: null,
  retrying: {},
};

const LAYER_FETCHERS = {
  flood: api.getFlood,
  soil: api.getSoil,
  elevation: api.getElevation,
  wetlands: api.getWetlands,
};

function isAbortError(err) {
  return axios.isCancel(err) || err?.code === 'ERR_CANCELED';
}

async function loadLayer(key, fetcher, setState, isStale) {
  try {
    const value = await fetcher();
    if (isStale()) return;
    setState(prev => ({ ...prev, [key]: value }));
  } catch (err) {
    if (isAbortError(err) || isStale()) return;
    setState(prev => ({
      ...prev,
      [key]: { error: true, message: 'Unavailable.' },
    }));
  }
}

async function loadAllData({ lat, lng, countyKey, searchedAddress, parcelId }, setState, { signal, isStale, onLayerQuery }) {
  const requestOptions = { signal };

  // Parcel first — geometry feeds centroid for downstream queries.
  let parcel = null;
  try {
    parcel = await api.getParcels(
      { lat, lng, countyKey, address: searchedAddress, parcelId },
      requestOptions
    );
    if (isStale()) return;
    setState(prev => ({ ...prev, parcel }));
  } catch (err) {
    if (isAbortError(err) || isStale()) return;
    const code = err.response?.data?.code;
    if (err.response?.status === 402 || code === 'auth_required') {
      setState(prev => ({
        ...prev,
        status: 'error',
        errorMessage: code || 'subscription_required',
      }));
      return;
    }
    parcel = { error: true, message: 'Parcel data unavailable.' };
    setState(prev => ({ ...prev, parcel }));
  }

  const geometry = parcel?.feature?.geometry ?? null;
  const centroid = getFeatureCentroid(geometry);
  const queryLat = centroid?.lat ?? lat;
  const queryLng = centroid?.lng ?? lng;
  onLayerQuery?.({ lat: queryLat, lng: queryLng, geometry });

  // Fire all layer requests in parallel; update each card as its response arrives.
  // Fast layers (flood, elevation, wetlands) typically render before slow ones (soil).
  await Promise.all(
    Object.entries(LAYER_FETCHERS).map(([key, fetcher]) =>
      loadLayer(key, () => fetcher(queryLat, queryLng, geometry, requestOptions), setState, isStale)
    )
  );

  if (!isStale()) {
    setState(prev => ({ ...prev, status: 'done' }));
  }
}

/**
 * Orchestrates all SiteScope data fetching.
 */
export function useSiteData() {
  const [state, setState] = useState(initialState);
  const abortRef = useRef(null);
  const searchGenRef = useRef(0);
  const layerQueryRef = useRef(null);

  const beginSearch = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++searchGenRef.current;
    const isStale = () => generation !== searchGenRef.current;
    layerQueryRef.current = null;
    const onLayerQuery = query => {
      if (!isStale()) layerQueryRef.current = query;
    };

    return { signal: controller.signal, isStale, onLayerQuery };
  }, []);

  /** Re-request one layer for the current site, leaving the rest of the report alone. */
  const retryLayer = useCallback(async key => {
    const fetcher = LAYER_FETCHERS[key];
    const query = layerQueryRef.current;
    if (!fetcher || !query) return;

    const generation = searchGenRef.current;
    const isStale = () => generation !== searchGenRef.current;
    const signal = abortRef.current?.signal;

    setState(prev => ({ ...prev, retrying: { ...prev.retrying, [key]: true } }));
    await loadLayer(
      key,
      () => fetcher(query.lat, query.lng, query.geometry, { signal }),
      setState,
      isStale
    );
    if (!isStale()) {
      setState(prev => ({ ...prev, retrying: { ...prev.retrying, [key]: false } }));
    }
  }, []);

  const cancelSearch = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    searchGenRef.current += 1;
    setState(initialState);
  }, []);

  /**
   * Search by address. When `match` comes from a county-record suggestion
   * (has countyKey + parcelId), geocoding is skipped and that exact parcel loads.
   */
  const search = useCallback(async (address, match = null) => {
    if (!address?.trim()) return;

    const { signal, isStale, onLayerQuery } = beginSearch();
    setState({ ...initialState, status: 'loading' });

    let location;
    if (match?.parcelId && match?.countyKey) {
      location = {
        lat: match.lat,
        lng: match.lng,
        countyKey: match.countyKey,
        county: getCountyDisplayName(match.countyKey) || '',
        state: 'Pennsylvania',
        municipality: match.municipality || '',
        displayName: match.label || address.trim(),
        searchedAddress: match.address || address.trim(),
        parcelId: match.parcelId,
        source: 'county',
      };
      setState(prev => ({ ...prev, location }));
    } else {
      try {
        location = await api.geocode(address, { signal });
        if (isStale()) return;
        setState(prev => ({ ...prev, location }));
      } catch (err) {
        if (isAbortError(err) || isStale()) return;
        const msg = err.response?.data?.error || 'Could not geocode address. Please try again.';
        setState(prev => ({ ...prev, status: 'error', errorMessage: msg }));
        return;
      }
    }

    await loadAllData(
      {
        lat: location.lat,
        lng: location.lng,
        countyKey: location.countyKey,
        searchedAddress: location.searchedAddress || address.trim(),
        parcelId: location.parcelId,
      },
      setState,
      { signal, isStale, onLayerQuery }
    );
  }, [beginSearch]);

  /**
   * Search by known coordinates — used when clicking a neighbor parcel.
   * Skips geocoding; uses supplied lat/lng directly.
   */
  const searchByCoords = useCallback(async (lat, lng, countyKey, ownerLabel) => {
    const effectiveCountyKey = countyKey || inferCountyKey(lat, lng);
    const { signal, isStale, onLayerQuery } = beginSearch();

    setState(prev => ({
      ...initialState,
      status: 'loading',
      location: {
        lat,
        lng,
        countyKey: effectiveCountyKey,
        county: prev.location?.county || getCountyDisplayName(effectiveCountyKey) || '',
        state: prev.location?.state || 'Pennsylvania',
        displayName: ownerLabel || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        municipality: '',
      },
    }));

    await loadAllData({ lat, lng, countyKey: effectiveCountyKey }, setState, { signal, isStale, onLayerQuery });
  }, [beginSearch]);

  return { state, search, searchByCoords, cancelSearch, retryLayer };
}
