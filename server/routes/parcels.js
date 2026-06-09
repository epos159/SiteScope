const express = require('express');
const axios = require('axios');
const { COUNTIES } = require('../config/counties');
const { getBoundingBox, bboxToEsriEnvelope } = require('../utils/geoUtils');

const router = express.Router();
const TIMEOUT = 15000;

async function queryArcGIS(endpoint, params) {
  const response = await axios.get(endpoint, {
    params: { ...params, f: 'geojson', outSR: 4326, inSR: 4326 },
    timeout: TIMEOUT,
  });
  return response.data;
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
  const { parcelEndpoint, fields, acreageFromShapeArea } = county;

  try {
    // Spatial intersect on the geocoded point
    const data = await queryArcGIS(parcelEndpoint, {
      geometry: JSON.stringify({ x: parseFloat(lng), y: parseFloat(lat) }),
      geometryType: 'esriGeometryPoint',
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: true,
    });

    if (!data.features || data.features.length === 0) {
      return res.json({
        supported: true,
        feature: null,
        neighbors: [],
        message: 'No parcel found at this location.',
      });
    }

    const feature = data.features[0];
    const props = feature.properties || {};

    // Normalize acreage
    let acreage = null;
    if (fields.acreageDirect && props[fields.acreageDirect] != null) {
      acreage = parseFloat(props[fields.acreageDirect]).toFixed(2);
    } else if (acreageFromShapeArea && props[fields.acreage] != null) {
      acreage = (parseFloat(props[fields.acreage]) / 43560).toFixed(2);
    }

    const normalized = {
      ownerName: props[fields.ownerName] || null,
      ownerName2: props[fields.ownerName2] || null,
      parcelId: props[fields.parcelId] || null,
      acreage,
      municipality: props[fields.municipality] || null,
      county: county.name,
      siteAddress: props[fields.siteAddress] || null,
    };

    // Fetch neighboring parcels using parcel bounding box
    let neighbors = [];
    if (feature.geometry) {
      try {
        const bbox = getBoundingBox(feature.geometry);
        const envelope = bboxToEsriEnvelope(bbox, 0.0005);
        const neighborData = await queryArcGIS(parcelEndpoint, {
          geometry: JSON.stringify(envelope),
          geometryType: 'esriGeometryEnvelope',
          spatialRel: 'esriSpatialRelIntersects',
          outFields: [fields.parcelId, fields.ownerName, fields.ownerName2].filter(Boolean).join(','),
          returnGeometry: false,
          resultRecordCount: 25,
        });

        if (neighborData.features) {
          const mainId = normalized.parcelId;
          const seen = new Set([mainId]);
          neighbors = neighborData.features
            .filter(f => {
              const id = f.properties?.[fields.parcelId];
              if (!id || seen.has(id)) return false;
              seen.add(id);
              return true;
            })
            .map(f => ({
              parcelId: f.properties[fields.parcelId] || null,
              ownerName: f.properties[fields.ownerName] || 'Unknown Owner',
            }))
            .slice(0, 12);
        }
      } catch (neighborErr) {
        console.warn('[parcels] neighbor query failed:', neighborErr.message);
      }
    }

    return res.json({
      supported: true,
      feature: {
        type: 'Feature',
        geometry: feature.geometry,
        properties: normalized,
      },
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
