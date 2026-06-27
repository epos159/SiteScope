/**
 * Supported county bounds and display names (mirrors server/config/counties.js).
 */

export const COUNTY_NAMES = {
  york: 'York County',
  adams: 'Adams County',
  lancaster: 'Lancaster County',
  cumberland: 'Cumberland County',
  dauphin: 'Dauphin County',
  franklin: 'Franklin County',
};

/** Approximate bounds — checked in order when geocoder omits county. */
const COUNTY_BOUNDS = [
  { key: 'franklin', minLat: 39.72, maxLat: 40.05, minLng: -78.05, maxLng: -77.18 },
  { key: 'adams', minLat: 39.68, maxLat: 40.12, minLng: -77.58, maxLng: -76.72 },
  { key: 'cumberland', minLat: 39.93, maxLat: 40.33, minLng: -77.58, maxLng: -76.82 },
  { key: 'dauphin', minLat: 40.10, maxLat: 40.65, minLng: -77.08, maxLng: -76.42 },
  { key: 'lancaster', minLat: 39.72, maxLat: 40.17, minLng: -76.52, maxLng: -75.85 },
  { key: 'york', minLat: 39.72, maxLat: 40.18, minLng: -77.15, maxLng: -76.42 },
];

export const SUPPORTED_COUNTIES = Object.values(COUNTY_NAMES);

/**
 * Guess supported county from coordinates (mirrors server logic).
 */
export function inferCountyKey(lat, lng) {
  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);
  if (Number.isNaN(latF) || Number.isNaN(lngF)) return null;

  for (const bounds of COUNTY_BOUNDS) {
    if (
      latF >= bounds.minLat &&
      latF <= bounds.maxLat &&
      lngF >= bounds.minLng &&
      lngF <= bounds.maxLng
    ) {
      return bounds.key;
    }
  }

  return null;
}

export function getCountyDisplayName(countyKey) {
  return countyKey ? COUNTY_NAMES[countyKey] || null : null;
}
