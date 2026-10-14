const axios = require('axios');

const DEFAULT_TIMEOUT = 20000;

async function queryArcGIS(endpoint, params, timeout = DEFAULT_TIMEOUT) {
  const response = await axios.get(endpoint, {
    params: { ...params, f: 'geojson', outSR: 4326 },
    timeout,
  });
  if (response.data?.error) {
    throw new Error(response.data.error.message || 'ArcGIS query error');
  }
  return response.data;
}

function cleanValue(value) {
  if (value == null) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();
  // Several county layers store "0" as a placeholder for empty address parts.
  if (!text || text === '0') return null;
  return text;
}

function composeSiteAddress(props, parts) {
  if (!parts?.length) return null;
  return parts.map(part => cleanValue(props[part])).filter(Boolean).join(' ') || null;
}

function normalizeParcelProps(props, county, fields) {
  let acreage = null;
  if (fields.acreageDirect && props[fields.acreageDirect] != null) {
    acreage = parseFloat(props[fields.acreageDirect]).toFixed(2);
  } else if (fields.acreageFallback && props[fields.acreageFallback] != null) {
    acreage = parseFloat(props[fields.acreageFallback]).toFixed(2);
  } else if (county.acreageFromShapeArea && fields.acreage && props[fields.acreage] != null) {
    acreage = (parseFloat(props[fields.acreage]) / 43560).toFixed(2);
  }

  let municipality = fields.municipality ? cleanValue(props[fields.municipality]) : null;
  if (!municipality && fields.districtField && county.districtLookup) {
    const padLen = county.districtPadLength || 2;
    const rawCode = String(props[fields.districtField] ?? '').trim();
    if (rawCode) {
      const code = rawCode.padStart(padLen, '0');
      municipality = county.districtLookup[code] || null;
    }
  }

  let ownerName = fields.ownerName ? cleanValue(props[fields.ownerName]) : null;
  if (!ownerName && fields.ownerNameParts?.length) {
    ownerName = fields.ownerNameParts.map(part => cleanValue(props[part])).filter(Boolean).join(' ') || null;
  }

  let siteAddress = fields.siteAddress ? cleanValue(props[fields.siteAddress]) : null;
  const composedSiteAddress = composeSiteAddress(props, fields.siteAddressParts);
  if (composedSiteAddress && (!siteAddress || composedSiteAddress.length >= siteAddress.length)) {
    siteAddress = composedSiteAddress;
  }

  return {
    ownerName,
    ownerName2: fields.ownerName2 ? cleanValue(props[fields.ownerName2]) : null,
    parcelId: props[fields.parcelId] || null,
    acreage,
    municipality,
    county: county.name,
    siteAddress,
  };
}

function toFeature(rawFeature, county, fields) {
  const props = rawFeature.properties || {};
  return {
    type: 'Feature',
    geometry: rawFeature.geometry || null,
    properties: normalizeParcelProps(props, county, fields),
  };
}

function escapeArcGIS(value) {
  return String(value).replace(/'/g, "''");
}

/**
 * Fetch a single parcel by its county parcel ID (exact match).
 */
async function fetchParcelById(county, parcelId, timeout) {
  const data = await queryArcGIS(
    county.parcelEndpoint,
    {
      where: `${county.fields.parcelId} = '${escapeArcGIS(parcelId)}'`,
      outFields: '*',
      returnGeometry: true,
      resultRecordCount: 5,
    },
    timeout
  );
  const raw = data.features?.[0];
  return raw ? toFeature(raw, county, county.fields) : null;
}

module.exports = {
  queryArcGIS,
  cleanValue,
  composeSiteAddress,
  normalizeParcelProps,
  toFeature,
  escapeArcGIS,
  fetchParcelById,
};
