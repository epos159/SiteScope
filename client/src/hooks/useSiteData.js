import { useState, useCallback } from 'react';
import * as api from '../services/api';
import { getFeatureCentroid } from '../utils/geo';

const initialState = {
  status: 'idle', // 'idle' | 'loading' | 'done' | 'error'
  errorMessage: null,
  location: null,
  parcel: null,
  flood: null,
  soil: null,
  buildings: null,
  elevation: null,
  wetlands: null,
};

async function loadAllData(lat, lng, countyKey, searchedAddress, setState) {
  // ── Parcel (serial — geometry used downstream) ─────────────
  let parcel = null;
  try {
    parcel = await api.getParcels(lat, lng, countyKey, searchedAddress);
    setState(prev => ({ ...prev, parcel }));
  } catch {
    parcel = { error: true, message: 'Parcel data unavailable.' };
    setState(prev => ({ ...prev, parcel }));
  }

  const geometry = parcel?.feature?.geometry ?? null;
  const centroid = getFeatureCentroid(geometry);
  const queryLat = centroid?.lat ?? lat;
  const queryLng = centroid?.lng ?? lng;

  // ── All remaining data in parallel ────────────────────────
  const [floodResult, soilResult, buildingsResult, elevationResult, wetlandsResult] =
    await Promise.allSettled([
      api.getFlood(queryLat, queryLng),
      api.getSoil(queryLat, queryLng, geometry),
      api.getBuildings(queryLat, queryLng, geometry),
      api.getElevation(queryLat, queryLng, geometry),
      api.getWetlands(queryLat, queryLng, geometry),
    ]);

  const resolve = result =>
    result.status === 'fulfilled' ? result.value : { error: true, message: 'Unavailable.' };

  setState(prev => ({
    ...prev,
    status: 'done',
    flood: resolve(floodResult),
    soil: resolve(soilResult),
    buildings: resolve(buildingsResult),
    elevation: resolve(elevationResult),
    wetlands: resolve(wetlandsResult),
  }));
}

/**
 * Orchestrates all SiteScope data fetching.
 */
export function useSiteData() {
  const [state, setState] = useState(initialState);

  /**
   * Search by typed address — geocodes first, then loads all data.
   */
  const search = useCallback(async address => {
    if (!address?.trim()) return;

    setState({ ...initialState, status: 'loading' });

    let location;
    try {
      location = await api.geocode(address);
      setState(prev => ({ ...prev, location }));
    } catch (err) {
      const msg = err.response?.data?.error || 'Could not geocode address. Please try again.';
      setState(prev => ({ ...prev, status: 'error', errorMessage: msg }));
      return;
    }

    const { lat, lng, countyKey } = location;
    await loadAllData(lat, lng, countyKey, location.searchedAddress || address.trim(), setState);
  }, []);

  /**
   * Search by known coordinates — used when clicking a neighbor parcel.
   * Skips geocoding; uses supplied lat/lng directly.
   */
  const searchByCoords = useCallback(async (lat, lng, countyKey, ownerLabel) => {
    setState(prev => ({
      ...initialState,
      status: 'loading',
      location: {
        lat,
        lng,
        countyKey,
        county: prev.location?.county || '',
        state: prev.location?.state || 'Pennsylvania',
        displayName: ownerLabel || `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
        municipality: '',
      },
    }));

    await loadAllData(lat, lng, countyKey, null, setState);
  }, []);

  return { state, search, searchByCoords };
}
