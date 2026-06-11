const express = require('express');
const axios = require('axios');
const { getBoundingBox, latLngToWebMercator } = require('../utils/geoUtils');

const router = express.Router();

const MSBFP_ENDPOINT =
  'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/MSBFP2/FeatureServer/0/query';

const MERCATOR_BUFFER_M = 250;

function mercatorEnvelopeString(xmin, ymin, xmax, ymax) {
  return `${xmin},${ymin},${xmax},${ymax}`;
}

function envelopeFromLatLng(lat, lng, bufferM = MERCATOR_BUFFER_M) {
  const center = latLngToWebMercator(lat, lng);
  return mercatorEnvelopeString(
    center.x - bufferM,
    center.y - bufferM,
    center.x + bufferM,
    center.y + bufferM
  );
}

function envelopeFromGeometry(geometry, bufferM = MERCATOR_BUFFER_M) {
  const bbox = getBoundingBox(geometry);
  const sw = latLngToWebMercator(bbox.minLat, bbox.minLng);
  const ne = latLngToWebMercator(bbox.maxLat, bbox.maxLng);
  return mercatorEnvelopeString(
    sw.x - bufferM,
    sw.y - bufferM,
    ne.x + bufferM,
    ne.y + bufferM
  );
}

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
      envelope = envelopeFromGeometry(JSON.parse(geometry));
    } catch {
      envelope = null;
    }
  }
  if (!envelope) {
    envelope = envelopeFromLatLng(latF, lngF);
  }

  try {
    // MSBFP2 is nationwide in Web Mercator; filter to PA and use 3857 geometry.
    const response = await axios.get(MSBFP_ENDPOINT, {
      params: {
        where: "StateAbbrev='PA'",
        geometry: envelope,
        geometryType: 'esriGeometryEnvelope',
        inSR: 3857,
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'OBJECTID,Shape__Area',
        returnGeometry: true,
        f: 'geojson',
        outSR: 4326,
        resultRecordCount: 50,
      },
      timeout: 90000,
    });

    const data = response.data;

    if (data.error) {
      console.error('[buildings] API error:', data.error);
      return res.json({
        error: true,
        message: 'Building footprint data could not be retrieved.',
        features: [],
        count: 0,
        structures: [],
      });
    }

    if (!data.features || data.features.length === 0) {
      return res.json({ features: [], count: 0, structures: [] });
    }

    const structures = data.features.map((f, idx) => {
      const areaSqM = f.properties?.Shape__Area ? parseFloat(f.properties.Shape__Area) : null;
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
