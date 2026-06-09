const express = require('express');
const axios = require('axios');
const { getBoundingBox } = require('../utils/geoUtils');

const router = express.Router();

const IMAGESERVER = 'https://elevation.nationalmap.gov/arcgis/rest/services/3DEPElevation/ImageServer';

router.get('/', async (req, res) => {
  const { lat, lng, geometry } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  let bbox;
  if (geometry) {
    try {
      bbox = getBoundingBox(JSON.parse(geometry));
    } catch {
      bbox = null;
    }
  }

  if (!bbox) {
    const buf = 0.003;
    const latF = parseFloat(lat);
    const lngF = parseFloat(lng);
    bbox = { minLng: lngF - buf, maxLng: lngF + buf, minLat: latF - buf, maxLat: latF + buf };
  }

  const sampleGeometry = {
    rings: [[
      [bbox.minLng, bbox.minLat],
      [bbox.maxLng, bbox.minLat],
      [bbox.maxLng, bbox.maxLat],
      [bbox.minLng, bbox.maxLat],
      [bbox.minLng, bbox.minLat],
    ]],
    spatialReference: { wkid: 4326 },
  };

  try {
    const response = await axios.get(`${IMAGESERVER}/getSamples`, {
      params: {
        geometry: JSON.stringify(sampleGeometry),
        geometryType: 'esriGeometryPolygon',
        sampleCount: 64,
        returnFirstValueOnly: false,
        interpolation: 'RSP_BilinearInterpolation',
        outFields: '*',
        f: 'json',
      },
      timeout: 20000,
    });

    const samples = response.data?.samples || [];
    const elevations = samples
      .map(s => parseFloat(s.value))
      .filter(v => !isNaN(v) && v > -9000);

    if (elevations.length === 0) {
      return res.json({ error: true, message: 'No valid elevation samples returned.' });
    }

    const minM = Math.min(...elevations);
    const maxM = Math.max(...elevations);
    const rangeM = maxM - minM;

    const minFt = Math.round(minM * 3.28084);
    const maxFt = Math.round(maxM * 3.28084);
    const rangeFt = maxFt - minFt;

    // Approximate max slope: elevation range over shortest bbox dimension
    const avgLat = (bbox.minLat + bbox.maxLat) / 2;
    const widthM = (bbox.maxLng - bbox.minLng) * 111320 * Math.cos((avgLat * Math.PI) / 180);
    const heightM = (bbox.maxLat - bbox.minLat) * 110540;
    const shortDim = Math.min(widthM, heightM);
    const estimatedMaxSlopePct = shortDim > 0 ? Math.round((rangeM / shortDim) * 100) : null;

    return res.json({
      minElevationFt: minFt,
      maxElevationFt: maxFt,
      elevationRangeFt: rangeFt,
      minElevationM: Math.round(minM),
      maxElevationM: Math.round(maxM),
      estimatedMaxSlopePct,
      hasSteepSlopes: estimatedMaxSlopePct != null && estimatedMaxSlopePct > 15,
      sampleCount: elevations.length,
    });
  } catch (err) {
    console.error('[elevation] error:', err.message);
    return res.json({
      error: true,
      message: 'USGS elevation data could not be retrieved.',
    });
  }
});

module.exports = router;
