const { getGeometryCentroid } = require('./geoUtils');

function translateCoordinates(coords, dLng, dLat) {
  if (typeof coords[0] === 'number') {
    return [coords[0] + dLng, coords[1] + dLat];
  }
  return coords.map(c => translateCoordinates(c, dLng, dLat));
}

/**
 * Shift a GeoJSON geometry so its centroid matches a trusted lat/lng
 * (corrects York County's broken WGS84 export from State Plane).
 */
function alignGeometryToGeocode(geometry, targetLat, targetLng) {
  if (!geometry || targetLat == null || targetLng == null) return geometry;

  const centroid = getGeometryCentroid(geometry);
  if (!centroid) return geometry;

  const dLng = targetLng - centroid.lng;
  const dLat = targetLat - centroid.lat;

  return {
    ...geometry,
    coordinates: translateCoordinates(geometry.coordinates, dLng, dLat),
  };
}

function applyAlignmentDelta(geometry, delta) {
  if (!geometry || !delta) return geometry;
  return {
    ...geometry,
    coordinates: translateCoordinates(geometry.coordinates, delta.dLng, delta.dLat),
  };
}

module.exports = { alignGeometryToGeocode, translateCoordinates, applyAlignmentDelta };
