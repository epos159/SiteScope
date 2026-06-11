const STREET_SUFFIXES =
  /\b(RD|ROAD|DR|DRIVE|LN|LANE|ST|STREET|AVE|AVENUE|BLVD|CT|COURT|WAY|PL|PLACE|CIR|CIRCLE|TRL|TRAIL|PKWY|PARKWAY|HWY|HIGHWAY)\b\.?/gi;

function escapeArcGIS(value) {
  return String(value).replace(/'/g, "''");
}

/**
 * Parse a user-entered address into searchable components.
 */
function parseSearchAddress(address) {
  if (!address) {
    return { streetNumber: null, streetName: '', streetLine: '', city: '', zip: '' };
  }

  const parts = address.split(',').map(p => p.trim()).filter(Boolean);
  const streetLine = parts[0] || address.trim();
  const city = parts[1] || '';
  const zipMatch = address.match(/\b(\d{5})(?:-\d{4})?\b/);
  const streetMatch = streetLine.match(/^(\d+[A-Z]?)\s+(.+)$/i);

  const streetNumber = streetMatch ? streetMatch[1] : null;
  const streetRaw = streetMatch ? streetMatch[2] : streetLine;
  const streetName = streetRaw
    .toUpperCase()
    .replace(STREET_SUFFIXES, '')
    .replace(/[^A-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  const streetNameFull = streetRaw
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    streetNumber,
    streetName,
    streetNameFull,
    streetLine,
    city: city.replace(/\bPA\b/i, '').trim(),
    zip: zipMatch ? zipMatch[1] : '',
  };
}

function getAddressSearchFields(addressSearch) {
  return [
    addressSearch.siteAddress,
    addressSearch.streetName,
    addressSearch.alternateStreetName,
    addressSearch.visStreetName,
    addressSearch.fireStAddr,
    addressSearch.pollAddr,
  ].filter(Boolean);
}

/**
 * Build a single strict ArcGIS WHERE clause (legacy helper).
 */
function buildAddressWhereClause(searchAddress, addressSearch) {
  const strategies = buildAddressWhereClauses(searchAddress, addressSearch);
  return strategies[0] || null;
}

/**
 * Build multiple WHERE clause strategies from strict to relaxed.
 * Spatial envelope around the geocode point should always accompany these.
 */
function buildAddressWhereClauses(searchAddress, addressSearch) {
  const parsed = parseSearchAddress(searchAddress);
  if (!parsed.streetNumber) return [];

  const num = parseInt(parsed.streetNumber, 10);
  if (Number.isNaN(num)) return [];

  const numField = addressSearch.streetNumber || 'STRTNUMB';
  const tokens = parsed.streetName.split(/\s+/).filter(t => t.length > 1);
  const fullTokens = parsed.streetNameFull.split(/\s+/).filter(t => t.length > 1);
  const searchFields = getAddressSearchFields(addressSearch);
  const clauses = [];

  // 1. Strict: house number + every significant street token
  if (searchFields.length > 0 && tokens.length > 0) {
    const strictParts = [`${numField} = ${num}`];
    for (const token of tokens.slice(0, 3)) {
      const streetClauses = searchFields.map(
        field => `UPPER(${field}) LIKE '%${escapeArcGIS(token)}%'`
      );
      strictParts.push(`(${streetClauses.join(' OR ')})`);
    }
    clauses.push(strictParts.join(' AND '));
  }

  // 2. House number + primary street token only
  if (searchFields.length > 0 && tokens.length > 0) {
    const primary = tokens[0];
    const streetClauses = searchFields.map(
      field => `UPPER(${field}) LIKE '%${escapeArcGIS(primary)}%'`
    );
    clauses.push(`${numField} = ${num} AND (${streetClauses.join(' OR ')})`);
  }

  // 3. Full street line tokens in ADDRESS (keeps suffix words like COURT)
  if (addressSearch.siteAddress && fullTokens.length > 0) {
    const addrField = addressSearch.siteAddress;
    const parts = [
      `UPPER(${addrField}) LIKE '%${escapeArcGIS(parsed.streetNumber)}%'`,
    ];
    for (const token of fullTokens.slice(0, 3)) {
      parts.push(`UPPER(${addrField}) LIKE '%${escapeArcGIS(token)}%'`);
    }
    clauses.push(parts.join(' AND '));
  }

  // 4. VIS street fields (York County normalized components)
  if (addressSearch.visStreetNumber && addressSearch.visStreetName && tokens.length > 0) {
    clauses.push(
      `${addressSearch.visStreetNumber} = ${num} AND UPPER(${addressSearch.visStreetName}) LIKE '%${escapeArcGIS(tokens[0])}%'`
    );
  }

  // 5. Loose ADDRESS contains number + first token (spatial filter does the rest)
  if (addressSearch.siteAddress && tokens.length > 0) {
    clauses.push(
      `UPPER(${addressSearch.siteAddress}) LIKE '%${escapeArcGIS(parsed.streetNumber)}%' AND UPPER(${addressSearch.siteAddress}) LIKE '%${escapeArcGIS(tokens[0])}%'`
    );
  }

  return [...new Set(clauses)];
}

/**
 * Score how well a single address string matches the user's search.
 */
function scoreAddressMatch(searchAddress, parcelAddress) {
  const parsed = parseSearchAddress(searchAddress);
  if (!parsed.streetNumber || !parcelAddress) return 0;

  const parcel = String(parcelAddress).toUpperCase().trim();
  const num = parsed.streetNumber.toUpperCase();

  const numPattern = new RegExp(`(^|\\s|/)${num}(\\s|$|[A-Z])`, 'i');
  if (!numPattern.test(parcel)) return 0;

  let score = 25;

  const leadingNum = parcel.match(/^(\d+[A-Z]?)\b/);
  if (leadingNum && leadingNum[1] === num) score += 40;

  const tokens = [
    ...parsed.streetName.split(/\s+/),
    ...parsed.streetNameFull.split(/\s+/),
  ].filter(t => t.length > 1);

  const seen = new Set();
  for (const token of tokens) {
    if (seen.has(token)) continue;
    seen.add(token);
    if (parcel.includes(token)) score += 15;
  }

  if (parsed.city) {
    const cityToken = parsed.city.toUpperCase().split(/\s+/)[0];
    if (cityToken.length > 2 && parcel.includes(cityToken)) score += 5;
  }

  return score;
}

/**
 * Score a parcel feature against the search address using all configured address fields.
 */
function scoreParcelAddressMatch(searchAddress, feature, addressSearch) {
  const props = feature.properties || feature.attributes || {};
  let best = 0;

  for (const field of getAddressSearchFields(addressSearch)) {
    const score = scoreAddressMatch(searchAddress, props[field]);
    if (score > best) best = score;
  }

  return best;
}

function pickBestAddressMatch(searchAddress, features, siteAddressField) {
  let best = null;
  let bestScore = 0;

  for (const feature of features) {
    const props = feature.properties || feature.attributes || {};
    const siteAddress = props[siteAddressField];
    const score = scoreAddressMatch(searchAddress, siteAddress);
    if (score > bestScore) {
      bestScore = score;
      best = feature;
    }
  }

  return bestScore >= 40 ? best : null;
}

/**
 * Pick the best parcel using address scoring plus geocode proximity.
 */
function pickBestParcelMatch(searchAddress, features, addressSearch, lat, lng, geoUtils) {
  if (!features?.length) return null;

  let best = null;
  let bestScore = -Infinity;

  for (const feature of features) {
    const addressScore = searchAddress
      ? scoreParcelAddressMatch(searchAddress, feature, addressSearch)
      : 0;

    let locationScore = 0;
    if (lat != null && lng != null && feature.geometry && geoUtils) {
      if (geoUtils.pointInPolygon(lat, lng, feature.geometry)) {
        locationScore += 120;
      }

      const centroid = geoUtils.getGeometryCentroid(feature.geometry);
      if (centroid) {
        const dLat = centroid.lat - lat;
        const dLng = centroid.lng - lng;
        const dist = Math.sqrt(dLat * dLat + dLng * dLng);
        locationScore += Math.max(0, 60 - dist * 80000);
      }

      const area = geoUtils.getPolygonArea(feature.geometry);
      if (area > 0) {
        // Prefer smaller containing parcels when the geocode point sits on a boundary.
        locationScore += Math.max(0, 20 - Math.log10(area + 1) * 5);
      }
    }

    const total = addressScore + locationScore;
    if (total > bestScore) {
      bestScore = total;
      best = feature;
    }
  }

  if (searchAddress) {
    const addressScore = scoreParcelAddressMatch(searchAddress, best, addressSearch);
    const containsPoint =
      lat != null &&
      lng != null &&
      best?.geometry &&
      geoUtils?.pointInPolygon(lat, lng, best.geometry);

    if (addressScore >= 40) return best;
    if (addressScore >= 25 && containsPoint) return best;
    if (addressScore >= 15 && bestScore >= 100) return best;
    return null;
  }

  return bestScore > 0 ? best : null;
}

module.exports = {
  parseSearchAddress,
  buildAddressWhereClause,
  buildAddressWhereClauses,
  scoreAddressMatch,
  scoreParcelAddressMatch,
  pickBestAddressMatch,
  pickBestParcelMatch,
};
