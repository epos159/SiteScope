const express = require('express');
const axios = require('axios');
const { getBoundingBox, bboxToEsriEnvelope } = require('../utils/geoUtils');

const router = express.Router();

const MSBFP_ENDPOINT =
  'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/MSBFP2/FeatureServer/0/query';

router.get('/', async (req, res) => {
  const { lat, lng, geometry } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  let envelope;
  if (geometry) {
    try {
      const parsed = JSON.parse(geometry);
      envelope = bboxToEsriEnvelope(getBoundingBox(parsed));
    } catch {
      envelope = null;
    }
  }

  if (!envelope) {
    const buf = 0.002;
    const latF = parseFloat(lat);
    const lngF = parseFloat(lng);
    envelope = {
      xmin: lngF - buf,
      ymin: latF - buf,
      xmax: lngF + buf,
      ymax: latF + buf,
      spatialReference: { wkid: 4326 },
    };
  }

  try {
    const response = await axios.get(MSBFP_ENDPOINT, {
      params: {
        geometry: JSON.stringify(envelope),
        geometryType: 'esriGeometryEnvelope',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'OBJECTID,Shape_Area',
        returnGeometry: true,
        f: 'geojson',
        inSR: 4326,
        outSR: 4326,
        resultRecordCount: 50,
      },
      timeout: 15000,
    });

    const data = response.data;

    if (!data.features || data.features.length === 0) {
      return res.json({ features: [], count: 0, structures: [] });
    }

    const structures = data.features.map((f, idx) => {
      const areaSqM = f.properties?.Shape_Area ? parseFloat(f.properties.Shape_Area) : null;
      const areaSqFt = areaSqM ? Math.round(areaSqM * 10.7639) : null;
      return {
        id: idx + 1,
        squareFeet: areaSqFt,
        squareMeters: areaSqM ? Math.round(areaSqM) : null,
      };
    });

    return res.json({
      features: data.features,
      count: data.features.length,
      structures,
    });
  } catch (err) {
    console.error('[buildings] error:', err.message);
    return res.json({
      error: true,
      message: 'Building footprint data could not be retrieved.',
      features: [],
      count: 0,
      structures: [],
    });
  }
});

module.exports = router;
