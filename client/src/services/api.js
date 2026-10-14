import axios from 'axios';

const BASE = import.meta.env.VITE_API_URL || '/api';

function withSignal(options = {}) {
  const { signal, ...rest } = options;
  return signal ? { ...rest, signal } : rest;
}

/**
 * Ping the server health endpoint to wake a sleeping Render free-tier instance.
 * Fire-and-forget — errors are intentionally swallowed.
 */
export function pingServer() {
  const healthUrl = BASE.replace(/\/api$/, '/health');
  axios.get(healthUrl, { timeout: 60000 }).catch(() => {});
}

/**
 * Geocode a Pennsylvania address.
 * Returns { lat, lng, displayName, county, countyKey, state, municipality }
 * Timeout is generous (45 s) to survive a Render free-tier cold start (~30 s).
 */
export async function geocode(address, options = {}) {
  const { data } = await axios.get(`${BASE}/geocode`, withSignal({
    params: { address },
    timeout: 45000,
    ...options,
  }));
  return data;
}

/**
 * Address autocomplete suggestions for the search bar, sourced from county parcel records.
 * Returns { suggestions: [{ address, detail, countyKey, parcelId, lat, lng, municipality }] }
 */
export async function suggestAddresses(query, options = {}) {
  const { data } = await axios.get(`${BASE}/address-suggest`, withSignal({
    params: { q: query },
    timeout: 8000,
    ...options,
  }));
  return data;
}

function isRetryable(err) {
  if (axios.isCancel(err) || err?.code === 'ERR_CANCELED') return false;
  return !err.response || err.response.status >= 500;
}

/**
 * Fetch parcel data for a geocoded point, or an exact parcel when parcelId is known.
 * Retries once on timeout/network errors (e.g. Render waking up or a slow county server).
 * Returns { supported, feature, neighbors, message?, error? }
 */
export async function getParcels({ lat, lng, countyKey, address, parcelId }, options = {}) {
  const params = { lat, lng, countyKey };
  if (address) params.address = address;
  if (parcelId) params.parcelId = parcelId;
  const request = () => axios.get(`${BASE}/parcels`, withSignal({
    params,
    timeout: 45000,
    ...options,
  }));

  let first;
  try {
    ({ data: first } = await request());
  } catch (err) {
    if (!isRetryable(err)) throw err;
  }
  if (first && !first.error) return first;

  try {
    const { data } = await request();
    return data;
  } catch (err) {
    if (first) return first;
    throw err;
  }
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
 * geometry: optional GeoJSON geometry object — when provided the server queries
 * wetlands that intersect the parcel footprint instead of a 1.5 km radius.
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
