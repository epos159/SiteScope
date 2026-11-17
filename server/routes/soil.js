const express = require('express');
const axios = require('axios');
const {
  geojsonToWkt,
  pointToBufferWkt,
  getBoundingBox,
  bboxToWkt,
} = require('../utils/geoUtils');
const { lookupSoil } = require('../services/soilFallback');

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

function pointBox(lat, lng, bufferDeg) {
  return { minLng: lng - bufferDeg, maxLng: lng + bufferDeg, minLat: lat - bufferDeg, maxLat: lat + bufferDeg };
}

function buildSoilAoiCandidates(lat, lng, geometry) {
  const latF = parseFloat(lat);
  const lngF = parseFloat(lng);
  const candidates = [];

  candidates.push({ wkt: pointToBufferWkt(latF, lngF, 0.001), method: 'point-buffer', box: pointBox(latF, lngF, 0.001) });

  if (geometry) {
    try {
      const bbox = getBoundingBox(geometry);
      const box = {
        minLng: bbox.minLng - 0.0001,
        maxLng: bbox.maxLng + 0.0001,
        minLat: bbox.minLat - 0.0001,
        maxLat: bbox.maxLat + 0.0001,
      };
      candidates.push({ wkt: bboxToWkt(bbox, 0.0001), method: 'bbox', box });
    } catch {
      // ignore
    }

    if (geometry.type === 'Polygon' && countVertices(geometry) <= 80) {
      const wkt = geojsonToWkt(geometry);
      if (wkt) candidates.push({ wkt, method: 'parcel-polygon' });
    }
  }

  candidates.push({ wkt: pointToBufferWkt(latF, lngF, 0.003), method: 'point-buffer-wide', box: pointBox(latF, lngF, 0.003) });

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
  const response = await axios.post(
    SDM_ENDPOINT,
    { query, format: 'JSON+COLUMNNAME' },
    {
      headers: { 'Content-Type': 'application/json' },
      timeout: 30000,
    }
  );
  return response.data;
}

function rowToMapUnit(row) {
  return {
    mukey: row.mukey,
    symbol: row.musym,
    name: row.muname,
    componentPct: row.comppct_r != null ? parseFloat(row.comppct_r) : null,
    slopeMin: row.slope_l != null ? parseFloat(row.slope_l) : null,
    slopeTypical: row.slope_r != null ? parseFloat(row.slope_r) : null,
    slopeMax: row.slope_h != null ? parseFloat(row.slope_h) : null,
    slopeClass: slopeToClass(row.slope_r ?? row.slope_h),
    drainage: row.drainagecl || null,
    hydrologicGroup: row.hydgrp || null,
    hydric: row.hydricrating === 'Yes',
    taxOrder: row.taxorder || null,
    taxSubgroup: row.taxsubgrp || null,
  };
}

function parseSoilTable(table) {
  if (!table || table.length < 2) return [];

  const [headers, ...rows] = table;
  return rows.map(row => rowToMapUnit(Object.fromEntries(headers.map((h, i) => [h.toLowerCase(), row[i]]))));
}

// Timeouts, network failures and 5xx mean SDA itself is down; 4xx is specific to that AOI.
function isServiceFailure(err) {
  const status = err.response?.status;
  return !status || status >= 500;
}

function formatVersionDate(value) {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(value || '');
  return match ? `${match[1]}/${match[2]}/${match[3]}` : null;
}

function fallbackResponse(candidates) {
  let result;
  try {
    result = lookupSoil(candidates.filter(c => c.box));
  } catch (err) {
    console.error('[soil] local fallback failed:', err.message);
    return null;
  }
  if (!result) return null;

  const versions = [...new Set(result.surveyAreas.map(s => formatVersionDate(s.versionDate)).filter(Boolean))];
  return {
    mapUnits: result.rows.map(rowToMapUnit),
    queryMethod: result.method,
    source: `USDA NRCS SSURGO (SiteScope backup copy${versions.length ? `, survey version ${versions.join(', ')}` : ''})`,
    notice: 'USDA’s live soil service is unavailable, so this comes from SiteScope’s backup copy of the same USDA survey.',
    fallback: true,
  };
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
      const detail = err.response?.data ? JSON.stringify(err.response.data).slice(0, 200) : err.message;
      console.warn(`[soil] ${candidate.method} failed:`, detail);
      if (isServiceFailure(err)) break;
    }
  }

  if (lastError) {
    const fallback = fallbackResponse(candidates);
    if (fallback) {
      console.warn(`[soil] served ${fallback.mapUnits.length} map units from local fallback`);
      return res.json(fallback);
    }
    console.error('[soil] all queries failed');
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
