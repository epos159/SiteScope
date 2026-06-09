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

/**
 * Orchestrates all SiteScope data fetching for a given address.
 *
 * Flow:
 *  1. Geocode address → location + county
 *  2. Fetch parcel data (provides boundary geometry)
 *  3. Fetch all other data in parallel, using parcel geometry when available
 */
export function useSiteData() {
  const [state, setState] = useState(initialState);

  const search = useCallback(async address => {
    if (!address?.trim()) return;

    setState({ ...initialState, status: 'loading' });

    // ── Step 1: Geocode ──────────────────────────────────────
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
    const searchedAddress = location.searchedAddress || address.trim();

    // ── Step 2: Parcel (serial — geometry used downstream) ───
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

    // ── Step 3: All remaining data in parallel ───────────────
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
  }, []);

  return { state, search };
}
