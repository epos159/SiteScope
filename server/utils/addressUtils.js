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

  return {
    streetNumber,
    streetName,
    streetLine,
    city: city.replace(/\bPA\b/i, '').trim(),
    zip: zipMatch ? zipMatch[1] : '',
  };
}

/**
 * Build an ArcGIS WHERE clause for address-based parcel lookup.
 */
function buildAddressWhereClause(searchAddress, addressSearch) {
  const parsed = parseSearchAddress(searchAddress);
  if (!parsed.streetNumber) return null;

  const clauses = [];

  if (addressSearch.streetNumber) {
    const num = parseInt(parsed.streetNumber, 10);
    if (!Number.isNaN(num)) {
      clauses.push(`${addressSearch.streetNumber} = ${num}`);
    }
  } else if (addressSearch.siteAddress) {
    clauses.push(`UPPER(${addressSearch.siteAddress}) LIKE '%${escapeArcGIS(parsed.streetNumber)}%'`);
  }

  const tokens = parsed.streetName.split(/\s+/).filter(t => t.length > 1);
  const searchFields = [
    addressSearch.streetName,
    addressSearch.alternateStreetName,
    addressSearch.siteAddress,
  ].filter(Boolean);

  if (searchFields.length === 0 || tokens.length === 0) return null;

  for (const token of tokens.slice(0, 3)) {
    const streetClauses = searchFields.map(
      field => `UPPER(${field}) LIKE '%${escapeArcGIS(token)}%'`
    );
    clauses.push(
      streetClauses.length === 1 ? streetClauses[0] : `(${streetClauses.join(' OR ')})`
    );
  }

  return clauses.join(' AND ');
}

/**
 * Score how well a parcel's site address matches the user's search.
 * Higher is better; 0 means no match.
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

  const tokens = parsed.streetName.split(/\s+/).filter(t => t.length > 1);
  for (const token of tokens) {
    if (parcel.includes(token)) score += 15;
  }

  if (parsed.city) {
    const cityToken = parsed.city.toUpperCase().split(/\s+/)[0];
    if (cityToken.length > 2 && parcel.includes(cityToken)) score += 5;
  }

  return score;
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

module.exports = {
  parseSearchAddress,
  buildAddressWhereClause,
  scoreAddressMatch,
  pickBestAddressMatch,
};
