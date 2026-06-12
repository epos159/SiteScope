const express = require('express');
const axios = require('axios');
const { COUNTIES } = require('../config/counties');

const router = express.Router();

const NOMINATIM_HEADERS = {
  'User-Agent': 'SiteScope/1.0 (support@poschventures.com)',
  Accept: 'application/json',
};

function escapeArcGIS(value) {
  return String(value).replace(/'/g, "''");
}

async function suggestYorkAddresses(query) {
  const endpoint = COUNTIES.york.parcelEndpoint;
  const raw = query.toUpperCase().trim();
  if (raw.length < 3) return [];

  // Match leading "<number> <street>" so suggestions stay address-like.
  const m = raw.match(/^(\d+)\s+(.*)$/);
  let where;
  if (m && m[2].length >= 1) {
    where = `SITE_ST_NO = ${parseInt(m[1], 10)} AND UPPER(SITE_ST_NAME) LIKE '%${escapeArcGIS(m[2])}%'`;
  } else {
    where = `UPPER(PROPADR) LIKE '%${escapeArcGIS(raw)}%'`;
  }

  const response = await axios.get(endpoint, {
    params: {
      where,
      outFields: 'PROPADR,MAIL_ADDR3',
      returnGeometry: false,
      resultRecordCount: 25,
      orderByFields: 'PROPADR',
      f: 'json',
    },
    timeout: 12000,
  });

  const seen = new Set();
  const results = [];
  for (const feature of response.data?.features || []) {
    const propadr = feature.attributes?.PROPADR;
    if (!propadr) continue;
    // MAIL_ADDR3 looks like "DOVER PA 17315"; append the town for clarity.
    const cityState = feature.attributes?.MAIL_ADDR3 || '';
    const town = cityState.replace(/\s+PA\s+\d{5}.*$/i, '').trim();
    const address = town ? `${propadr}, ${town}, PA` : propadr;
    const key = address.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ address, source: 'york' });
    if (results.length >= 8) break;
  }
  return results;
}

function formatNominatimAddress(item) {
  const addr = item.address || {};
  const houseNumber = addr.house_number || '';
  const road = addr.road || addr.pedestrian || addr.footway || '';
  const streetLine = [houseNumber, road].filter(Boolean).join(' ').trim();

  const city =
    addr.city ||
    addr.town ||
    addr.village ||
    addr.hamlet ||
    addr.municipality ||
    addr.county ||
    '';

  const state = addr.state === 'Pennsylvania' ? 'PA' : addr.state || 'PA';

  if (streetLine && city) {
    return `${streetLine}, ${city}, ${state}`;
  }
  if (streetLine) {
    return `${streetLine}, ${state}`;
  }

  // Fallback: display_name uses "3400, Fox Run Rd, ..." — strip comma after house number.
  const parts = String(item.display_name || '')
    .split(',')
    .map(p => p.trim())
    .filter(Boolean)
    .slice(0, 3);
  if (parts.length >= 2 && /^\d+[A-Z]?$/i.test(parts[0])) {
    parts[0] = `${parts[0]} ${parts[1]}`;
    parts.splice(1, 1);
  }
  return parts.join(', ');
}

async function suggestNominatim(query) {
  const response = await axios.get('https://nominatim.openstreetmap.org/search', {
    params: {
      q: `${query}, Pennsylvania`,
      format: 'json',
      addressdetails: 1,
      limit: 6,
      countrycodes: 'us',
    },
    headers: NOMINATIM_HEADERS,
    timeout: 10000,
  });

  return (response.data || [])
    .map(item => ({
      address: formatNominatimAddress(item),
      source: 'nominatim',
    }))
    .filter(item => item.address.length > 0);
}

router.get('/', async (req, res) => {
  const { q } = req.query;
  const query = String(q || '').trim();

  if (query.length < 3) {
    return res.json({ suggestions: [] });
  }

  try {
    let suggestions = [];

    try {
      suggestions = await suggestYorkAddresses(query);
    } catch (err) {
      console.warn('[addressSuggest] york failed:', err.message);
    }

    if (suggestions.length < 4) {
      try {
        const nominatim = await suggestNominatim(query);
        const seen = new Set(suggestions.map(s => s.address.toUpperCase()));
        for (const item of nominatim) {
          const key = item.address.toUpperCase();
          if (seen.has(key)) continue;
          seen.add(key);
          suggestions.push(item);
          if (suggestions.length >= 8) break;
        }
      } catch (err) {
        console.warn('[addressSuggest] nominatim failed:', err.message);
      }
    }

    return res.json({ suggestions: suggestions.slice(0, 8) });
  } catch (err) {
    console.error('[addressSuggest] error:', err.message);
    return res.json({ suggestions: [] });
  }
});

module.exports = router;
