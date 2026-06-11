const express = require('express');
const axios = require('axios');
const { resolveCountyKey } = require('../config/counties');
const { parseSearchAddress } = require('../utils/addressUtils');

const router = express.Router();

const NOMINATIM_HEADERS = {
  'User-Agent': 'SiteScope/1.0 (support@poschventures.com)',
  Accept: 'application/json',
};

async function censusGeocode(address) {
  const response = await axios.get(
    'https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress',
    {
      params: {
        address,
        benchmark: 'Public_AR_Current',
        vintage: 'Current_Current',
        format: 'json',
      },
      timeout: 12000,
    }
  );

  const match = response.data?.result?.addressMatches?.[0];
  if (!match?.coordinates) return null;

  const counties = match.geographies?.Counties || [];
  const countyName = counties[0]?.NAME ? `${counties[0].NAME} County` : '';

  return {
    lat: match.coordinates.y,
    lng: match.coordinates.x,
    displayName: match.matchedAddress || address,
    county: countyName,
    municipality: match.addressComponents?.city || '',
  };
}

async function nominatimSearch(params) {
  const response = await axios.get('https://nominatim.openstreetmap.org/search', {
    params: { format: 'json', addressdetails: 1, limit: 1, countrycodes: 'us', ...params },
    headers: NOMINATIM_HEADERS,
    timeout: 10000,
  });
  return response.data?.[0] || null;
}

router.get('/', async (req, res) => {
  const { address } = req.query;

  if (!address) {
    return res.status(400).json({ error: 'address parameter is required' });
  }

  try {
    const parsed = parseSearchAddress(address);
    let result = null;

    // Census geocoder is more reliable for Pennsylvania street addresses.
    const censusLine = parsed.streetLine
      ? `${parsed.streetLine}${parsed.city ? `, ${parsed.city}` : ''}, PA${parsed.zip ? ` ${parsed.zip}` : ''}`
      : `${address.trim()}, Pennsylvania`;

    try {
      const census = await censusGeocode(censusLine);
      if (census) {
        result = {
          lat: census.lat,
          lon: census.lng,
          display_name: census.displayName,
          address: {
            county: census.county,
            city: census.municipality,
            state: 'Pennsylvania',
          },
        };
      }
    } catch (err) {
      console.warn('[geocode] census failed:', err.message);
    }

    if (!result && parsed.streetNumber && parsed.streetLine) {
      result = await nominatimSearch({
        street: parsed.streetLine,
        city: parsed.city || undefined,
        state: 'Pennsylvania',
        postalcode: parsed.zip || undefined,
        country: 'us',
      });
    }

    if (!result) {
      result = await nominatimSearch({ q: `${address}, Pennsylvania` });
    }

    if (!result) {
      return res.status(404).json({ error: 'Address not found. Try adding a city or ZIP code.' });
    }

    const addr = result.address || {};
    const countyRaw = addr.county || '';
    const countyKey = resolveCountyKey(countyRaw);

    return res.json({
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      displayName: result.display_name,
      searchedAddress: address.trim(),
      county: countyRaw,
      countyKey,
      state: addr.state || 'Pennsylvania',
      municipality: addr.city || addr.town || addr.village || addr.suburb || parsed.city || '',
    });
  } catch (err) {
    console.error('[geocode] error:', err.message);
    return res.status(500).json({ error: 'Geocoding service unavailable. Please try again.' });
  }
});

module.exports = router;
