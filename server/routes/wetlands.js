const express = require('express');
const axios = require('axios');
const { latLngToWebMercator } = require('../utils/geoUtils');

const router = express.Router();

const NWI_ENDPOINT =
  'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query';

function normalizeWetlandFeature(feature) {
  const props = feature.properties || {};
  return {
    type: 'Feature',
    geometry: feature.geometry,
    properties: {
      ATTRIBUTE: props['Wetlands.ATTRIBUTE'] || props.ATTRIBUTE || null,
      WETLAND_TYPE: props['Wetlands.WETLAND_TYPE'] || props.WETLAND_TYPE || null,
      ACRES: props['Wetlands.ACRES'] ?? props.ACRES ?? null,
    },
  };
}

router.get('/', async (req, res) => {
  const { lat, lng } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);
  const merc = latLngToWebMercator(latF, lngF);

  try {
    // NWI service requires Web Mercator (3857) coordinates with a distance buffer
    const response = await axios.get(NWI_ENDPOINT, {
      params: {
        geometry: `${merc.x},${merc.y}`,
        geometryType: 'esriGeometryPoint',
        inSR: 3857,
        spatialRel: 'esriSpatialRelIntersects',
        distance: 1500,
        units: 'esriSRUnit_Meter',
        outFields: '*',
        returnGeometry: true,
        f: 'geojson',
        outSR: 4326,
        resultRecordCount: 50,
      },
      timeout: 25000,
    });

    const data = response.data;

    if (data.error) {
      console.error('[wetlands] API error:', data.error);
      return res.json({
        error: true,
        message: 'Wetlands service returned an error.',
        features: [],
        count: 0,
        types: [],
      });
    }

    if (!data.features || data.features.length === 0) {
      return res.json({
        features: [],
        count: 0,
        types: [],
        present: false,
        source: 'National Wetlands Inventory',
      });
    }

    const features = data.features.map(normalizeWetlandFeature);
    const types = [
      ...new Set(features.map(f => f.properties?.WETLAND_TYPE).filter(Boolean)),
    ];

    const totalAcres = features.reduce((sum, f) => {
      const a = f.properties?.ACRES ? parseFloat(f.properties.ACRES) : 0;
      return sum + (isNaN(a) ? 0 : a);
    }, 0);

    return res.json({
      features,
      count: features.length,
      types,
      totalAcres: parseFloat(totalAcres.toFixed(2)),
      present: true,
      source: 'National Wetlands Inventory',
    });
  } catch (err) {
    console.error('[wetlands] error:', err.message);
    return res.json({
      error: true,
      message: 'National Wetlands Inventory data could not be retrieved.',
      features: [],
      count: 0,
      types: [],
    });
  }
});

module.exports = router;
