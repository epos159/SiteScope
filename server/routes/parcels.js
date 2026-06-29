const express = require('express');
const axios = require('axios');
const { COUNTIES, inferCountyKeyFromCoords, getSupportedCountyNames } = require('../config/counties');
const { getBoundingBox, bboxToEsriEnvelope, getGeometryCentroid } = require('../utils/geoUtils');
const {
  buildAddressWhereClauses,
  pickBestParcelMatch,
  scoreParcelAddressMatch,
} = require('../utils/addressUtils');
const { pointInPolygon, getPolygonArea } = require('../utils/geoUtils');

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

function composeSiteAddress(props, parts) {
  if (!parts?.length) return null;
  return (
    parts
      .map(part => props[part])
      .filter(value => value != null && String(value).trim())
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim() || null
  );
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
    const padLen = county.districtPadLength || 2;
    const code = String(props[fields.districtField] || '').padStart(padLen, '0');
    municipality = county.districtLookup[code] || null;
  }

  let ownerName = fields.ownerName ? props[fields.ownerName] || null : null;
  if (!ownerName && fields.ownerNameParts?.length) {
    ownerName =
      fields.ownerNameParts
        .map(part => props[part])
        .filter(value => value != null && String(value).trim())
        .join(' ')
        .trim() || null;
  }

  let siteAddress = props[fields.siteAddress] || null;
  const composedSiteAddress = composeSiteAddress(props, fields.siteAddressParts);
  if (composedSiteAddress && (!siteAddress || composedSiteAddress.length >= siteAddress.length)) {
    siteAddress = composedSiteAddress;
  }

  return {
    ownerName,
    ownerName2: fields.ownerName2 ? props[fields.ownerName2] || null : null,
    parcelId: props[fields.parcelId] || null,
    acreage,
    municipality,
    county: county.name,
    siteAddress,
  };
}

function toFeature(rawFeature, county, fields) {
  const props = rawFeature.properties || {};
  return {
    type: 'Feature',
    geometry: rawFeature.geometry || null,
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

  // When the user searched an address, require some agreement with the parcel
  // under the geocoded pin so we don't show an unrelated neighbor.
  if (pointMatch && searchAddress && pointScore < 25) {
    pointMatch = null;
  }

  if (!pointMatch) return null;

  const containsPoint = pointInPolygon(lat, lng, pointMatch.geometry);
  const highAddressAgreement = Boolean(searchAddress) && pointScore >= 40;

  // Strong situs agreement via spatial pick — treat like an address match (no scary warning).
  if (highAddressAgreement) {
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
    geocodeMismatch: Boolean(searchAddress) && pointScore < 40,
    matchConfidence: pointScore >= 25 ? 'medium' : 'low',
    geocodeOnBoundary: !containsPoint,
  };
}

async function resolveParcel(lat, lng, countyKey, searchAddress) {
  return resolveGenericParcel(lat, lng, countyKey, searchAddress);
}

router.get('/', async (req, res) => {
  const { lat, lng, countyKey, address } = req.query;

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
    const resolved = await resolveParcel(lat, lng, effectiveCountyKey, address);

    if (!resolved) {
      return res.json({
        supported: true,
        feature: null,
        neighbors: [],
        message: address
          ? 'No parcel found for this address.'
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
              const geometry = f.geometry || null;
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
