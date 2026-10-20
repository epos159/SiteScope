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

const UNIT_WORDS = new Set([
  'UNIT', 'APT', 'APARTMENT', 'STE', 'SUITE', 'LOT', 'CONDO', 'BLDG', 'BUILDING', 'REAR', 'SPACE', 'SPC',
]);

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

/** "4", "5X", "S23", "A3", "B" — not a street word like AVE. */
function isUnitId(token) {
  return /^\d+[A-Z]{0,2}$/.test(token) || /^[A-Z]\d+[A-Z]{0,2}$/.test(token) || /^[A-Z]$/.test(token);
}

function normUnit(unit) {
  return String(unit || '').toUpperCase().replace(/^0+(?=\d)/, '');
}

/** Pull "UNIT 4" / "SUITE S23" out of the token list without dropping the street suffix after it. */
function pullUnit(tokens) {
  const idx = tokens.findIndex((t, i) => UNIT_WORDS.has(t) && isUnitId(tokens[i + 1] || ''));
  if (idx < 0) return { tokens, unit: null };
  return {
    unit: tokens[idx + 1],
    tokens: tokens.filter((_, i) => i !== idx && i !== idx + 1),
  };
}

function hasUnitPhrase(text) {
  const tokens = tokenize(text);
  return tokens.some((t, i) => UNIT_WORDS.has(t) && isUnitId(tokens[i + 1] || ''));
}

/**
 * Split "<number> [dir] <street words> [suffix] [unit]" into comparable parts.
 * Works for both user input and county site-address strings.
 * Unit ids are kept ("UNIT 4", "100-2") so condo units don't all score the same.
 */
function parseStreet(text, { partial = false } = {}) {
  let tokens = tokenize(text);
  const numMatch = tokens[0]?.match(/^(\d+)([A-Z])?(?:-([A-Z0-9]+))?$/);
  if (!numMatch) return null;
  const number = numMatch[1];
  let numberLetter = numMatch[2] || null;
  let unit = numMatch[3] ? normUnit(numMatch[3]) : null;
  tokens = tokens.slice(1);

  const extracted = pullUnit(tokens);
  if (extracted.unit) unit = normUnit(extracted.unit);
  tokens = extracted.tokens.map(t => ORDINALS[t] || t);

  // Lancaster stores a plaza building letter in the house-number field: "1786 D".
  if (!numberLetter && tokens.length >= 2 && /^[A-Z]$/.test(tokens[0]) && !DIRECTIONS[tokens[0]]) {
    numberLetter = tokens[0];
    tokens = tokens.slice(1);
  }

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

  return { number, numberLetter, dir, core: tokens, suffix, unit };
}

/** A plaza or condo with no house number: "Scott Plaza", "Northwood Unit 19". */
function parsePlace(text) {
  let tokens = tokenize(text).map(t => ORDINALS[t] || t);
  const extracted = pullUnit(tokens);
  tokens = extracted.tokens;
  if (tokens.length < 1) return null;
  if (tokens.length < 2 && !extracted.unit) return null;
  return {
    place: true,
    number: null,
    numberLetter: null,
    dir: null,
    core: tokens,
    suffix: null,
    unit: extracted.unit ? normUnit(extracted.unit) : null,
  };
}

function parseQuery(input, partial) {
  const parts = String(input || '').split(',').map(p => p.trim()).filter(Boolean);
  const street = parseStreet(parts[0] || '', { partial });
  const place = street?.core?.length ? null : parsePlace(parts[0] || '');
  const parsed = street?.core?.length ? { ...street, place: false } : place;
  if (!parsed || !parsed.core.length) return null;

  const rest = parts.slice(1).join(' ');
  const zipMatch = rest.match(/\b(\d{5})(?:-\d{4})?\b/) || String(input).match(/\b(\d{5})(?:-\d{4})?\s*$/);
  const cityTokens = tokenize(rest.replace(/\b\d{5}(?:-\d{4})?\b/g, ''))
    .filter(t => t !== 'PA' && t !== 'PENNSYLVANIA' && t.length > 2);

  return { ...parsed, partial, zip: zipMatch ? zipMatch[1] : null, cityTokens };
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

/** The unit lives in the address text, often with odd spacing ("UNIT  19", "UNIT 4 AVE"). */
function unitWhere(field, unit) {
  const u = escapeArcGIS(unit);
  const words = ['UNIT', 'APT', 'STE', 'SUITE', 'LOT', 'BLDG', 'CONDO', 'SPACE'];
  const parts = [];
  for (const word of words) {
    for (const gap of [' ', '  ']) {
      // Bound the id so unit 4 does not also match unit 41.
      parts.push(`UPPER(${field}) LIKE '%${word}${gap}${u}'`);
      parts.push(`UPPER(${field}) LIKE '%${word}${gap}${u} %'`);
    }
  }
  return `(${parts.join(' OR ')})`;
}

function addressField(search) {
  return search.siteAddress || search.streetName || null;
}

function buildWhere(county, query) {
  const search = county.addressSearch || {};
  const field = addressField(search);
  const unitClause = query.unit && field ? ` AND ${unitWhere(field, query.unit)}` : '';

  if (query.place) {
    if (!field) return null;
    const tokens = query.core.filter((t, i) => !query.partial || i < query.core.length - 1 || t.length >= 3);
    if (!tokens.length) return null;
    return `${tokens.map(t => likeAny(field, t)).join(' AND ')}${unitClause}`;
  }

  const token = pickSearchToken(query.core, query.partial);
  if (!token) return null;

  const numbers = [query.number];
  if (query.numberLetter) {
    numbers.push(`${query.number}${query.numberLetter}`);
    numbers.push(`${query.number} ${query.numberLetter}`);
  }
  if (query.unit) numbers.push(`${query.number}-${query.unit}`);

  if (search.streetNumber && search.streetName) {
    const quoted = numbers.map(n => `'${escapeArcGIS(n)}'`).join(', ');
    const numExpr = search.streetNumberIsString
      ? `(${search.streetNumber} IN (${quoted})${query.numberLetter ? '' : ` OR ${search.streetNumber} LIKE '${escapeArcGIS(query.number)} %'`})`
      : `${search.streetNumber} = ${parseInt(query.number, 10)}`;
    return `${numExpr} AND ${likeAny(search.streetName, token)}${unitClause}`;
  }

  if (search.siteAddress) {
    const numExpr = numbers.map(n => `UPPER(${search.siteAddress}) LIKE '${escapeArcGIS(n)} %'`).join(' OR ');
    return `(${numExpr}) AND ${likeAny(search.siteAddress, token)}${unitClause}`;
  }

  return null;
}

/** Site address as stored by the county. Prefer the full situs when it carries a unit the parts drop. */
function candidateStreetText(props, county) {
  const search = county.addressSearch || {};
  const full = search.siteAddress ? String(props[search.siteAddress] || '').replace(/\s+/g, ' ').trim() : '';
  let composed = '';
  if (search.streetNumber && search.streetName) {
    composed = [search.streetNumber, search.streetDir, search.streetName, search.streetSuffix]
      .map(f => (f ? props[f] : null))
      .filter(v => v != null && String(v).trim() && String(v).trim() !== '0')
      .join(' ');
  }
  if (full && hasUnitPhrase(full) && !hasUnitPhrase(composed)) return full;
  return composed || full;
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

  // "3010A" and "3010" are different parcels. A typed building letter must match.
  if (query.numberLetter && candidate.numberLetter && query.numberLetter !== candidate.numberLetter) {
    return null;
  }
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

  // A typed unit has to be that unit. "Unit 4" must not land on unit 1.
  if (query.unit) {
    if (!candidate.unit || normUnit(query.unit) !== normUnit(candidate.unit)) return null;
    score += 12;
  } else if (candidate.unit) {
    score -= 3;
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

/** Match a house-number-less place name against the full site address. */
function scorePlace(query, addressText, municipality, props) {
  const parsed = parseStreet(addressText) || parsePlace(addressText);
  if (!parsed) return null;
  const candidateTokens = new Set(tokenize(addressText).map(t => SUFFIXES[t] || ORDINALS[t] || t));
  parsed.core.forEach(t => candidateTokens.add(t));
  if (parsed.suffix) candidateTokens.add(parsed.suffix);

  let score = 40;
  for (let i = 0; i < query.core.length; i += 1) {
    const token = query.core[i];
    const norm = SUFFIXES[token] || token;
    const exact = candidateTokens.has(token) || candidateTokens.has(norm);
    const prefix = query.partial && i === query.core.length - 1 && [...candidateTokens].some(t => t.startsWith(token));
    if (!exact && !prefix) return null;
    score += exact ? 6 : 3;
  }

  if (query.unit) {
    if (!parsed.unit || normUnit(query.unit) !== normUnit(parsed.unit)) return null;
    score += 12;
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
    const scored = query.place
      ? scorePlace(query, streetText, normalized.municipality, props)
      : scoreCandidate(query, parseStreet(streetText), normalized.municipality, props);
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
  if (!results.length) {
    try {
      results.push(...await searchByAddressPoint(countyKey, county, query, timeout));
    } catch (err) {
      console.warn(`[countyAddressSearch] ${countyKey} address point lookup failed:`, err.message);
    }
  }
  return results;
}

const DIR_FULL = {
  N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST',
  NE: 'NORTHEAST', NW: 'NORTHWEST', SE: 'SOUTHEAST', SW: 'SOUTHWEST',
};

function wordsForSuffix(abbr) {
  const words = new Set([abbr]);
  for (const [word, mapped] of Object.entries(SUFFIXES)) {
    if (mapped === abbr) words.add(word);
  }
  return [...words];
}

/**
 * York (and any county with an address-point layer) stores plaza and range
 * addresses as points. "2519 S Queen St" is a point on the parcel whose situs
 * is only "2509 S Queen St".
 */
async function searchByAddressPoint(countyKey, county, query, timeout) {
  const cfg = county.addressPoints;
  if (!cfg || query.place || !query.number) return [];
  const token = pickSearchToken(query.core, query.partial);
  const number = parseInt(query.number, 10);
  if (!token || !number) return [];

  let where = `${cfg.number} = ${number} AND UPPER(${cfg.streetName}) LIKE '%${escapeArcGIS(token)}%'`;
  if (query.dir && cfg.streetDir) {
    const full = DIR_FULL[query.dir];
    where += ` AND (UPPER(${cfg.streetDir}) = '${query.dir}'${full ? ` OR UPPER(${cfg.streetDir}) = '${full}'` : ''})`;
  }
  if (query.suffix && cfg.streetSuffix && !query.partial) {
    const list = wordsForSuffix(query.suffix).map(word => `'${escapeArcGIS(word)}'`).join(', ');
    where += ` AND UPPER(${cfg.streetSuffix}) IN (${list})`;
  }
  if (query.unit && cfg.unit) {
    where += ` AND UPPER(${cfg.unit}) = '${escapeArcGIS(query.unit)}'`;
  }

  const data = await queryArcGIS(
    cfg.endpoint,
    { where, outFields: '*', returnGeometry: true, resultRecordCount: 5 },
    timeout
  );

  const results = [];
  const seen = new Set();
  for (const feature of data.features || []) {
    const attrs = feature.properties || {};
    const point = Array.isArray(feature.geometry?.coordinates) ? feature.geometry.coordinates : null;
    const lng = point ? Number(point[0]) : Number(attrs[cfg.lng]);
    const lat = point ? Number(point[1]) : Number(attrs[cfg.lat]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const parcels = await queryArcGIS(
      county.parcelEndpoint,
      {
        geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
        geometryType: 'esriGeometryPoint',
        inSR: 4326,
        spatialRel: 'esriSpatialRelIntersects',
        outFields: '*',
        returnGeometry: true,
      },
      timeout
    );
    const parcel = (parcels.features || []).find(item => item.geometry);
    if (!parcel) continue;
    const normalized = normalizeParcelProps(parcel.properties || {}, county, county.fields);
    if (!normalized.parcelId || seen.has(String(normalized.parcelId))) continue;
    seen.add(String(normalized.parcelId));

    const centroid = getGeometryCentroid(parcel.geometry) || { lat, lng };
    const dir = DIRECTIONS[String(attrs[cfg.streetDir] || '').toUpperCase()] || '';
    const suffix = SUFFIXES[String(attrs[cfg.streetSuffix] || '').toUpperCase()] || '';
    const unit = cfg.unit ? cleanUnit(attrs[cfg.unit]) : '';
    const address = [number, dir, String(attrs[cfg.streetName] || '').toUpperCase(), suffix, unit]
      .filter(Boolean)
      .join(' ');
    const municipality = normalized.municipality || null;
    let localityMatch = false;
    let score = 84;
    if (query.cityTokens.length && municipality && query.cityTokens.some(t => municipality.toUpperCase().includes(t))) {
      score += 20;
      localityMatch = true;
    }

    results.push({
      countyKey,
      countyName: county.name,
      parcelId: String(normalized.parcelId),
      address,
      municipality,
      lat: centroid.lat,
      lng: centroid.lng,
      score,
      localityMatch,
    });
  }
  return results;
}

function cleanUnit(value) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  if (!text || text === '0') return '';
  return text.toUpperCase();
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
