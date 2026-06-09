/**
 * Convert a GeoJSON geometry object to WKT (Well-Known Text).
 * Handles Polygon and MultiPolygon.
 */
function geojsonToWkt(geometry) {
  if (!geometry) return null;

  const ringToWkt = ring =>
    '(' + ring.map(([lng, lat]) => `${lng} ${lat}`).join(', ') + ')';

  if (geometry.type === 'Polygon') {
    const rings = geometry.coordinates.map(ringToWkt);
    return `POLYGON(${rings.join(', ')})`;
  }

  if (geometry.type === 'MultiPolygon') {
    const polygons = geometry.coordinates.map(poly => {
      const rings = poly.map(ringToWkt);
      return `(${rings.join(', ')})`;
    });
    return `MULTIPOLYGON(${polygons.join(', ')})`;
  }

  return null;
}

/**
 * Calculate bounding box from any GeoJSON geometry.
 * Returns { minLng, minLat, maxLng, maxLat }
 */
function getBoundingBox(geometry) {
  const lngs = [];
  const lats = [];

  function collect(coords) {
    if (typeof coords[0] === 'number') {
      lngs.push(coords[0]);
      lats.push(coords[1]);
    } else {
      coords.forEach(collect);
    }
  }

  collect(geometry.coordinates);

  return {
    minLng: Math.min(...lngs),
    maxLng: Math.max(...lngs),
    minLat: Math.min(...lats),
    maxLat: Math.max(...lats),
  };
}

/**
 * Create a rectangular WKT POLYGON around a lat/lng point.
 * bufferDeg: degrees of buffer (0.002 ≈ ~200m)
 */
function pointToBufferWkt(lat, lng, bufferDeg = 0.002) {
  const w = lng - bufferDeg;
  const e = lng + bufferDeg;
  const s = lat - bufferDeg;
  const n = lat + bufferDeg;
  return `POLYGON((${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}))`;
}

/**
 * Build an Esri envelope JSON object from a bounding box with optional buffer.
 */
function bboxToEsriEnvelope(bbox, bufferDeg = 0) {
  return {
    xmin: bbox.minLng - bufferDeg,
    ymin: bbox.minLat - bufferDeg,
    xmax: bbox.maxLng + bufferDeg,
    ymax: bbox.maxLat + bufferDeg,
    spatialReference: { wkid: 4326 },
  };
}

module.exports = { geojsonToWkt, getBoundingBox, pointToBufferWkt, bboxToEsriEnvelope };
