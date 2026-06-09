const express = require('express');
const axios = require('axios');
const { COUNTIES } = require('../config/counties');
const { getBoundingBox, bboxToEsriEnvelope, getGeometryCentroid } = require('../utils/geoUtils');
const {
  buildAddressWhereClause,
  pickBestAddressMatch,
  scoreAddressMatch,
} = require('../utils/addressUtils');

const router = express.Router();
const TIMEOUT = 25000;

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

async function fetchParcelFeature(lat, lng, county, endpoint, fields) {
  const data = await queryArcGIS(endpoint, {
    geometry: JSON.stringify({ x: parseFloat(lng), y: parseFloat(lat) }),
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: true,
  });

  if (!data.features?.length) return null;
  return toFeature(data.features[0], county, fields);
}

async function fetchParcelByAddress(searchAddress, county, endpoint, fields, addressSearch) {
  const where = buildAddressWhereClause(searchAddress, addressSearch);
  if (!where) return null;

  const data = await queryArcGIS(endpoint, {
    where,
    outFields: '*',
    returnGeometry: true,
    resultRecordCount: 25,
  });

  if (!data.features?.length) return null;

  const best = pickBestAddressMatch(searchAddress, data.features, fields.siteAddress);
  if (!best) return null;

  return toFeature(best, county, fields);
}

async function resolveParcel(lat, lng, countyKey, searchAddress) {
  const county = COUNTIES[countyKey];
  // Address search uses county official data only — no PASDA fallback for address matching
  const attempts = [
    {
      endpoint: county.parcelEndpoint,
      fields: county.fields,
      addressSearch: county.addressSearch,
      countyConfig: county,
    },
  ];

  let addressMatch = null;
  let addressEndpoint = null;
  let addressFields = null;

  if (searchAddress) {
    for (const attempt of attempts) {
      if (!attempt.addressSearch) continue;
      try {
        const feature = await fetchParcelByAddress(
          searchAddress,
          attempt.countyConfig,
          attempt.endpoint,
          attempt.fields,
          attempt.addressSearch
        );
        if (feature) {
          addressMatch = feature;
          addressEndpoint = attempt.endpoint;
          addressFields = attempt.fields;
          break;
        }
      } catch (err) {
        console.warn('[parcels] address search failed:', err.message);
      }
    }
  }

  let pointMatch = null;
  let pointEndpoint = county.parcelEndpoint;
  let pointFields = county.fields;

  try {
    pointMatch = await fetchParcelFeature(lat, lng, county, county.parcelEndpoint, county.fields);
  } catch (err) {
    console.warn('[parcels] point query failed:', err.message);
  }

  if (!pointMatch && county.fallbackEndpoint && county.fallbackFields) {
    try {
      pointMatch = await fetchParcelFeature(
        lat,
        lng,
        { ...county, acreageFromShapeArea: true },
        county.fallbackEndpoint,
        county.fallbackFields
      );
      pointEndpoint = county.fallbackEndpoint;
      pointFields = county.fallbackFields;
    } catch (err) {
      console.warn('[parcels] fallback point query failed:', err.message);
    }
  }

  if (addressMatch) {
    const pointAddress = pointMatch?.properties?.siteAddress;
    const addressScore = scoreAddressMatch(searchAddress, addressMatch.properties.siteAddress);
    const pointScore = pointAddress ? scoreAddressMatch(searchAddress, pointAddress) : 0;

    return {
      feature: addressMatch,
      activeEndpoint: addressEndpoint,
      activeFields: addressFields,
      matchMethod: 'address',
      geocodeMismatch: pointMatch && pointScore < addressScore,
    };
  }

  if (pointMatch) {
    return {
      feature: pointMatch,
      activeEndpoint: pointEndpoint,
      activeFields: pointFields,
      matchMethod: 'point',
      geocodeMismatch: false,
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

    const { feature, activeEndpoint, activeFields, matchMethod, geocodeMismatch } = resolved;
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
