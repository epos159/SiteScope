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
 * Convert GeoJSON Polygon/MultiPolygon to Esri JSON for REST geometry queries.
 */
function geojsonToEsriPolygon(geometry) {
  if (!geometry) return null;

  const spatialReference = { wkid: 4326 };

  if (geometry.type === 'Polygon') {
    return { rings: geometry.coordinates, spatialReference };
  }

  if (geometry.type === 'MultiPolygon') {
    // Use the largest polygon part for spatial queries.
    let best = geometry.coordinates[0];
    let bestArea = 0;
    for (const poly of geometry.coordinates) {
      const ring = poly[0];
      if (!ring?.length) continue;
      let area = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i];
        const [xj, yj] = ring[j];
        area += (xj + xi) * (yj - yi);
      }
      area = Math.abs(area / 2);
      if (area > bestArea) {
        bestArea = area;
        best = poly;
      }
    }
    return { rings: best, spatialReference };
  }

  return null;
}

/**
 * Ray-casting point-in-polygon test for GeoJSON Polygon / MultiPolygon.
 */
function pointInPolygon(lat, lng, geometry) {
  if (!geometry) return false;

  const testRing = ring => {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      const intersect =
        yi > lat !== yj > lat &&
        lng < ((xj - xi) * (lat - yi)) / (yj - yi + 0.0) + xi;
      if (intersect) inside = !inside;
    }
    return inside;
  };

  if (geometry.type === 'Polygon') {
    return testRing(geometry.coordinates[0]);
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.some(poly => testRing(poly[0]));
  }

  return false;
}

/**
 * Approximate polygon area in square degrees (for relative size comparisons).
 */
function getPolygonArea(geometry) {
  if (!geometry) return 0;

  const ringArea = ring => {
    let area = 0;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      area += (xj + xi) * (yj - yi);
    }
    return Math.abs(area / 2);
  };

  if (geometry.type === 'Polygon') {
    return ringArea(geometry.coordinates[0]);
  }

  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.reduce((sum, poly) => sum + ringArea(poly[0]), 0);
  }

  return 0;
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
  geojsonToEsriPolygon,
  getBoundingBox,
  getGeometryCentroid,
  pointInPolygon,
  getPolygonArea,
  pointToBufferWkt,
  bboxToEsriEnvelope,
  bboxToWkt,
  latLngToWebMercator,
};
