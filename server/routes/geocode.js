const express = require('express');
const axios = require('axios');
const { resolveCountyKey } = require('../config/counties');

const router = express.Router();

router.get('/', async (req, res) => {
  const { address } = req.query;

  if (!address) {
    return res.status(400).json({ error: 'address parameter is required' });
  }

  try {
    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: `${address}, Pennsylvania`,
        format: 'json',
        addressdetails: 1,
        limit: 1,
        countrycodes: 'us',
      },
      headers: {
        'User-Agent': 'SiteScope/1.0 (support@poschventures.com)',
        Accept: 'application/json',
      },
      timeout: 10000,
    });

    if (!response.data || response.data.length === 0) {
      return res.status(404).json({ error: 'Address not found. Try adding a city or ZIP code.' });
    }

    const result = response.data[0];
    const addr = result.address || {};
    const countyRaw = addr.county || '';
    const countyKey = resolveCountyKey(countyRaw);

    return res.json({
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      displayName: result.display_name,
      county: countyRaw,
      countyKey,
      state: addr.state || '',
      municipality: addr.city || addr.town || addr.village || addr.suburb || '',
    });
  } catch (err) {
    console.error('[geocode] error:', err.message);
    return res.status(500).json({ error: 'Geocoding service unavailable. Please try again.' });
  }
});

module.exports = router;
