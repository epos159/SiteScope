const express = require('express');
const axios = require('axios');
const { COUNTIES } = require('../config/counties');
const {
  getBoundingBox,
  bboxToEsriEnvelope,
  getGeometryCentroid,
  pointInPolygon,
  getPolygonArea,
} = require('../utils/geoUtils');
const {
  buildAddressWhereClauses,
  pickBestParcelMatch,
  scoreAddressMatch,
} = require('../utils/addressUtils');

const geoUtils = { pointInPolygon, getGeometryCentroid, getPolygonArea };

const router = express.Router();
const TIMEOUT = 25000;
const GEOCODE_SEARCH_BUFFER = 0.003;
const POINT_CANDIDATE_BUFFER = 0.0002;

async function queryArcGIS(endpoint, params) {
  const response = await axios.get(endpoint, {
    params: { ...params, f: 'geojson', outSR: 4326, inSR: 4326 },
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

function toFeature(rawFeature, county, fields) {
  const props = rawFeature.properties || {};
  return {
    type: 'Feature',
    geometry: rawFeature.geometry,
    properties: normalizeParcelProps(props, county, fields),
  };
}

function geocodeEnvelope(lat, lng, bufferDeg = GEOCODE_SEARCH_BUFFER) {
  return bboxToEsriEnvelope(
    {
      minLng: lng,
      maxLng: lng,
      minLat: lat,
      maxLat: lat,
    },
    bufferDeg
  );
}

async function fetchParcelCandidatesNearPoint(lat, lng, endpoint, bufferDeg = POINT_CANDIDATE_BUFFER) {
  const envelope = geocodeEnvelope(lat, lng, bufferDeg);
  const data = await queryArcGIS(endpoint, {
    geometry: JSON.stringify(envelope),
    geometryType: 'esriGeometryEnvelope',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: true,
    resultRecordCount: 25,
  });

  return data.features || [];
}

async function fetchParcelByAddress(searchAddress, lat, lng, county, endpoint, fields, addressSearch) {
  const strategies = buildAddressWhereClauses(searchAddress, addressSearch);
  if (!strategies.length) return null;

  const envelope = geocodeEnvelope(lat, lng, GEOCODE_SEARCH_BUFFER);

  for (const where of strategies) {
    try {
      const data = await queryArcGIS(endpoint, {
        geometry: JSON.stringify(envelope),
        geometryType: 'esriGeometryEnvelope',
        spatialRel: 'esriSpatialRelIntersects',
        where,
        outFields: '*',
        returnGeometry: true,
        resultRecordCount: 50,
      });

      if (!data.features?.length) continue;

      const best = pickBestParcelMatch(
        searchAddress,
        data.features,
        addressSearch,
        lat,
        lng,
        geoUtils
      );

      if (best) return toFeature(best, county, fields);
    } catch (err) {
      console.warn('[parcels] address strategy failed:', err.message);
    }
  }

  // Last resort: rank all nearby parcels by address + proximity without a WHERE filter.
  try {
    const data = await queryArcGIS(endpoint, {
      geometry: JSON.stringify(envelope),
      geometryType: 'esriGeometryEnvelope',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: true,
      resultRecordCount: 50,
    });

    const best = pickBestParcelMatch(searchAddress, data.features, addressSearch, lat, lng, geoUtils);
    if (best) return toFeature(best, county, fields);
  } catch (err) {
    console.warn('[parcels] spatial address ranking failed:', err.message);
  }

  return null;
}

async function fetchParcelNearPoint(lat, lng, county, endpoint, fields, searchAddress, addressSearch) {
  const candidates = await fetchParcelCandidatesNearPoint(lat, lng, endpoint);
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

async function resolveParcel(lat, lng, countyKey, searchAddress) {
  const county = COUNTIES[countyKey];
  const endpoint = county.parcelEndpoint;
  const fields = county.fields;
  const addressSearch = county.addressSearch;

  let addressMatch = null;

  if (searchAddress && addressSearch) {
    try {
      addressMatch = await fetchParcelByAddress(
        searchAddress,
        lat,
        lng,
        county,
        endpoint,
        fields,
        addressSearch
      );
    } catch (err) {
      console.warn('[parcels] address search failed:', err.message);
    }
  }

  let pointMatch = null;
  try {
    pointMatch = await fetchParcelNearPoint(
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

  if (addressMatch) {
    const addressScore = scoreAddressMatch(searchAddress, addressMatch.properties.siteAddress);

    return {
      feature: addressMatch,
      activeEndpoint: endpoint,
      activeFields: fields,
      matchMethod: 'address',
      geocodeMismatch: pointMatch && pointMatch.properties?.parcelId !== addressMatch.properties?.parcelId,
      matchConfidence: addressScore >= 65 ? 'high' : 'medium',
    };
  }

  if (pointMatch && searchAddress) {
    const pointAddressScore = scoreAddressMatch(searchAddress, pointMatch.properties.siteAddress);
    if (pointAddressScore < 25) {
      pointMatch = null;
    }
  }

  if (pointMatch) {
    const pointContainsGeocode = pointInPolygon(lat, lng, pointMatch.geometry);
    const pointAddressScore = searchAddress
      ? scoreAddressMatch(searchAddress, pointMatch.properties.siteAddress)
      : 0;

    return {
      feature: pointMatch,
      activeEndpoint: endpoint,
      activeFields: fields,
      matchMethod: 'point',
      geocodeMismatch: Boolean(searchAddress) && pointAddressScore < 40,
      matchConfidence: searchAddress ? (pointAddressScore >= 40 ? 'low' : 'very-low') : 'point-click',
      geocodeOnBoundary: !pointContainsGeocode,
    };
  }

  return null;
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
        message: 'No parcel found at this location.',
      });
    }

    const { feature, activeEndpoint, activeFields, matchMethod, geocodeMismatch, matchConfidence, geocodeOnBoundary } =
      resolved;
    const normalized = feature.properties;

    let neighbors = [];
    if (feature.geometry) {
      try {
        const bbox = getBoundingBox(feature.geometry);
        const envelope = bboxToEsriEnvelope(bbox, 0.0005);
        const neighborData = await queryArcGIS(activeEndpoint, {
          geometry: JSON.stringify(envelope),
          geometryType: 'esriGeometryEnvelope',
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
              const centroid = getGeometryCentroid(f.geometry);
              return {
                parcelId: f.properties[activeFields.parcelId] || null,
                ownerName: f.properties[activeFields.ownerName] || 'Unknown Owner',
                centroid,
                geometry: f.geometry || null,
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
