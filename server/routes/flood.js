const express = require('express');
const axios = require('axios');

const router = express.Router();

const FEMA_ENDPOINT =
  'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';

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

/**
 * Convert Esri JSON feature to a GeoJSON-compatible feature.
 * FEMA returns rings in [ [x, y], ... ] format (already WGS84 if outSR=4326).
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

router.get('/', async (req, res) => {
  const { lat, lng } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);

  try {
    const response = await axios.get(FEMA_ENDPOINT, {
      params: {
        geometry: JSON.stringify({ x: lngF, y: latF }),
        geometryType: 'esriGeometryPoint',
        inSR: 4326,
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,LEN_UNIT,FIRM_PAN,PANEL_TYP',
        returnGeometry: true,
        outSR: 4326,
        f: 'json',
      },
      timeout: 45000,
    });

    const data = response.data;

    if (data.error) {
      console.error('[flood] API error:', data.error);
      return res.json({
        error: true,
        message: `FEMA API error: ${data.error.message || 'Unknown error'}`,
        zone: null,
        features: [],
      });
    }

    if (!data.features || data.features.length === 0) {
      return res.json({
        zone: 'X',
        description: 'Area of Minimal Flood Hazard — No FEMA flood hazard features found at this point.',
        sfha: false,
        firmPanel: null,
        femaMapLink: `https://msc.fema.gov/portal/search?AddressQuery=${encodeURIComponent(`${latF},${lngF}`)}`,
        features: [],
      });
    }

    const attrs = data.features[0].attributes || {};
    const zone = attrs.FLD_ZONE || 'Unknown';
    const sfha = attrs.SFHA_TF === 'T' || attrs.SFHA_TF === true;

    const femaMapLink = `https://msc.fema.gov/portal/search?AddressQuery=${encodeURIComponent(`${latF},${lngF}`)}`;

    const geojsonFeatures = data.features
      .map(esriToGeoJSON)
      .filter(Boolean);

    return res.json({
      zone,
      zoneSubtype: attrs.ZONE_SUBTY || null,
      sfha,
      staticBfe: attrs.STATIC_BFE || null,
      lenUnit: attrs.LEN_UNIT || null,
      firmPanel: attrs.FIRM_PAN || null,
      panelType: attrs.PANEL_TYP || null,
      description: ZONE_DESCRIPTIONS[zone] || `Flood Zone ${zone}`,
      femaMapLink,
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
    });
  }
});

module.exports = router;
