import axios from 'axios';

const BASE = import.meta.env.VITE_API_URL || '/api';

function withSignal(options = {}) {
  const { signal, ...rest } = options;
  return signal ? { ...rest, signal } : rest;
}

/**
 * Geocode a Pennsylvania address.
 * Returns { lat, lng, displayName, county, countyKey, state, municipality }
 */
export async function geocode(address, options = {}) {
  const { data } = await axios.get(`${BASE}/geocode`, withSignal({
    params: { address },
    timeout: 12000,
    ...options,
  }));
  return data;
}

/**
 * Address autocomplete suggestions for the search bar.
 * Returns { suggestions: [{ address, source }] }
 */
export async function suggestAddresses(query, options = {}) {
  const { data } = await axios.get(`${BASE}/address-suggest`, withSignal({
    params: { q: query },
    timeout: 8000,
    ...options,
  }));
  return data;
}

/**
 * Fetch parcel data for a geocoded point.
 * Returns { supported, feature, neighbors, message?, error? }
 */
export async function getParcels(lat, lng, countyKey, address, options = {}) {
  const params = { lat, lng, countyKey };
  if (address) params.address = address;
  const { data } = await axios.get(`${BASE}/parcels`, withSignal({
    params,
    timeout: 18000,
    ...options,
  }));
  return data;
}

/**
 * Fetch FEMA flood zone data for a point/geometry.
 * geometry: optional GeoJSON geometry object — when provided the server queries
 * the full parcel bbox so all flood zones on the lot are returned, not just the
 * zone at the geocoded centroid.
 * Returns { zone, description, sfha, allZones, firmPanel, femaMapLink, features, error? }
 */
export async function getFlood(lat, lng, geometry, options = {}) {
  const params = { lat, lng };
  if (geometry) params.geometry = JSON.stringify(geometry);
  const { data } = await axios.get(`${BASE}/flood`, withSignal({
    params,
    timeout: 55000,
    ...options,
  }));
  return data;
}

/**
 * Fetch NRCS soil data for a point/geometry.
 * geometry: optional GeoJSON geometry object (will be serialized)
 * Returns { mapUnits, error? }
 */
export async function getSoil(lat, lng, geometry, options = {}) {
  const params = { lat, lng };
  if (geometry) params.geometry = JSON.stringify(geometry);
  const { data } = await axios.get(`${BASE}/soil`, withSignal({
    params,
    timeout: 70000,
    ...options,
  }));
  return data;
}

/**
 * Fetch USGS elevation statistics for a point/geometry.
 * Returns { minElevationFt, maxElevationFt, elevationRangeFt, estimatedMaxSlopePct, hasSteepSlopes, error? }
 */
export async function getElevation(lat, lng, geometry, options = {}) {
  const params = { lat, lng };
  if (geometry) params.geometry = JSON.stringify(geometry);
  const { data } = await axios.get(`${BASE}/elevation`, withSignal({
    params,
    timeout: 25000,
    ...options,
  }));
  return data;
}

/**
 * Fetch National Wetlands Inventory data for a point/geometry.
 * Returns { features, count, types, totalAcres, present, error? }
 */
export async function getWetlands(lat, lng, geometry, options = {}) {
  const params = { lat, lng };
  if (geometry) params.geometry = JSON.stringify(geometry);
  const { data } = await axios.get(`${BASE}/wetlands`, withSignal({
    params,
    timeout: 18000,
    ...options,
  }));
  return data;
}
