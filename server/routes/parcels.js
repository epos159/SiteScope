const express = require('express');
const { COUNTIES, inferCountyKeyFromCoords, getSupportedCountyNames } = require('../config/counties');
const {
  queryArcGIS,
  normalizeParcelProps,
  toFeature,
  fetchParcelById,
} = require('../services/parcelRecords');
const { getBoundingBox, bboxToEsriEnvelope, getGeometryCentroid, geojsonToEsriPolygon } = require('../utils/geoUtils');
const {
  buildAddressWhereClauses,
  pickBestParcelMatch,
  scoreParcelAddressMatch,
  parseSearchAddress,
  parseMunicipalityFromSitus,
  resolveFranklinMunicipalityFromCity,
} = require('../utils/addressUtils');
const { pointInPolygon, getPolygonArea } = require('../utils/geoUtils');

const router = express.Router();
const geoUtils = { pointInPolygon, getGeometryCentroid, getPolygonArea };
// Neighbors are a nice-to-have; never let them hold up owner/municipality.
const NEIGHBOR_BUDGET_MS = 8000;

async function fetchParcelByAddressGeneric(searchAddress, county, endpoint, fields, addressSearch) {
  const strategies = buildAddressWhereClauses(searchAddress, addressSearch);
  if (!strategies.length) return null;

  for (const where of strategies) {
    try {
      const data = await queryArcGIS(endpoint, {
        where,
        outFields: '*',
        returnGeometry: true,
        resultRecordCount: 50,
      });

      if (!data.features?.length) continue;

      let best = null;
      let bestScore = 0;
      for (const f of data.features) {
        const score = scoreParcelAddressMatch(searchAddress, f, addressSearch);
        if (score > bestScore) {
          bestScore = score;
          best = f;
        }
      }

      if (best && bestScore >= 40) return toFeature(best, county, fields);
    } catch (err) {
      console.warn('[parcels] address strategy failed:', err.message);
    }
  }

  return null;
}

async function fetchParcelNearPointGeneric(lat, lng, county, endpoint, fields, searchAddress, addressSearch) {
  const pointParams = {
    geometry: JSON.stringify({ x: parseFloat(lng), y: parseFloat(lat) }),
    geometryType: 'esriGeometryPoint',
    inSR: 4326,
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: true,
    resultRecordCount: 25,
  };

  let data = await queryArcGIS(endpoint, pointParams);
  let candidates = data.features || [];

  // Some county services (e.g. Lancaster) miss point-intersect queries — retry with a small envelope.
  if (!candidates.length) {
    const buffer = 0.0004;
    const lngF = parseFloat(lng);
    const latF = parseFloat(lat);
    data = await queryArcGIS(endpoint, {
      geometry: JSON.stringify({
        xmin: lngF - buffer,
        ymin: latF - buffer,
        xmax: lngF + buffer,
        ymax: latF + buffer,
      }),
      geometryType: 'esriGeometryEnvelope',
      inSR: 4326,
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: true,
      resultRecordCount: 25,
    });
    candidates = data.features || [];
  }

  if (!candidates.length) return null;

  const best = pickBestParcelMatch(
    searchAddress || null,
    candidates,
    addressSearch || {},
    lat,
    lng,
    geoUtils
  );

  if (!best) return null;
  return toFeature(best, county, fields);
}

function applyMunicipalityFallbacks(properties, countyKey, searchAddress) {
  if (!properties || properties.municipality) return;

  if (countyKey === 'franklin') {
    const situsCity = parseMunicipalityFromSitus(properties.siteAddress);
    if (situsCity) {
      properties.municipality = resolveFranklinMunicipalityFromCity(situsCity);
    }
  }

  if (!properties.municipality && searchAddress) {
    const { city } = parseSearchAddress(searchAddress);
    if (city) {
      if (countyKey === 'franklin') {
        properties.municipality = resolveFranklinMunicipalityFromCity(city);
      }
      if (!properties.municipality) {
        properties.municipality = city;
      }
    }
  }
}

/** True when the parcel situs uses the house number the user typed, or the search has none. */
function parcelHasSearchedHouseNumber(searchAddress, feature) {
  const parsed = parseSearchAddress(searchAddress);
  if (!parsed.streetNumber) return true;
  const site = feature?.properties?.siteAddress;
  if (!site) return true;
  const num = String(parsed.streetNumber).toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\s|/)${num}(\\s|$|[A-Z])`, 'i').test(String(site));
}

async function resolveGenericParcel(lat, lng, countyKey, searchAddress) {
  const county = COUNTIES[countyKey];
  const endpoint = county.parcelEndpoint;
  const fields = county.fields;
  const addressSearch = county.addressSearch;

  let addressMatch = null;
  if (searchAddress && addressSearch) {
    try {
      addressMatch = await fetchParcelByAddressGeneric(
        searchAddress,
        county,
        endpoint,
        fields,
        addressSearch
      );
    } catch (err) {
      console.warn('[parcels] address search failed:', err.message);
    }
  }

  if (addressMatch) {
    return {
      feature: addressMatch,
      activeEndpoint: endpoint,
      activeFields: fields,
      matchMethod: 'address',
      geocodeMismatch: false,
      matchConfidence: 'high',
    };
  }

  let pointMatch = null;
  try {
    pointMatch = await fetchParcelNearPointGeneric(
      lat,
      lng,
      county,
      endpoint,
      fields,
      searchAddress,
      addressSearch
    );
  } catch (err) {
    console.warn('[parcels] point query failed:', err.message);
  }

  const pointScore =
    pointMatch && searchAddress
      ? scoreParcelAddressMatch(searchAddress, pointMatch, addressSearch)
      : 0;

  // Census interpolates address ranges, so a number the county never assigned
  // ("2519 S Queen St") can land inside a different parcel on the same street
  // ("2771 S Queen St"). The street name alone is not a match.
  if (pointMatch && searchAddress && !parcelHasSearchedHouseNumber(searchAddress, pointMatch)) {
    const found = pointMatch.properties?.siteAddress;
    const typed = String(searchAddress).split(',')[0].trim();
    return {
      feature: null,
      message: found
        ? `No county parcel is addressed ${typed}. The map location falls on ${found}.`
        : `No county parcel is addressed ${typed}.`,
    };
  }

  // When the user searched an address, require some agreement with the parcel
  // under the geocoded pin so we don't show an unrelated neighbor.
  if (pointMatch && searchAddress && pointScore < 25) {
    pointMatch = null;
  }

  if (!pointMatch) return null;

  const containsPoint = pointInPolygon(lat, lng, pointMatch.geometry);

  // Any spatial pick that agrees with the searched address is a county record match — not a guess.
  if (searchAddress && pointScore >= 25) {
    return {
      feature: pointMatch,
      activeEndpoint: endpoint,
      activeFields: fields,
      matchMethod: 'address',
      geocodeMismatch: !containsPoint,
      matchConfidence: 'high',
      geocodeOnBoundary: !containsPoint,
    };
  }

  return {
    feature: pointMatch,
    activeEndpoint: endpoint,
    activeFields: fields,
    matchMethod: 'point',
    geocodeMismatch: false,
    matchConfidence: 'high',
    geocodeOnBoundary: !containsPoint,
  };
}

async function resolveParcel(lat, lng, countyKey, searchAddress, parcelId) {
  if (parcelId) {
    try {
      const county = COUNTIES[countyKey];
      const feature = await fetchParcelById(county, parcelId);
      if (feature) {
        return {
          feature,
          activeEndpoint: county.parcelEndpoint,
          activeFields: county.fields,
          matchMethod: 'parcelId',
          geocodeMismatch: false,
          matchConfidence: 'high',
          geocodeOnBoundary: false,
        };
      }
    } catch (err) {
      console.warn('[parcels] parcelId lookup failed:', err.message);
    }
  }
  return resolveGenericParcel(lat, lng, countyKey, searchAddress);
}

function withTimeBudget(promise, ms, fallback) {
  let timer;
  return Promise.race([
    promise,
    new Promise(resolve => {
      timer = setTimeout(() => resolve(fallback), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const URBAN_ACREAGE_THRESHOLD = 0.25;
const NEIGHBOR_CAP_URBAN = 4;
const NEIGHBOR_CAP_RURAL = 6;

function getNeighborCap(acreage) {
  const acres = acreage != null ? parseFloat(acreage) : NaN;
  if (!Number.isNaN(acres) && acres < URBAN_ACREAGE_THRESHOLD) return NEIGHBOR_CAP_URBAN;
  return NEIGHBOR_CAP_RURAL;
}

function centroidDistance(a, b) {
  if (!a || !b) return Infinity;
  return Math.hypot(a.lat - b.lat, a.lng - b.lng);
}

function parcelDiagonalDeg(geometry) {
  const bbox = getBoundingBox(geometry);
  return Math.hypot(bbox.maxLat - bbox.minLat, bbox.maxLng - bbox.minLng);
}

async function fetchNeighborFeatures(activeEndpoint, parcelGeometry) {
  const esriPolygon = geojsonToEsriPolygon(parcelGeometry);
  if (esriPolygon) {
    try {
      const polygonData = await queryArcGIS(activeEndpoint, {
        geometry: JSON.stringify(esriPolygon),
        geometryType: 'esriGeometryPolygon',
        inSR: 4326,
        spatialRel: 'esriSpatialRelIntersects',
        outFields: '*',
        returnGeometry: true,
        resultRecordCount: 50,
      });
      if (polygonData.features?.length) return polygonData.features;
    } catch (err) {
      console.warn('[parcels] polygon neighbor query failed:', err.message);
    }
  }

  try {
    const bbox = getBoundingBox(parcelGeometry);
    const envelope = bboxToEsriEnvelope(bbox, 0);
    const intersectData = await queryArcGIS(activeEndpoint, {
      geometry: JSON.stringify(envelope),
      geometryType: 'esriGeometryEnvelope',
      inSR: 4326,
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: true,
      resultRecordCount: 50,
    });
    return intersectData.features || [];
  } catch (err) {
    console.warn('[parcels] envelope neighbor query failed:', err.message);
    return [];
  }
}

function buildNeighbors(rawFeatures, county, activeFields, mainParcel, cap) {
  const mainId = mainParcel.parcelId;
  const mainCentroid = getGeometryCentroid(mainParcel.geometry);
  const maxDist = Math.max(parcelDiagonalDeg(mainParcel.geometry) * 1.25, 0.00012);
  const seen = new Set([mainId]);

  const candidates = [];
  for (const f of rawFeatures) {
    const rawProps = f.properties || {};
    const id = rawProps[activeFields.parcelId];
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const geometry = f.geometry || null;
    const centroid = getGeometryCentroid(geometry);
    if (!centroid) continue;

    const dist = centroidDistance(mainCentroid, centroid);
    if (dist > maxDist) continue;

    const normalized = normalizeParcelProps(rawProps, county, activeFields);
    candidates.push({
      parcelId: normalized.parcelId,
      ownerName: normalized.ownerName || 'Unknown Owner',
      centroid,
      geometry,
      dist,
    });
  }

  candidates.sort((a, b) => a.dist - b.dist);
  return candidates.slice(0, cap).map(({ dist: _dist, ...neighbor }) => neighbor);
}

async function fetchNeighbors(activeEndpoint, feature, county, activeFields) {
  if (!feature.geometry) return [];

  const cap = getNeighborCap(feature.properties?.acreage);
  const features = await fetchNeighborFeatures(activeEndpoint, feature.geometry);

  return buildNeighbors(features, county, activeFields, {
    parcelId: feature.properties?.parcelId,
    geometry: feature.geometry,
  }, cap);
}

router.get('/', async (req, res) => {
  const { lat, lng, countyKey, address, parcelId } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  const effectiveCountyKey =
    countyKey && COUNTIES[countyKey] ? countyKey : inferCountyKeyFromCoords(lat, lng);

  if (!effectiveCountyKey || !COUNTIES[effectiveCountyKey]) {
    return res.json({
      supported: false,
      message: `Parcel data is currently available for ${getSupportedCountyNames().join(', ')}. Support for additional counties is coming soon.`,
      feature: null,
      neighbors: [],
    });
  }

  try {
    const resolved = await resolveParcel(lat, lng, effectiveCountyKey, address, parcelId);

    if (!resolved?.feature) {
      return res.json({
        supported: true,
        feature: null,
        neighbors: [],
        message: resolved?.message || (address
          ? 'No parcel found for this address.'
          : 'No parcel found at this location.'),
      });
    }

    const {
      feature,
      activeEndpoint,
      activeFields,
      matchMethod,
      geocodeMismatch,
      matchConfidence,
      geocodeOnBoundary,
    } = resolved;
    const county = COUNTIES[effectiveCountyKey];

    if (feature?.properties) {
      applyMunicipalityFallbacks(feature.properties, effectiveCountyKey, address);
    }

    let neighbors = [];
    if (feature.geometry) {
      try {
        neighbors = await withTimeBudget(
          fetchNeighbors(activeEndpoint, feature, county, activeFields),
          NEIGHBOR_BUDGET_MS,
          []
        );
      } catch (neighborErr) {
        console.warn('[parcels] neighbor query failed:', neighborErr.message);
      }
    }

    return res.json({
      supported: true,
      feature,
      neighbors,
      matchMethod,
      geocodeMismatch,
      matchConfidence,
      geocodeOnBoundary,
    });
  } catch (err) {
    console.error('[parcels] error:', err.message);
    return res.json({
      supported: true,
      error: true,
      message: 'Parcel data could not be retrieved for this location.',
      feature: null,
      neighbors: [],
    });
  }
});

module.exports = router;
 router;
