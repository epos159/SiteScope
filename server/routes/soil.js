const express = require('express');
const axios = require('axios');
const { geojsonToWkt, pointToBufferWkt } = require('../utils/geoUtils');

const router = express.Router();

const SDM_ENDPOINT = 'https://SDMDataAccess.sc.egov.usda.gov/Tabular/post.rest';

function slopeToClass(slope) {
  if (slope == null) return null;
  const s = parseFloat(slope);
  if (s <= 3) return 'Nearly Level (0–3%)';
  if (s <= 8) return 'Gently Sloping (3–8%)';
  if (s <= 15) return 'Moderately Sloping (8–15%)';
  if (s <= 25) return 'Strongly Sloping (15–25%)';
  if (s <= 45) return 'Steep (25–45%)';
  return 'Very Steep (>45%)';
}

router.get('/', async (req, res) => {
  const { lat, lng, geometry } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  let aoi = null;
  if (geometry) {
    try {
      aoi = geojsonToWkt(JSON.parse(geometry));
    } catch {
      aoi = null;
    }
  }
  if (!aoi) {
    aoi = pointToBufferWkt(parseFloat(lat), parseFloat(lng), 0.002);
  }

  const query = `
    SELECT DISTINCT
      mu.mukey, mu.musym, mu.muname,
      c.comppct_r, c.slope_l, c.slope_r, c.slope_h,
      c.drainagecl, c.hydgrp, c.hydric, c.taxorder, c.taxsubgrp
    FROM mapunit mu
    JOIN component c ON mu.mukey = c.mukey
    WHERE mu.mukey IN (
      SELECT * FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('${aoi}')
    )
    AND c.majcompflag = 'Yes'
    ORDER BY c.comppct_r DESC
  `.trim();

  try {
    const response = await axios.post(
      SDM_ENDPOINT,
      { query, format: 'JSON+COLUMNNAMES' },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 45000,
      }
    );

    const table = response.data?.Table;
    if (!table || table.length < 2) {
      return res.json({ mapUnits: [], message: 'No soil data found for this area.' });
    }

    const [headers, ...rows] = table;
    const mapUnits = rows.map(row => {
      const obj = Object.fromEntries(headers.map((h, i) => [h.toLowerCase(), row[i]]));
      return {
        mukey: obj.mukey,
        symbol: obj.musym,
        name: obj.muname,
        componentPct: obj.comppct_r != null ? parseFloat(obj.comppct_r) : null,
        slopeMin: obj.slope_l != null ? parseFloat(obj.slope_l) : null,
        slopeTypical: obj.slope_r != null ? parseFloat(obj.slope_r) : null,
        slopeMax: obj.slope_h != null ? parseFloat(obj.slope_h) : null,
        slopeClass: slopeToClass(obj.slope_r ?? obj.slope_h),
        drainage: obj.drainagecl || null,
        hydrologicGroup: obj.hydgrp || null,
        hydric: obj.hydric === 'Yes',
        taxOrder: obj.taxorder || null,
        taxSubgroup: obj.taxsubgrp || null,
      };
    });

    return res.json({ mapUnits });
  } catch (err) {
    console.error('[soil] error:', err.message);
    return res.json({
      error: true,
      message: 'NRCS soil data could not be retrieved.',
      mapUnits: [],
    });
  }
});

module.exports = router;
