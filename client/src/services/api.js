import axios from 'axios';

const BASE = import.meta.env.VITE_API_URL || '/api';

/**
 * Geocode a Pennsylvania address.
 * Returns { lat, lng, displayName, county, countyKey, state, municipality }
 */
export async function geocode(address) {
  const { data } = await axios.get(`${BASE}/geocode`, {
    params: { address },
    timeout: 12000,
  });
  return data;
}

/**
 * Address autocomplete suggestions for the search bar.
 * Returns { suggestions: [{ address, source }] }
 */
export async function suggestAddresses(query) {
  const { data } = await axios.get(`${BASE}/address-suggest`, {
    params: { q: query },
    timeout: 8000,
  });
  return data;
}

/**
 * Fetch parcel data for a geocoded point.
 * Returns { supported, feature, neighbors, message?, error? }
 */
export async function getParcels(lat, lng, countyKey, address) {
  const params = { lat, lng, countyKey };
  if (address) params.address = address;
  const { data } = await axios.get(`${BASE}/parcels`, { params, timeout: 18000 });
  return data;
}

/**
 * Fetch FEMA flood zone data for a point.
 * Returns { zone, description, sfha, firmPanel, femaMapLink, features, error? }
 */
export async function getFlood(lat, lng) {
  const { data } = await axios.get(`${BASE}/flood`, {
    params: { lat, lng },
    timeout: 55000,
  });
  return data;
}

/**
 * Fetch NRCS soil data for a point/geometry.
 * geometry: optional GeoJSON geometry object (will be serialized)
 * Returns { mapUnits, error? }
 */
export async function getSoil(lat, lng, geometry) {
  const params = { lat, lng };
  if (geometry) params.geometry = JSON.stringify(geometry);
  const { data } = await axios.get(`${BASE}/soil`, { params, timeout: 70000 });
  return data;
}

/**
 * Fetch Microsoft building footprints for a point/geometry.
 * Returns { features, count, structures, error? }
 */
export async function getBuildings(lat, lng, geometry) {
  const params = { lat, lng };
  if (geometry) params.geometry = JSON.stringify(geometry);
  const { data } = await axios.get(`${BASE}/buildings`, { params, timeout: 18000 });
  return data;
}

/**
 * Fetch USGS elevation statistics for a point/geometry.
 * Returns { minElevationFt, maxElevationFt, elevationRangeFt, estimatedMaxSlopePct, hasSteepSlopes, error? }
 */
export async function getElevation(lat, lng, geometry) {
  const params = { lat, lng };
  if (geometry) params.geometry = JSON.stringify(geometry);
  const { data } = await axios.get(`${BASE}/elevation`, { params, timeout: 25000 });
  return data;
}

/**
 * Fetch National Wetlands Inventory data for a point/geometry.
 * Returns { features, count, types, totalAcres, present, error? }
 */
export async function getWetlands(lat, lng, geometry) {
  const params = { lat, lng };
  if (geometry) params.geometry = JSON.stringify(geometry);
  const { data } = await axios.get(`${BASE}/wetlands`, { params, timeout: 18000 });
  return data;
}
