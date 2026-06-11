const express = require('express');
const axios = require('axios');

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

async function queryFema(lat, lng, returnGeometry) {
  const response = await axios.get(FEMA_ENDPOINT, {
    params: {
      geometry: JSON.stringify({ x: lng, y: lat }),
      geometryType: 'esriGeometryPoint',
      inSR: 4326,
      spatialRel: 'esriSpatialRelIntersects',
      outFields: FEMA_OUT_FIELDS,
      returnGeometry,
      outSR: 4326,
      f: 'json',
    },
    timeout: 45000,
  });
  return response.data;
}

router.get('/', async (req, res) => {
  const { lat, lng } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);
  const mapLink = femaMapLink(latF, lngF);

  try {
    let data = await queryFema(latF, lngF, true);

    if (data.error) {
      console.warn('[flood] geometry query failed, retrying without geometry:', data.error.message);
      data = await queryFema(latF, lngF, false);
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
        description: 'Area of Minimal Flood Hazard — No FEMA flood hazard features found at this point.',
        sfha: false,
        firmPanel: null,
        femaMapLink: mapLink,
        features: [],
        source: 'FEMA National Flood Hazard Layer',
      });
    }

    const attrs = data.features[0].attributes || {};
    const zone = attrs.FLD_ZONE || 'Unknown';
    const sfha = attrs.SFHA_TF === 'T' || attrs.SFHA_TF === true;

    const geojsonFeatures = data.features.map(esriToGeoJSON).filter(Boolean);

    return res.json({
      zone,
      zoneSubtype: attrs.ZONE_SUBTY || null,
      sfha,
      staticBfe: normalizeBfe(attrs.STATIC_BFE),
      lenUnit: attrs.LEN_UNIT || 'ft',
      firmPanel: null,
      panelType: null,
      description: ZONE_DESCRIPTIONS[zone] || attrs.ZONE_SUBTY || `Flood Zone ${zone}`,
      femaMapLink: mapLink,
      features: geojsonFeatures,
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
