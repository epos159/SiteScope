const express = require('express');
const axios = require('axios');

const router = express.Router();

const FEMA_ENDPOINT =
  'https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query';

const ZONE_DESCRIPTIONS = {
  A: '1% Annual Chance Flood (No BFE Determined)',
  AE: '1% Annual Chance Flood with Base Flood Elevations',
  AH: '1% Annual Chance Shallow Flooding — Ponding',
  AO: '1% Annual Chance Shallow Flooding — Sheet Flow',
  AR: 'Special Flood Hazard Area — Federal Restoration Project',
  A99: '1% Flood Hazard Protected by Certified Levee',
  VE: 'Coastal High Hazard Area with Base Flood Elevations',
  V: 'Coastal High Hazard Area (No BFE Determined)',
  X: 'Area of Minimal Flood Hazard (0.2% Annual Chance)',
  D: 'Possible Flood Hazard — Undetermined',
};

router.get('/', async (req, res) => {
  const { lat, lng } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  try {
    const response = await axios.get(FEMA_ENDPOINT, {
      params: {
        geometry: JSON.stringify({ x: parseFloat(lng), y: parseFloat(lat) }),
        geometryType: 'esriGeometryPoint',
        spatialRel: 'esriSpatialRelIntersects',
        outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE,LEN_UNIT,FIRM_PAN,PANEL_TYP',
        returnGeometry: true,
        f: 'geojson',
        inSR: 4326,
        outSR: 4326,
      },
      timeout: 15000,
    });

    const data = response.data;

    if (!data.features || data.features.length === 0) {
      return res.json({
        zone: 'X',
        description: 'Area of Minimal Flood Hazard — No FEMA features found at this point.',
        sfha: false,
        firmPanel: null,
        features: [],
      });
    }

    const props = data.features[0].properties || {};
    const zone = props.FLD_ZONE || 'Unknown';
    const sfha = props.SFHA_TF === 'T' || props.SFHA_TF === true;

    // Build FEMA map link from FIRM panel number
    let femaMapLink = null;
    if (props.FIRM_PAN) {
      const panelClean = props.FIRM_PAN.replace(/\s/g, '');
      femaMapLink = `https://msc.fema.gov/portal/search?AddressQuery=${encodeURIComponent(`${lat},${lng}`)}`;
    }

    return res.json({
      zone,
      zoneSubtype: props.ZONE_SUBTY || null,
      sfha,
      staticBfe: props.STATIC_BFE || null,
      lenUnit: props.LEN_UNIT || null,
      firmPanel: props.FIRM_PAN || null,
      panelType: props.PANEL_TYP || null,
      description: ZONE_DESCRIPTIONS[zone] || `Flood Zone ${zone}`,
      femaMapLink,
      features: data.features,
    });
  } catch (err) {
    console.error('[flood] error:', err.message);
    return res.json({
      error: true,
      message: 'FEMA flood zone data could not be retrieved.',
      zone: null,
      features: [],
    });
  }
});

module.exports = router;
