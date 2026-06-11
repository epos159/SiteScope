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
  const endpoint = COUNTIES.york.addressPointEndpoint;
  const token = escapeArcGIS(query.toUpperCase().trim());
  if (token.length < 3) return [];

  const where = [
    `UPPER(ADDRESS) LIKE '%${token}%'`,
    `UPPER(WHOLE_NAME) LIKE '%${token}%'`,
    `UPPER(NAME) LIKE '%${token}%'`,
  ].join(' OR ');

  const response = await axios.get(endpoint, {
    params: {
      where,
      outFields: 'ADDRESS',
      returnGeometry: false,
      resultRecordCount: 10,
      orderByFields: 'ADDRESS',
      f: 'json',
    },
    timeout: 12000,
  });

  const seen = new Set();
  const results = [];
  for (const feature of response.data?.features || []) {
    const address = feature.attributes?.ADDRESS;
    if (!address || seen.has(address)) continue;
    seen.add(address);
    results.push({ address, source: 'york' });
    if (results.length >= 8) break;
  }
  return results;
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

  return (response.data || []).map(item => ({
    address: item.display_name.split(',').slice(0, 3).join(', '),
    source: 'nominatim',
  }));
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
