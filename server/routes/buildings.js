const express = require('express');
const axios = require('axios');
const {
  getBoundingBox,
  latLngToWebMercator,
  getGeometryCentroid,
  pointInPolygon,
} = require('../utils/geoUtils');

const router = express.Router();

const MSBFP_ENDPOINT =
  'https://services.arcgis.com/P3ePLMYs2RVChkJx/arcgis/rest/services/MSBFP2/FeatureServer/0/query';

// Small buffer when querying so edge-of-lot footprints are still fetched before clipping.
const PARCEL_QUERY_BUFFER_M = 25;
const POINT_QUERY_BUFFER_M = 150;

function mercatorEnvelopeString(xmin, ymin, xmax, ymax) {
  return `${xmin},${ymin},${xmax},${ymax}`;
}

function envelopeFromLatLng(lat, lng, bufferM) {
  const center = latLngToWebMercator(lat, lng);
  return mercatorEnvelopeString(
    center.x - bufferM,
    center.y - bufferM,
    center.x + bufferM,
    center.y + bufferM
  );
}

function envelopeFromGeometry(geometry, bufferM) {
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

function filterFeaturesToParcel(features, parcelGeometry) {
  if (!parcelGeometry || !features?.length) return features || [];

  return features.filter(feature => {
    if (!feature.geometry) return false;
    const centroid = getGeometryCentroid(feature.geometry);
    return centroid && pointInPolygon(centroid.lat, centroid.lng, parcelGeometry);
  });
}

function toStructures(features) {
  return features.map((f, idx) => {
    const areaSqM = f.properties?.Shape__Area ? parseFloat(f.properties.Shape__Area) : null;
    const areaSqFt = areaSqM ? Math.round(areaSqM * 10.7639) : null;
    return {
      id: idx + 1,
      squareFeet: areaSqFt,
      squareMeters: areaSqM ? Math.round(areaSqM) : null,
    };
  });
}

router.get('/', async (req, res) => {
  const { lat, lng, geometry } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);

  let parcelGeometry = null;
  let envelope;

  if (geometry) {
    try {
      parcelGeometry = JSON.parse(geometry);
      envelope = envelopeFromGeometry(parcelGeometry, PARCEL_QUERY_BUFFER_M);
    } catch {
      parcelGeometry = null;
    }
  }

  if (!envelope) {
    envelope = envelopeFromLatLng(latF, lngF, POINT_QUERY_BUFFER_M);
  }

  try {
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
        resultRecordCount: parcelGeometry ? 100 : 50,
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

    const rawFeatures = data.features || [];
    const onParcel = parcelGeometry
      ? filterFeaturesToParcel(rawFeatures, parcelGeometry)
      : rawFeatures;

    if (!onParcel.length) {
      return res.json({ features: [], count: 0, structures: [] });
    }

    const structures = toStructures(onParcel);

    return res.json({
      features: onParcel,
      count: onParcel.length,
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
