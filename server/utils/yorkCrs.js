/**
 * Approximate WGS84 → York County native (EPSG 102747) conversion.
 * Calibrated from official Address Points — ArcGIS WGS84 export is unusable for spatial queries.
 */
const LNG_REF = -76.7153;
const LAT_REF = 39.9136;
const X_REF = 12006227.96;
const Y_REF = 3657699.85;
const X_PER_LNG = 226252;
const Y_PER_LAT = -1075332;

function geocodeToYorkNative(lng, lat) {
  return {
    x: X_REF + (lng - LNG_REF) * X_PER_LNG,
    y: Y_REF + (lat - LAT_REF) * Y_PER_LAT,
  };
}

module.exports = { geocodeToYorkNative };
