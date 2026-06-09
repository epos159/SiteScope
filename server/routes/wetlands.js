const express = require('express');
const axios = require('axios');
const { getBoundingBox, bboxToEsriEnvelope } = require('../utils/geoUtils');

const router = express.Router();

const NWI_ENDPOINT =
  'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query';

router.get('/', async (req, res) => {
  const { lat, lng, geometry } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);

  let envelope;
  if (geometry) {
    try {
      envelope = bboxToEsriEnvelope(getBoundingBox(JSON.parse(geometry)), 0.0002);
    } catch {
      envelope = null;
    }
  }

  if (!envelope) {
    const buf = 0.002;
    envelope = {
      xmin: lngF - buf,
      ymin: latF - buf,
      xmax: lngF + buf,
      ymax: latF + buf,
      spatialReference: { wkid: 4326 },
    };
  }

  try {
    const response = await axios.get(NWI_ENDPOINT, {
      params: {
        geometry: JSON.stringify(envelope),
        geometryType: 'esriGeometryEnvelope',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'ATTRIBUTE,WETLAND_TYPE,ACRES',
        returnGeometry: true,
        f: 'geojson',
        inSR: 4326,
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

    const types = [
      ...new Set(data.features.map(f => f.properties?.WETLAND_TYPE).filter(Boolean)),
    ];

    const totalAcres = data.features.reduce((sum, f) => {
      const a = f.properties?.ACRES ? parseFloat(f.properties.ACRES) : 0;
      return sum + (isNaN(a) ? 0 : a);
    }, 0);

    return res.json({
      features: data.features,
      count: data.features.length,
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
