const express = require('express');
const { searchCountyAddresses } = require('../services/countyAddressSearch');

const router = express.Router();

/**
 * Address autocomplete sourced from county assessment parcel records only, so
 * every suggestion is a real parcel that SiteScope can load exactly.
 */
router.get('/', async (req, res) => {
  const query = String(req.query.q || '').trim();

  if (query.length < 3) {
    return res.json({ suggestions: [] });
  }

  try {
    const matches = await searchCountyAddresses(query, { partial: true, limit: 8, timeout: 6000 });
    const suggestions = matches.map(match => ({
      address: match.address,
      detail: [match.municipality, match.countyName].filter(Boolean).join(', '),
      countyKey: match.countyKey,
      countyName: match.countyName,
      municipality: match.municipality,
      parcelId: match.parcelId,
      lat: match.lat,
      lng: match.lng,
    }));
    return res.json({ suggestions });
  } catch (err) {
    console.error('[addressSuggest] error:', err.message);
    return res.json({ suggestions: [] });
  }
});

module.exports = router;
