const express = require('express');
const axios = require('axios');
const { intersect } = require('@turf/intersect');
const area = require('@turf/area').default;
const { featureCollection } = require('@turf/helpers');
const {
  getBoundingBox,
  latLngToWebMercator,
  geojsonToWebMercatorPolygon,
  bboxToWebMercatorEnvelope,
  geometriesIntersect,
} = require('../utils/geoUtils');

const router = express.Router();

const NWI_ENDPOINT =
  'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query';

const PARCEL_BUFFER_DEG = 0.0005;
const POINT_BUFFER_METERS = 200;
const SQ_M_PER_ACRE = 4046.8564224;

function nwiMapLink(lat, lng) {
  return `https://fwsprimary.wim.usgs.gov/wetlands/apps/wetlands-mapper/#overview/?center=${lng},${lat}&zoom=17`;
}

function geometryToFeature(geometry, properties = {}) {
  return { type: 'Feature', geometry, properties };
}

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

/**
 * Build an NWI query from parcel geometry when available.
 * A 1.5 km point buffer pulls in distant wetland polygons whose full geometry
 * paints across unrelated parcels — parcel-scoped queries avoid that.
 */
function buildNwiQuery(lat, lng, parsedGeometry) {
  if (parsedGeometry) {
    const polygon = geojsonToWebMercatorPolygon(parsedGeometry);
    if (polygon) {
      return {
        geometry: JSON.stringify(polygon),
        geometryType: 'esriGeometryPolygon',
        inSR: 3857,
      };
    }

    try {
      const envelope = bboxToWebMercatorEnvelope(
        getBoundingBox(parsedGeometry),
        PARCEL_BUFFER_DEG
      );
      return {
        geometry: JSON.stringify(envelope),
        geometryType: 'esriGeometryEnvelope',
        inSR: 3857,
      };
    } catch {
      // Fall through to buffered point query.
    }
  }

  const merc = latLngToWebMercator(lat, lng);
  return {
    geometry: `${merc.x},${merc.y}`,
    geometryType: 'esriGeometryPoint',
    inSR: 3857,
    distance: POINT_BUFFER_METERS,
    units: 'esriSRUnit_Meter',
  };
}

function filterToParcel(features, parsedGeometry) {
  if (!parsedGeometry) return features;
  return features.filter(
    feature => feature.geometry && geometriesIntersect(feature.geometry, parsedGeometry)
  );
}

/**
 * Clip NWI polygons to the parcel footprint for map display and acreage.
 * Without clipping, a shoreline lot can inherit the full lake polygon.
 */
function clipFeaturesToParcel(features, parcelGeometry) {
  if (!parcelGeometry) {
    return { features, clipped: false };
  }

  const parcelFeature = geometryToFeature(parcelGeometry);
  const clippedFeatures = [];

  for (const feature of features) {
    if (!feature.geometry) continue;

    try {
      const wetlandFeature = geometryToFeature(feature.geometry, feature.properties);
      const intersection = intersect(
        featureCollection([wetlandFeature, parcelFeature])
      );

      if (!intersection?.geometry) continue;

      const acresOnParcel = area(intersection) / SQ_M_PER_ACRE;
      clippedFeatures.push({
        type: 'Feature',
        geometry: intersection.geometry,
        properties: {
          ...feature.properties,
          ACRES_ON_PARCEL: parseFloat(acresOnParcel.toFixed(3)),
        },
      });
    } catch {
      // Keep the unclipped feature if turf cannot intersect the geometry.
      clippedFeatures.push(feature);
    }
  }

  return { features: clippedFeatures, clipped: true };
}

function summarizeFeatures(features, { clipped = false, lat, lng } = {}) {
  const types = [...new Set(features.map(f => f.properties?.WETLAND_TYPE).filter(Boolean))];
  const totalAcres = features.reduce((sum, feature) => {
    const acres = clipped
      ? feature.properties?.ACRES_ON_PARCEL
      : feature.properties?.ACRES;
    const parsed = acres != null ? parseFloat(acres) : 0;
    return sum + (Number.isNaN(parsed) ? 0 : parsed);
  }, 0);

  return {
    features,
    count: features.length,
    types,
    totalAcres: parseFloat(totalAcres.toFixed(2)),
    present: features.length > 0,
    clipped,
    source: 'National Wetlands Inventory',
    nwiMapLink: lat != null && lng != null ? nwiMapLink(lat, lng) : null,
  };
}

async function queryNwi(params) {
  const response = await axios.get(NWI_ENDPOINT, {
    params: {
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: true,
      f: 'geojson',
      outSR: 4326,
      resultRecordCount: 50,
      ...params,
    },
    timeout: 25000,
  });
  return response.data;
}

router.get('/', async (req, res) => {
  const { lat, lng, geometry } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);

  let parsedGeometry = null;
  if (geometry) {
    try {
      parsedGeometry = JSON.parse(geometry);
    } catch {
      parsedGeometry = null;
    }
  }

  try {
    const data = await queryNwi(buildNwiQuery(latF, lngF, parsedGeometry));

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

    const normalized = data.features.map(normalizeWetlandFeature);
    const parcelFeatures = filterToParcel(normalized, parsedGeometry);
    const { features: displayFeatures, clipped } = clipFeaturesToParcel(
      parcelFeatures,
      parsedGeometry
    );

    return res.json(
      summarizeFeatures(displayFeatures, { clipped, lat: latF, lng: lngF })
    );
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
