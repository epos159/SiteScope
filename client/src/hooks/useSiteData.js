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

async function loadAllData(lat, lng, countyKey, searchedAddress, setState, { signal, isStale }) {
  const requestOptions = { signal };

  // Parcel first — geometry feeds centroid for downstream queries.
  let parcel = null;
  try {
    parcel = await api.getParcels(lat, lng, countyKey, searchedAddress, requestOptions);
    if (isStale()) return;
    setState(prev => ({ ...prev, parcel }));
  } catch (err) {
    if (isAbortError(err) || isStale()) return;
    parcel = { error: true, message: 'Parcel data unavailable.' };
    setState(prev => ({ ...prev, parcel }));
  }

  const geometry = parcel?.feature?.geometry ?? null;
  const centroid = getFeatureCentroid(geometry);
  const queryLat = centroid?.lat ?? lat;
  const queryLng = centroid?.lng ?? lng;

  // Fire all layer requests in parallel; update each card as its response arrives.
  // Fast layers (flood, elevation, wetlands) typically render before slow ones (soil).
  await Promise.all([
    loadLayer('flood', () => api.getFlood(queryLat, queryLng, geometry, requestOptions), setState, isStale),
    loadLayer('elevation', () => api.getElevation(queryLat, queryLng, geometry, requestOptions), setState, isStale),
    loadLayer('wetlands', () => api.getWetlands(queryLat, queryLng, geometry, requestOptions), setState, isStale),
    loadLayer('soil', () => api.getSoil(queryLat, queryLng, geometry, requestOptions), setState, isStale),
  ]);

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

  const beginSearch = useCallback(() => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const generation = ++searchGenRef.current;
    const isStale = () => generation !== searchGenRef.current;

    return { signal: controller.signal, isStale };
  }, []);

  const cancelSearch = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    searchGenRef.current += 1;
    setState(initialState);
  }, []);

  /**
   * Search by typed address — geocodes first, then loads all data.
   */
  const search = useCallback(async address => {
    if (!address?.trim()) return;

    const { signal, isStale } = beginSearch();
    setState({ ...initialState, status: 'loading' });

    let location;
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

    const { lat, lng, countyKey } = location;
    await loadAllData(
      lat,
      lng,
      countyKey,
      location.searchedAddress || address.trim(),
      setState,
      { signal, isStale }
    );
  }, [beginSearch]);

  /**
   * Search by known coordinates — used when clicking a neighbor parcel.
   * Skips geocoding; uses supplied lat/lng directly.
   */
  const searchByCoords = useCallback(async (lat, lng, countyKey, ownerLabel) => {
    const effectiveCountyKey = countyKey || inferCountyKey(lat, lng);
    const { signal, isStale } = beginSearch();

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

    await loadAllData(lat, lng, effectiveCountyKey, null, setState, { signal, isStale });
  }, [beginSearch]);

  return { state, search, searchByCoords, cancelSearch };
}
