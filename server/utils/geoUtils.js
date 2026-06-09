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
 * Approximate centroid of a GeoJSON Polygon or MultiPolygon.
 */
function getGeometryCentroid(geometry) {
  if (!geometry) return null;

  let ring;
  if (geometry.type === 'Polygon') {
    ring = geometry.coordinates[0];
  } else if (geometry.type === 'MultiPolygon') {
    ring = geometry.coordinates[0][0];
  } else {
    return null;
  }

  const points = ring.length > 1 ? ring.slice(0, -1) : ring;
  let lat = 0;
  let lng = 0;
  for (const [lngVal, latVal] of points) {
    lng += lngVal;
    lat += latVal;
  }

  return { lat: lat / points.length, lng: lng / points.length };
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

/**
 * Convert a bounding box to a WKT POLYGON (useful for soil AOI queries).
 */
function bboxToWkt(bbox, bufferDeg = 0) {
  const w = bbox.minLng - bufferDeg;
  const e = bbox.maxLng + bufferDeg;
  const s = bbox.minLat - bufferDeg;
  const n = bbox.maxLat + bufferDeg;
  return `POLYGON((${w} ${s}, ${e} ${s}, ${e} ${n}, ${w} ${n}, ${w} ${s}))`;
}

/**
 * Convert WGS84 lat/lng to Web Mercator (EPSG:3857).
 */
function latLngToWebMercator(lat, lng) {
  const x = (lng * 20037508.34) / 180;
  const y =
    (Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180)) *
    (20037508.34 / 180);
  return { x, y };
}

module.exports = {
  geojsonToWkt,
  getBoundingBox,
  getGeometryCentroid,
  pointToBufferWkt,
  bboxToEsriEnvelope,
  bboxToWkt,
  latLngToWebMercator,
};
