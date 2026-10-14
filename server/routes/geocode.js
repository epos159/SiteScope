const express = require('express');
const axios = require('axios');
const { resolveCountyKey, inferCountyKeyFromCoords } = require('../config/counties');
const { parseSearchAddress } = require('../utils/addressUtils');
const { searchCountyAddresses, hasLocality } = require('../services/countyAddressSearch');

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
  const countyBase = counties[0]?.NAME || '';
  const countyName =
    countyBase && !/county/i.test(countyBase) ? `${countyBase} County` : countyBase;

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

function formatMatchLabel(match) {
  return [match.address, match.municipality, match.countyName, 'PA'].filter(Boolean).join(', ');
}

function toAlternatives(matches) {
  return matches.slice(0, 4).map(m => ({
    label: formatMatchLabel(m),
    address: m.address,
    municipality: m.municipality,
    countyName: m.countyName,
    countyKey: m.countyKey,
    parcelId: m.parcelId,
    lat: m.lat,
    lng: m.lng,
  }));
}

/** Census point within ~5 km of a county match is a reliable tiebreaker. */
const TIEBREAK_MAX_DEG = 0.05;

function pickCountyMatch(matches, censusPoint) {
  const top = matches[0];
  const contenders = matches.filter(m => m.score >= top.score - 5);
  if (contenders.length < 2 || !censusPoint) return top;

  let best = null;
  let bestDist = Infinity;
  for (const m of contenders) {
    const dist = Math.hypot(m.lat - censusPoint.lat, m.lng - censusPoint.lng);
    if (dist < bestDist) {
      bestDist = dist;
      best = m;
    }
  }
  return bestDist <= TIEBREAK_MAX_DEG ? best : top;
}

/**
 * ~5 km. Census places a real address within a few hundred meters, so a postal-city
 * vs. municipality mismatch ("Hanover" for Conewago Twp) still lands well inside this.
 */
const CONTRADICT_MIN_DEG = 0.05;

/**
 * The user named a town/ZIP that no county match agrees with, and Census places the
 * address far from every match (e.g. "100 Grant St, Pittsburgh") — trust Census instead.
 */
function censusContradicts(matches, censusPoint, address) {
  if (!censusPoint || !hasLocality(address)) return false;
  if (matches.some(m => m.localityMatch)) return false;
  return matches.every(
    m => Math.hypot(m.lat - censusPoint.lat, m.lng - censusPoint.lng) > CONTRADICT_MIN_DEG
  );
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

    // County assessment records are authoritative; Census only breaks ties or fills gaps.
    const [countySettled, censusSettled] = await Promise.allSettled([
      searchCountyAddresses(address, { partial: false, limit: 6, timeout: 12000 }),
      censusGeocode(censusLine),
    ]);
    const countyMatches = countySettled.status === 'fulfilled' ? countySettled.value : [];
    const censusPoint = censusSettled.status === 'fulfilled' ? censusSettled.value : null;
    if (censusSettled.status === 'rejected') {
      console.warn('[geocode] census failed:', censusSettled.reason?.message);
    }

    if (countyMatches.length && !censusContradicts(countyMatches, censusPoint, address)) {
      const chosen = pickCountyMatch(countyMatches, censusPoint);
      return res.json({
        lat: chosen.lat,
        lng: chosen.lng,
        displayName: formatMatchLabel(chosen),
        searchedAddress: address.trim(),
        county: chosen.countyName,
        countyKey: chosen.countyKey,
        state: 'Pennsylvania',
        municipality: chosen.municipality || '',
        parcelId: chosen.parcelId,
        source: 'county',
        alternatives: toAlternatives(countyMatches.filter(m => m !== chosen)),
      });
    }

    let source = 'census';
    if (censusPoint) {
      result = {
        lat: censusPoint.lat,
        lon: censusPoint.lng,
        display_name: censusPoint.displayName,
        address: {
          county: censusPoint.county,
          city: censusPoint.municipality,
          state: 'Pennsylvania',
        },
      };
    }

    if (!result) source = 'nominatim';
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
    const lat = parseFloat(result.lat);
    const lng = parseFloat(result.lon);
    const countyKey = resolveCountyKey(countyRaw) || inferCountyKeyFromCoords(lat, lng);

    return res.json({
      lat,
      lng,
      displayName: result.display_name,
      searchedAddress: address.trim(),
      county: countyRaw,
      countyKey,
      state: addr.state || 'Pennsylvania',
      municipality: addr.city || addr.town || addr.village || addr.suburb || parsed.city || '',
      source,
      alternatives: toAlternatives(countyMatches),
    });
  } catch (err) {
    console.error('[geocode] error:', err.message);
    return res.status(500).json({ error: 'Geocoding service unavailable. Please try again.' });
  }
});

module.exports = router;
