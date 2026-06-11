const axios = require('axios');
const {
  buildAddressWhereClauses,
  scoreParcelAddressMatch,
  parseSearchAddress,
} = require('./addressUtils');
const { getGeometryCentroid } = require('./geoUtils');
const { alignGeometryToGeocode } = require('./geometryAlign');

const TIMEOUT = 30000;
const NATIVE_SR = 102747;
const NATIVE_BUFFER_FT = 75;

async function queryLayer(endpoint, params) {
  const response = await axios.get(endpoint, {
    params: { f: 'geojson', outSR: 4326, ...params },
    timeout: TIMEOUT,
  });
  return response.data;
}

async function queryNative(endpoint, params) {
  const response = await axios.get(endpoint, {
    params: { f: 'json', ...params },
    timeout: TIMEOUT,
  });
  return response.data;
}

function esriPolygonToGeoJSON(feature) {
  const rings = feature?.geometry?.rings;
  if (!rings) return null;
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: rings },
    properties: feature.attributes || {},
  };
}

function pickBestAddressPoint(searchAddress, features, addressSearch, geocodeLng) {
  if (!features?.length) return null;

  let best = null;
  let bestScore = -Infinity;

  for (const feature of features) {
    const addressScore = scoreParcelAddressMatch(searchAddress, feature, addressSearch);
    let total = addressScore;

    if (geocodeLng != null && feature.geometry) {
      let lng = feature.geometry.x;
      if (lng == null && feature.geometry.coordinates) {
        lng = feature.geometry.coordinates[0];
      }
      if (lng != null) {
        total += Math.max(0, 40 - Math.abs(lng - geocodeLng) * 500);
      }
    }

    if (total > bestScore) {
      bestScore = total;
      best = feature;
    }
  }

  if (scoreParcelAddressMatch(searchAddress, best, addressSearch) < 25) return null;
  return best;
}

async function searchAddressPoints(searchAddress, county, geocodeLng) {
  const endpoint = county.addressPointEndpoint;
  const addressSearch = county.addressPointSearch;
  const strategies = buildAddressWhereClauses(searchAddress, addressSearch);

  const parsed = parseSearchAddress(searchAddress);
  if (parsed.streetLine) {
    const compact = parsed.streetLine.toUpperCase().replace(/[^A-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    if (compact.length > 5) {
      strategies.push(`UPPER(${addressSearch.siteAddress}) LIKE '%${compact.replace(/'/g, "''")}%'`);
    }
  }

  const seen = new Set();
  for (const where of strategies) {
    if (!where || seen.has(where)) continue;
    seen.add(where);

    try {
      const data = await queryLayer(endpoint, {
        where,
        outFields: 'GPIN,ADDRESS,WHOLE_NAME,NAME,STRTNUMB',
        returnGeometry: true,
        resultRecordCount: 50,
      });

      const features = (data.features || []).map(f => ({
        ...f,
        properties: f.properties || {},
      }));

      const best = pickBestAddressPoint(searchAddress, features, addressSearch, geocodeLng);
      if (best) return best;
    } catch (err) {
      console.warn('[parcels/york] address point query failed:', err.message);
    }
  }

  return null;
}

async function fetchParcelByGpin(gpin, county) {
  const data = await queryLayer(county.parcelEndpoint, {
    where: `GPIN='${String(gpin).replace(/'/g, "''")}'`,
    outFields: '*',
    returnGeometry: true,
    resultRecordCount: 1,
  });
  return data.features?.[0] || null;
}

async function fetchParcelNearNativePoint(nativePoint, county) {
  const { x, y } = nativePoint;
  const data = await queryNative(county.parcelEndpoint, {
    geometry: JSON.stringify({
      xmin: x - NATIVE_BUFFER_FT,
      ymin: y - NATIVE_BUFFER_FT,
      xmax: x + NATIVE_BUFFER_FT,
      ymax: y + NATIVE_BUFFER_FT,
      spatialReference: { wkid: NATIVE_SR },
    }),
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    inSR: NATIVE_SR,
    outFields: '*',
    returnGeometry: true,
    outSR: 4326,
    resultRecordCount: 10,
    f: 'geojson',
  });

  if (data.features?.length) {
    return data.features[0];
  }

  // Fallback: Esri JSON + manual ring conversion
  const jsonData = await queryNative(county.parcelEndpoint, {
    geometry: JSON.stringify({
      xmin: x - NATIVE_BUFFER_FT,
      ymin: y - NATIVE_BUFFER_FT,
      xmax: x + NATIVE_BUFFER_FT,
      ymax: y + NATIVE_BUFFER_FT,
      spatialReference: { wkid: NATIVE_SR },
    }),
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    inSR: NATIVE_SR,
    outFields: '*',
    returnGeometry: true,
    resultRecordCount: 10,
  });

  const raw = jsonData.features?.[0];
  return raw ? esriPolygonToGeoJSON(raw) : null;
}

function normalizeParcelProps(props, county, fields) {
  let acreage = null;
  if (fields.acreageDirect && props[fields.acreageDirect] != null) {
    acreage = parseFloat(props[fields.acreageDirect]).toFixed(2);
  } else if (fields.acreageFallback && props[fields.acreageFallback] != null) {
    acreage = parseFloat(props[fields.acreageFallback]).toFixed(2);
  }

  let municipality = props[fields.municipality] || null;

  return {
    ownerName: props[fields.ownerName] || null,
    ownerName2: fields.ownerName2 ? props[fields.ownerName2] || null : null,
    parcelId: props[fields.parcelId] || null,
    acreage,
    municipality,
    county: county.name,
    siteAddress: props[fields.siteAddress] || null,
  };
}

function toFeature(rawFeature, county, fields, geocodeLat, geocodeLng) {
  const props = rawFeature.properties || rawFeature.attributes || {};
  let geometry = rawFeature.geometry || null;
  let alignmentDelta = null;

  if (geometry?.type === 'Point') {
    geometry = null;
  }

  if (geometry && geocodeLat != null && geocodeLng != null) {
    const centroid = getGeometryCentroid(geometry);
    if (centroid) {
      alignmentDelta = {
        dLat: geocodeLat - centroid.lat,
        dLng: geocodeLng - centroid.lng,
      };
    }
    geometry = alignGeometryToGeocode(geometry, geocodeLat, geocodeLng);
  }

  return {
    type: 'Feature',
    geometry,
    properties: normalizeParcelProps(props, county, fields),
    alignmentDelta,
  };
}

async function resolveYorkParcel(lat, lng, county, searchAddress) {
  const fields = county.fields;
  let addressPoint = null;
  let matchMethod = 'point';
  let matchConfidence = 'low';

  if (searchAddress) {
    addressPoint = await searchAddressPoints(searchAddress, county, lng);
  }

  let rawParcel = null;
  let gpin = null;

  if (addressPoint) {
    gpin = addressPoint.properties?.GPIN;
    matchMethod = 'address';
    matchConfidence = 'high';

    if (gpin) {
      rawParcel = await fetchParcelByGpin(gpin, county);
    }

    if (!rawParcel) {
      const native = await queryNative(county.addressPointEndpoint, {
        where: `GPIN='${String(gpin).replace(/'/g, "''")}'`,
        outFields: 'GPIN',
        returnGeometry: true,
        resultRecordCount: 1,
      });
      const nativePt = native.features?.[0]?.geometry;
      if (nativePt) {
        rawParcel = await fetchParcelNearNativePoint(nativePt, county);
      }
    }
  }

  if (!rawParcel && searchAddress) {
    // Geocode is still useful for map alignment even when address points miss.
    matchMethod = 'point';
    matchConfidence = 'very-low';
  }

  if (!rawParcel) {
    // Last resort: county-wide address search directly on parcel polygons (no spatial filter).
    const strategies = buildAddressWhereClauses(searchAddress || '', county.addressSearch);
    for (const where of strategies) {
      try {
        const data = await queryLayer(county.parcelEndpoint, {
          where,
          outFields: '*',
          returnGeometry: true,
          resultRecordCount: 25,
        });
        if (!data.features?.length) continue;

        let best = null;
        let bestScore = 0;
        for (const f of data.features) {
          const score = scoreParcelAddressMatch(searchAddress, f, county.addressSearch);
          if (score > bestScore) {
            bestScore = score;
            best = f;
          }
        }
        if (best && bestScore >= 40) {
          rawParcel = best;
          matchMethod = 'address';
          matchConfidence = bestScore >= 65 ? 'high' : 'medium';
          break;
        }
      } catch {
        // continue
      }
    }
  }

  if (!rawParcel) {
    return null;
  }

  const built = toFeature(rawParcel, county, fields, lat, lng);
  const { alignmentDelta, ...feature } = built;
  const addressScore = searchAddress
    ? scoreParcelAddressMatch(searchAddress, rawParcel, county.addressSearch)
    : 0;

  return {
    feature,
    alignmentDelta,
    matchMethod,
    matchConfidence,
    geocodeMismatch: matchMethod === 'address' && addressScore < 65,
    geocodeOnBoundary: false,
    gpin,
  };
}

module.exports = {
  resolveYorkParcel,
  alignGeometryToGeocode,
  searchAddressPoints,
};
