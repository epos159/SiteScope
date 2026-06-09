const express = require('express');
const axios = require('axios');
const {
  geojsonToWkt,
  pointToBufferWkt,
  getBoundingBox,
  bboxToWkt,
} = require('../utils/geoUtils');

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

function countVertices(geometry) {
  if (!geometry?.coordinates) return 0;
  let count = 0;
  function walk(coords) {
    if (typeof coords[0] === 'number') count += 1;
    else coords.forEach(walk);
  }
  walk(geometry.coordinates);
  return count;
}

/**
 * Build candidate WKT areas for soil lookup, ordered simplest-first.
 * SDA rejects complex MultiPolygons and very dense rings.
 */
function buildSoilAoiCandidates(lat, lng, geometry) {
  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);
  const candidates = [];

  candidates.push({ wkt: pointToBufferWkt(latF, lngF, 0.001), method: 'point-buffer' });

  if (geometry) {
    try {
      const bbox = getBoundingBox(geometry);
      candidates.push({ wkt: bboxToWkt(bbox, 0.0001), method: 'bbox' });
    } catch {
      // ignore
    }

    if (geometry.type === 'Polygon' && countVertices(geometry) <= 80) {
      const wkt = geojsonToWkt(geometry);
      if (wkt) candidates.push({ wkt, method: 'parcel-polygon' });
    }
  }

  candidates.push({ wkt: pointToBufferWkt(latF, lngF, 0.003), method: 'point-buffer-wide' });

  const seen = new Set();
  return candidates.filter(c => {
    if (seen.has(c.wkt)) return false;
    seen.add(c.wkt);
    return true;
  });
}

function buildSoilQuery(aoiWkt) {
  const safeWkt = aoiWkt.replace(/'/g, "''");
  return `
    SELECT DISTINCT
      mu.mukey, mu.musym, mu.muname,
      c.comppct_r, c.slope_l, c.slope_r, c.slope_h,
      c.drainagecl, c.hydgrp, c.hydricrating, c.taxorder, c.taxsubgrp
    FROM mapunit mu
    INNER JOIN component c ON mu.mukey = c.mukey
    WHERE mu.mukey IN (
      SELECT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('${safeWkt}')
    )
    AND c.majcompflag = 'Yes'
    ORDER BY c.comppct_r DESC
  `.trim();
}

async function querySoil(aoiWkt) {
  const query = buildSoilQuery(aoiWkt);
  const body = new URLSearchParams({
    query,
    format: 'JSON+COLUMNNAMES',
  });

  const response = await axios.post(SDM_ENDPOINT, body.toString(), {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    timeout: 60000,
  });

  return response.data;
}

function parseSoilTable(table) {
  if (!table || table.length < 2) return [];

  const [headers, ...rows] = table;
  return rows.map(row => {
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
      hydric: obj.hydricrating === 'Yes' || obj.hydric === 'Yes',
      taxOrder: obj.taxorder || null,
      taxSubgroup: obj.taxsubgrp || null,
    };
  });
}

router.get('/', async (req, res) => {
  const { lat, lng, geometry } = req.query;

  if (!lat || !lng) {
    return res.status(400).json({ error: 'lat and lng are required' });
  }

  let parsedGeometry = null;
  if (geometry) {
    try {
      parsedGeometry = JSON.parse(geometry);
    } catch {
      parsedGeometry = null;
    }
  }

  const candidates = buildSoilAoiCandidates(lat, lng, parsedGeometry);
  let lastError = null;

  for (const candidate of candidates) {
    try {
      const data = await querySoil(candidate.wkt);
      const mapUnits = parseSoilTable(data?.Table);

      if (mapUnits.length > 0) {
        return res.json({ mapUnits, queryMethod: candidate.method, source: 'USDA NRCS SSURGO' });
      }
    } catch (err) {
      lastError = err;
      console.warn(`[soil] ${candidate.method} failed:`, err.message);
    }
  }

  if (lastError) {
    console.error('[soil] all queries failed:', lastError.message);
    return res.json({
      error: true,
      message: 'NRCS soil data could not be retrieved. The USDA service may be temporarily unavailable.',
      mapUnits: [],
    });
  }

  return res.json({
    mapUnits: [],
    message: 'No soil map units found for this area.',
    source: 'USDA NRCS SSURGO',
  });
});

module.exports = router;
