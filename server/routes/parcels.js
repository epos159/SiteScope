const express = require('express');
const axios = require('axios');
const { COUNTIES } = require('../config/counties');
const { getBoundingBox, bboxToEsriEnvelope } = require('../utils/geoUtils');

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

async function fetchParcelFeature(lat, lng, county, endpoint, fields) {
  const data = await queryArcGIS(endpoint, {
    geometry: JSON.stringify({ x: parseFloat(lng), y: parseFloat(lat) }),
    geometryType: 'esriGeometryPoint',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: true,
  });

  if (!data.features?.length) return null;

  const feature = data.features[0];
  const normalized = normalizeParcelProps(feature.properties || {}, county, fields);

  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: normalized,
  };
}

router.get('/', async (req, res) => {
  const { lat, lng, countyKey } = req.query;

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

  const county = COUNTIES[countyKey];
  const { parcelEndpoint, fields } = county;

  try {
    let feature = null;
    let activeEndpoint = parcelEndpoint;
    let activeFields = fields;

    try {
      feature = await fetchParcelFeature(lat, lng, county, parcelEndpoint, fields);
    } catch (primaryErr) {
      console.warn('[parcels] primary endpoint failed:', primaryErr.message);
    }

    if (!feature && county.fallbackEndpoint && county.fallbackFields) {
      try {
        feature = await fetchParcelFeature(
          lat,
          lng,
          { ...county, acreageFromShapeArea: true },
          county.fallbackEndpoint,
          county.fallbackFields
        );
        activeEndpoint = county.fallbackEndpoint;
        activeFields = county.fallbackFields;
      } catch (fallbackErr) {
        console.warn('[parcels] fallback endpoint failed:', fallbackErr.message);
      }
    }

    if (!feature) {
      return res.json({
        supported: true,
        feature: null,
        neighbors: [],
        message: 'No parcel found at this location.',
      });
    }

    const normalized = feature.properties;

    // Fetch neighboring parcels using parcel bounding box
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
          returnGeometry: false,
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
            .map(f => ({
              parcelId: f.properties[activeFields.parcelId] || null,
              ownerName: f.properties[activeFields.ownerName] || 'Unknown Owner',
            }))
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
