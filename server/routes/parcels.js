const express = require('express');
const axios = require('axios');
const { COUNTIES } = require('../config/counties');
const { getBoundingBox, bboxToEsriEnvelope, getGeometryCentroid } = require('../utils/geoUtils');
const { resolveYorkParcel } = require('../utils/yorkParcelResolver');
const {
  buildAddressWhereClauses,
  pickBestParcelMatch,
  scoreParcelAddressMatch,
} = require('../utils/addressUtils');
const { pointInPolygon, getPolygonArea } = require('../utils/geoUtils');
const { alignGeometryToGeocode, applyAlignmentDelta } = require('../utils/geometryAlign');

const router = express.Router();
const TIMEOUT = 30000;
const geoUtils = { pointInPolygon, getGeometryCentroid, getPolygonArea };

async function queryArcGIS(endpoint, params) {
  const response = await axios.get(endpoint, {
    params: { ...params, f: 'geojson', outSR: 4326 },
    timeout: TIMEOUT,
  });
  return response.data;
}

function normalizeParcelProps(props, county, fields) {
  let acreage = null;
  if (fields.acreageDirect && props[fields.acreageDirect] != null) {
    acreage = parseFloat(props[fields.acreageDirect]).toFixed(2);
  } else if (fields.acreageFallback && props[fields.acreageFallback] != null) {
    acreage = parseFloat(props[fields.acreageFallback]).toFixed(2);
  } else if (county.acreageFromShapeArea && fields.acreage && props[fields.acreage] != null) {
    acreage = (parseFloat(props[fields.acreage]) / 43560).toFixed(2);
  }

  let municipality = props[fields.municipality] || null;
  if (!municipality && fields.districtField && county.districtLookup) {
    const code = String(props[fields.districtField] || '').padStart(2, '0');
    municipality = county.districtLookup[code] || null;
  }

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

function toFeature(rawFeature, county, fields, alignLat, alignLng) {
  const props = rawFeature.properties || {};
  let geometry = rawFeature.geometry || null;
  if (geometry && alignLat != null && alignLng != null) {
    geometry = alignGeometryToGeocode(geometry, alignLat, alignLng);
  }

  return {
    type: 'Feature',
    geometry,
    properties: normalizeParcelProps(props, county, fields),
  };
}

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
  const data = await queryArcGIS(endpoint, {
    geometry: JSON.stringify({ x: parseFloat(lng), y: parseFloat(lat) }),
    geometryType: 'esriGeometryPoint',
    inSR: 4326,
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: true,
    resultRecordCount: 25,
  });

  const candidates = data.features || [];
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
  return toFeature(best, county, fields, lat, lng);
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

  if (pointMatch && searchAddress) {
    const score = scoreParcelAddressMatch(searchAddress, pointMatch, addressSearch);
    if (score < 25) pointMatch = null;
  }

  if (!pointMatch) return null;

  return {
    feature: pointMatch,
    activeEndpoint: endpoint,
    activeFields: fields,
    matchMethod: 'point',
    geocodeMismatch: Boolean(searchAddress),
    matchConfidence: 'low',
    geocodeOnBoundary: !pointInPolygon(lat, lng, pointMatch.geometry),
  };
}

async function resolveParcel(lat, lng, countyKey, searchAddress) {
  if (countyKey === 'york') {
    const county = COUNTIES.york;
    const resolved = await resolveYorkParcel(lat, lng, county, searchAddress);
    if (!resolved) return null;
    const { alignmentDelta, ...rest } = resolved;
    return {
      ...rest,
      alignmentDelta,
      activeEndpoint: county.parcelEndpoint,
      activeFields: county.fields,
    };
  }

  return resolveGenericParcel(lat, lng, countyKey, searchAddress);
}

router.get('/', async (req, res) => {
  const { lat, lng, countyKey, address } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  if (!countyKey || !COUNTIES[countyKey]) {
    return res.json({
      supported: false,
      message: `Parcel data is currently available for York and Adams County, PA. Support for additional counties is coming soon.`,
      feature: null,
      neighbors: [],
    });
  }

  try {
    const resolved = await resolveParcel(lat, lng, countyKey, address);

    if (!resolved) {
      return res.json({
        supported: true,
        feature: null,
        neighbors: [],
        message: address
          ? 'No parcel found matching this address. Try clicking the correct parcel on the map.'
          : 'No parcel found at this location.',
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
      alignmentDelta,
    } = resolved;
    const normalized = feature.properties;

    let neighbors = [];
    if (feature.geometry) {
      try {
        const bbox = getBoundingBox(feature.geometry);
        const envelope = bboxToEsriEnvelope(bbox, 0.0005);
        const neighborData = await queryArcGIS(activeEndpoint, {
          geometry: JSON.stringify(envelope),
          geometryType: 'esriGeometryEnvelope',
          inSR: 4326,
          spatialRel: 'esriSpatialRelIntersects',
          outFields: [activeFields.parcelId, activeFields.ownerName, activeFields.ownerName2]
            .filter(Boolean)
            .join(','),
          returnGeometry: true,
          resultRecordCount: 25,
        });

        if (neighborData.features) {
          const mainId = normalized.parcelId;
          const seen = new Set([mainId]);
          neighbors = neighborData.features
            .filter(f => {
              const id = f.properties?.[activeFields.parcelId];
              if (!id || seen.has(id)) return false;
              seen.add(id);
              return true;
            })
            .map(f => {
              let geometry = f.geometry || null;
              if (geometry && countyKey === 'york' && alignmentDelta) {
                geometry = applyAlignmentDelta(geometry, alignmentDelta);
              }
              const centroid = getGeometryCentroid(geometry);
              return {
                parcelId: f.properties[activeFields.parcelId] || null,
                ownerName: f.properties[activeFields.ownerName] || 'Unknown Owner',
                centroid,
                geometry,
              };
            })
            .filter(n => n.centroid)
            .slice(0, 12);
        }
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
