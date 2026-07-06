const express = require('express');
const axios = require('axios');
const { getBoundingBox, bboxToEsriEnvelope, pointInPolygon } = require('../utils/geoUtils');

const router = express.Router();

const FEMA_ENDPOINT =
  'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';

// FIRM_PAN and PANEL_TYP are not valid on layer 28 — requesting them causes a 400.
const FEMA_OUT_FIELDS = 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,LEN_UNIT';

const ZONE_DESCRIPTIONS = {
  A:   '1% Annual Chance Flood (No BFE Determined)',
  AE:  '1% Annual Chance Flood with Base Flood Elevations',
  AH:  '1% Annual Chance Shallow Flooding — Ponding',
  AO:  '1% Annual Chance Shallow Flooding — Sheet Flow',
  AR:  'Special Flood Hazard Area — Federal Restoration Project',
  A99: '1% Flood Hazard Protected by Certified Levee',
  VE:  'Coastal High Hazard Area with Base Flood Elevations',
  V:   'Coastal High Hazard Area (No BFE Determined)',
  X:   'Area of Minimal Flood Hazard (0.2% Annual Chance)',
  D:   'Possible Flood Hazard — Undetermined',
};

function femaMapLink(lat, lng) {
  return `https://msc.fema.gov/portal/search?AddressQuery=${encodeURIComponent(`${lat},${lng}`)}`;
}

function normalizeBfe(value) {
  if (value == null || value === '' || Number(value) === -9999) return null;
  return value;
}

/**
 * Convert Esri JSON feature to a GeoJSON-compatible feature.
 */
function esriToGeoJSON(feature) {
  const rings = feature.geometry?.rings;
  if (!rings) return null;
  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: rings },
    properties: feature.attributes || {},
  };
}

/**
 * Build an Esri envelope from parcel geometry, or a small buffered point fallback.
 * Using an envelope instead of a point returns ALL flood zone polygons that touch
 * the parcel — not just the one polygon that happens to contain the centroid.
 */
function buildQueryEnvelope(lat, lng, parsedGeometry) {
  if (parsedGeometry) {
    try {
      const bbox = getBoundingBox(parsedGeometry);
      // Small buffer so polygons that share a boundary with the parcel edge are included.
      return bboxToEsriEnvelope(bbox, 0.0005);
    } catch {
      // Fall through to point buffer.
    }
  }
  // ~200 m buffer around geocoded centroid when no parcel geometry is available.
  const buf = 0.002;
  return {
    xmin: lng - buf, ymin: lat - buf,
    xmax: lng + buf, ymax: lat + buf,
    spatialReference: { wkid: 4326 },
  };
}

async function queryFema(envelopeJson, returnGeometry) {
  const response = await axios.get(FEMA_ENDPOINT, {
    params: {
      geometry: envelopeJson,
      geometryType: 'esriGeometryEnvelope',
      inSR: 4326,
      spatialRel: 'esriSpatialRelIntersects',
      outFields: FEMA_OUT_FIELDS,
      returnGeometry,
      outSR: 4326,
      resultRecordCount: 50,
      f: 'json',
    },
    timeout: 45000,
  });
  return response.data;
}

/**
 * From the returned features, pick the primary zone for the data card.
 * Preference order: the polygon that contains the centroid > first SFHA zone > features[0].
 */
function pickPrimaryFeature(geojsonFeatures, lat, lng) {
  if (!geojsonFeatures.length) return null;

  const atCentroid = geojsonFeatures.find(
    f => f.geometry && pointInPolygon(lat, lng, f.geometry)
  );
  if (atCentroid) return atCentroid;

  const sfha = geojsonFeatures.find(f => f.properties?.SFHA_TF === 'T');
  if (sfha) return sfha;

  return geojsonFeatures[0];
}

router.get('/', async (req, res) => {
  const { lat, lng, geometry } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);
  const mapLink = femaMapLink(latF, lngF);

  let parsedGeometry = null;
  if (geometry) {
    try { parsedGeometry = JSON.parse(geometry); } catch { /* ignore */ }
  }

  const envelope = buildQueryEnvelope(latF, lngF, parsedGeometry);
  const envelopeJson = JSON.stringify(envelope);

  try {
    let data = await queryFema(envelopeJson, true);

    if (data.error) {
      console.warn('[flood] geometry query failed, retrying without geometry:', data.error.message);
      data = await queryFema(envelopeJson, false);
    }

    if (data.error) {
      console.error('[flood] API error:', data.error);
      return res.json({
        error: true,
        message: `FEMA API error: ${data.error.message || 'Unknown error'}`,
        zone: null,
        features: [],
        femaMapLink: mapLink,
      });
    }

    if (!data.features || data.features.length === 0) {
      return res.json({
        zone: 'X',
        description: 'Area of Minimal Flood Hazard — No FEMA flood hazard features found at this location.',
        sfha: false,
        firmPanel: null,
        femaMapLink: mapLink,
        features: [],
        source: 'FEMA National Flood Hazard Layer',
      });
    }

    const geojsonFeatures = data.features.map(esriToGeoJSON).filter(Boolean);

    // Only send SFHA (Special Flood Hazard Area) polygons to the map overlay.
    // Zone X polygons cover entire regions and swamp the aerial view. Their
    // absence from the overlay correctly implies "outside the hazard area."
    const mapFeatures = geojsonFeatures.filter(f => f.properties?.SFHA_TF === 'T');

    // Determine primary zone for the data card: prefer the polygon that actually
    // contains the centroid so the card matches what the parcel sits in.
    const primary = pickPrimaryFeature(geojsonFeatures, latF, lngF);
    const attrs = primary?.properties || {};
    const zone = attrs.FLD_ZONE || 'Unknown';
    const sfha = attrs.SFHA_TF === 'T';

    // Collect any additional hazard zones found in the parcel area.
    const allZones = [...new Set(geojsonFeatures.map(f => f.properties?.FLD_ZONE).filter(Boolean))];

    return res.json({
      zone,
      zoneSubtype: attrs.ZONE_SUBTY || null,
      sfha,
      staticBfe: normalizeBfe(attrs.STATIC_BFE),
      lenUnit: attrs.LEN_UNIT || 'ft',
      firmPanel: null,
      panelType: null,
      description: ZONE_DESCRIPTIONS[zone] || attrs.ZONE_SUBTY || `Flood Zone ${zone}`,
      allZones,
      femaMapLink: mapLink,
      features: mapFeatures,
      source: 'FEMA National Flood Hazard Layer',
    });
  } catch (err) {
    console.error('[flood] error:', err.message);
    return res.json({
      error: true,
      message: 'FEMA flood zone data could not be retrieved. The FEMA service may be temporarily unavailable.',
      zone: null,
      features: [],
      femaMapLink: mapLink,
    });
  }
});

module.exports = router;
