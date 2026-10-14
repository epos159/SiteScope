/**
 * Address search against the county assessment parcel layers themselves.
 *
 * County records are the authoritative source for a property's address, so a
 * typed address is matched here first; outside geocoders are only a fallback.
 */
const { COUNTIES } = require('../config/counties');
const { getGeometryCentroid } = require('../utils/geoUtils');
const { queryArcGIS, normalizeParcelProps, escapeArcGIS } = require('./parcelRecords');

const SUFFIXES = {
  ALLEY: 'ALY', ALY: 'ALY',
  AVENUE: 'AVE', AVE: 'AVE', AV: 'AVE',
  BOULEVARD: 'BLVD', BLVD: 'BLVD',
  CIRCLE: 'CIR', CIR: 'CIR',
  COURT: 'CT', CT: 'CT',
  DRIVE: 'DR', DR: 'DR',
  HIGHWAY: 'HWY', HWY: 'HWY',
  LANE: 'LN', LN: 'LN',
  PARKWAY: 'PKWY', PKWY: 'PKWY',
  PIKE: 'PIKE', PK: 'PIKE',
  PLACE: 'PL', PL: 'PL',
  ROAD: 'RD', RD: 'RD',
  STREET: 'ST', ST: 'ST',
  TERRACE: 'TER', TER: 'TER',
  TRAIL: 'TRL', TRL: 'TRL',
  WAY: 'WAY',
};

const DIRECTIONS = {
  N: 'N', NORTH: 'N', S: 'S', SOUTH: 'S', E: 'E', EAST: 'E', W: 'W', WEST: 'W',
  NE: 'NE', NORTHEAST: 'NE', NW: 'NW', NORTHWEST: 'NW',
  SE: 'SE', SOUTHEAST: 'SE', SW: 'SW', SOUTHWEST: 'SW',
};

const ORDINALS = {
  FIRST: '1ST', SECOND: '2ND', THIRD: '3RD', FOURTH: '4TH', FIFTH: '5TH',
  SIXTH: '6TH', SEVENTH: '7TH', EIGHTH: '8TH', NINTH: '9TH', TENTH: '10TH',
};
const ORDINAL_WORDS = Object.fromEntries(Object.entries(ORDINALS).map(([w, n]) => [n, w]));

const UNIT_WORDS = new Set(['UNIT', 'APT', 'STE', 'SUITE', 'LOT', 'CONDO', 'BLDG', 'REAR']);

// Below this, a typed address disagrees with the record (e.g. "100 Grant St" vs "100 PENN GRANT RD").
const MIN_FULL_MATCH_SCORE = 50;

const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 300;
const cache = new Map();

function tokenize(text) {
  return String(text || '')
    .toUpperCase()
    .replace(/[.,#]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Split "<number> [dir] <street words> [suffix]" into comparable parts.
 * Works for both user input and county site-address strings.
 */
function parseStreet(text, { partial = false } = {}) {
  let tokens = tokenize(text);
  const numMatch = tokens[0]?.match(/^(\d+)([A-Z])?(?:-\d+)?$/);
  if (!numMatch) return null;
  const number = numMatch[1];
  const numberLetter = numMatch[2] || null;
  tokens = tokens.slice(1);

  // Drop unit / lot designators ("L-0004", "L2", "UNIT 5", "CONDO").
  const cut = tokens.findIndex(
    (t, i) => i > 0 && (UNIT_WORDS.has(t) || /^[A-Z]{1,2}-?\d+$/.test(t))
  );
  if (cut >= 0) tokens = tokens.slice(0, cut);

  tokens = tokens.map(t => ORDINALS[t] || t);

  let dir = null;
  // A leading direction only counts when real street words follow ("N 3RD ST", not "NORTH ST").
  if (tokens.length >= 2 && DIRECTIONS[tokens[0]] && !SUFFIXES[tokens[1]]) {
    dir = DIRECTIONS[tokens[0]];
    tokens = tokens.slice(1);
  }

  let suffix = null;
  const last = tokens[tokens.length - 1];
  if (tokens.length >= 2 && SUFFIXES[last] && !(partial && last.length < 2)) {
    suffix = SUFFIXES[last];
    tokens = tokens.slice(0, -1);
  }

  return { number, numberLetter, dir, core: tokens, suffix };
}

function parseQuery(input, partial) {
  const parts = String(input || '').split(',').map(p => p.trim()).filter(Boolean);
  const street = parseStreet(parts[0] || '', { partial });
  if (!street || !street.core.length) return null;

  const rest = parts.slice(1).join(' ');
  const zipMatch = rest.match(/\b(\d{5})(?:-\d{4})?\b/) || String(input).match(/\b(\d{5})(?:-\d{4})?\s*$/);
  const cityTokens = tokenize(rest.replace(/\b\d{5}(?:-\d{4})?\b/g, ''))
    .filter(t => t !== 'PA' && t !== 'PENNSYLVANIA' && t.length > 2);

  return { ...street, partial, zip: zipMatch ? zipMatch[1] : null, cityTokens };
}

function pickSearchToken(core, partial) {
  const complete = partial && core.length > 1 ? core.slice(0, -1) : core;
  const pool = complete.length ? complete : core;
  return [...pool].sort((a, b) => b.length - a.length)[0];
}

function likeAny(field, token) {
  const variants = [token];
  if (ORDINAL_WORDS[token]) variants.push(ORDINAL_WORDS[token]);
  const clauses = variants.map(v => `UPPER(${field}) LIKE '%${escapeArcGIS(v)}%'`);
  return clauses.length > 1 ? `(${clauses.join(' OR ')})` : clauses[0];
}

function buildWhere(county, query) {
  const search = county.addressSearch || {};
  const token = pickSearchToken(query.core, query.partial);
  if (!token) return null;

  const numbers = [query.number];
  if (query.numberLetter) numbers.push(`${query.number}${query.numberLetter}`);

  if (search.streetNumber && search.streetName) {
    const numExpr = search.streetNumberIsString
      ? `${search.streetNumber} IN (${numbers.map(n => `'${escapeArcGIS(n)}'`).join(', ')})`
      : `${search.streetNumber} = ${parseInt(query.number, 10)}`;
    return `${numExpr} AND ${likeAny(search.streetName, token)}`;
  }

  if (search.siteAddress) {
    const field = search.siteAddress;
    const numExpr = numbers.map(n => `UPPER(${field}) LIKE '${escapeArcGIS(n)} %'`).join(' OR ');
    return `(${numExpr}) AND ${likeAny(field, token)}`;
  }

  return null;
}

/** Site address as stored by the county, built from structured parts when available. */
function candidateStreetText(props, county) {
  const search = county.addressSearch || {};
  if (search.streetNumber && search.streetName) {
    const parts = [search.streetNumber, search.streetDir, search.streetName, search.streetSuffix]
      .map(f => (f ? props[f] : null))
      .filter(v => v != null && String(v).trim() && String(v).trim() !== '0');
    return parts.join(' ');
  }
  return props[search.siteAddress] || '';
}

function scoreCandidate(query, candidate, municipality, props) {
  if (!candidate || candidate.number !== query.number) return null;

  const candidateTokens = [...candidate.core, ...(candidate.suffix ? [candidate.suffix] : [])];
  let score = 50;

  for (let i = 0; i < query.core.length; i += 1) {
    const token = query.core[i];
    const isLast = i === query.core.length - 1;
    const exact = candidateTokens.includes(token);
    const prefix =
      query.partial &&
      isLast &&
      (candidateTokens.some(t => t.startsWith(token)) ||
        (candidate.suffix &&
          Object.entries(SUFFIXES).some(([word, abbr]) => abbr === candidate.suffix && word.startsWith(token))));
    if (!exact && !prefix) return null;
    score += exact ? 6 : 3;
  }

  const extra = candidate.core.filter(t => !query.core.includes(t)).length;
  if (!query.partial) score -= extra * 4;

  // "3010A" and "3010" are different parcels.
  if (query.numberLetter || candidate.numberLetter) {
    score += query.numberLetter === candidate.numberLetter ? 6 : -6;
  }

  if (query.dir && candidate.dir) {
    if (query.dir !== candidate.dir) return null;
    score += 10;
  } else if (query.dir) {
    score -= 5;
  } else if (candidate.dir) {
    score -= 2;
  }

  if (query.suffix && candidate.suffix) {
    score += query.suffix === candidate.suffix ? 8 : -8;
  }

  let localityMatch = false;
  if (query.cityTokens.length && municipality) {
    const muni = municipality.toUpperCase();
    if (query.cityTokens.some(t => muni.includes(t))) {
      score += 20;
      localityMatch = true;
    }
  }

  if (query.zip && Object.values(props).some(v => typeof v === 'string' && v.includes(query.zip))) {
    score += 15;
    localityMatch = true;
  }

  return { score, localityMatch };
}

async function searchCounty(countyKey, query, timeout) {
  const county = COUNTIES[countyKey];
  const where = buildWhere(county, query);
  if (!where) return [];

  const data = await queryArcGIS(
    county.parcelEndpoint,
    { where, outFields: '*', returnGeometry: true, resultRecordCount: 25 },
    timeout
  );

  const results = [];
  for (const feature of data.features || []) {
    const props = feature.properties || {};
    const normalized = normalizeParcelProps(props, county, county.fields);
    const streetText = candidateStreetText(props, county);
    const scored = scoreCandidate(query, parseStreet(streetText), normalized.municipality, props);
    if (!scored || !normalized.parcelId) continue;
    if (!query.partial && scored.score < MIN_FULL_MATCH_SCORE) continue;

    const centroid = getGeometryCentroid(feature.geometry);
    if (!centroid) continue;

    results.push({
      countyKey,
      countyName: county.name,
      parcelId: String(normalized.parcelId),
      address: (streetText || normalized.siteAddress || '').replace(/\s+/g, ' ').trim(),
      municipality: normalized.municipality || null,
      lat: centroid.lat,
      lng: centroid.lng,
      score: scored.score,
      localityMatch: scored.localityMatch,
    });
  }
  return results;
}

/**
 * Search every supported county for parcels whose site address matches the input.
 * Returns matches sorted best-first: { countyKey, countyName, parcelId, address, municipality, lat, lng, score }.
 */
async function searchCountyAddresses(input, { partial = false, limit = 8, timeout = 10000 } = {}) {
  const query = parseQuery(input, partial);
  if (!query) return [];

  const cacheKey = `${partial ? 'p' : 'f'}|${String(input).toUpperCase().replace(/\s+/g, ' ').trim()}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.results.slice(0, limit);

  const settled = await Promise.allSettled(
    Object.keys(COUNTIES).map(key => searchCounty(key, query, timeout))
  );

  let failed = false;
  const seen = new Set();
  const results = [];
  settled.forEach((outcome, i) => {
    if (outcome.status !== 'fulfilled') {
      failed = true;
      console.warn(`[countyAddressSearch] ${Object.keys(COUNTIES)[i]} failed:`, outcome.reason?.message);
      return;
    }
    for (const match of outcome.value) {
      const key = `${match.countyKey}|${match.parcelId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(match);
    }
  });

  results.sort((a, b) => b.score - a.score || a.address.length - b.address.length);

  // Don't cache partial failures — a county may just be slow right now.
  if (!failed) {
    if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value);
    cache.set(cacheKey, { at: Date.now(), results });
  }

  return results.slice(0, limit);
}

/** True when the user typed a town or ZIP after the street. */
function hasLocality(input) {
  const query = parseQuery(input, false);
  return Boolean(query && (query.zip || query.cityTokens.length));
}

module.exports = { searchCountyAddresses, parseStreet, parseQuery, hasLocality };
