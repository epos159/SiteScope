/**
 * Quick parcel resolver smoke test for all supported counties.
 * Usage: node scripts/verify-counties.js
 */
const axios = require('axios');
const { COUNTIES } = require('../config/counties');
const { buildAddressWhereClauses } = require('../utils/addressUtils');

const TIMEOUT = 30000;

async function queryArcGIS(endpoint, params) {
  const { data } = await axios.get(endpoint, {
    params: { ...params, f: 'geojson', outSR: 4326 },
    timeout: TIMEOUT,
  });
  return data;
}

async function resolveCounty(countyKey, lat, lng, address) {
  const county = COUNTIES[countyKey];
  const endpoint = county.parcelEndpoint;
  const fields = county.fields;
  const addressSearch = county.addressSearch;

  if (address && addressSearch) {
    const strategies = buildAddressWhereClauses(address, addressSearch);
    for (const where of strategies) {
      try {
        const data = await queryArcGIS(endpoint, {
          where,
          outFields: '*',
          returnGeometry: true,
          resultRecordCount: 5,
        });
        if (data.features?.length) {
          const props = data.features[0].properties || {};
          return {
            method: 'address',
            owner: props[fields.ownerName] || [fields.ownerNameParts?.map(p => props[p]).join(' ')].filter(Boolean)[0],
            parcelId: props[fields.parcelId],
            siteAddress: props[fields.siteAddress],
          };
        }
      } catch {
        // try next strategy
      }
    }
  }

  let data = await queryArcGIS(endpoint, {
    geometry: JSON.stringify({ x: lng, y: lat }),
    geometryType: 'esriGeometryPoint',
    inSR: 4326,
    spatialRel: 'esriSpatialRelIntersects',
    outFields: '*',
    returnGeometry: true,
    resultRecordCount: 10,
  });

  if (!data.features?.length) {
    const buffer = 0.0004;
    data = await queryArcGIS(endpoint, {
      geometry: JSON.stringify({
        xmin: lng - buffer,
        ymin: lat - buffer,
        xmax: lng + buffer,
        ymax: lat + buffer,
      }),
      geometryType: 'esriGeometryEnvelope',
      inSR: 4326,
      spatialRel: 'esriSpatialRelIntersects',
      outFields: '*',
      returnGeometry: true,
      resultRecordCount: 10,
    });
  }

  if (!data.features?.length) return { method: 'none' };

  const props = data.features[0].properties || {};
  const owner =
    props[fields.ownerName] ||
    (fields.ownerNameParts || []).map(p => props[p]).filter(Boolean).join(' ').trim() ||
    null;

  return {
    method: 'spatial',
    owner,
    parcelId: props[fields.parcelId],
    siteAddress: props[fields.siteAddress],
  };
}

const CASES = [
  { key: 'york', lat: 40.001, lng: -76.850, address: '3400 Fox Run Rd, Dover, PA' },
  { key: 'adams', lat: 39.830, lng: -77.231, address: '1 Lincoln Sq, Gettysburg, PA' },
  { key: 'lancaster', lat: 40.0379, lng: -76.3055, address: '1 N Queen St, Lancaster, PA' },
  { key: 'cumberland', lat: 40.201, lng: -77.189, address: '1 Courthouse Sq, Carlisle, PA' },
  { key: 'dauphin', lat: 40.260, lng: -76.884, address: '2 N 2nd St, Harrisburg, PA' },
  { key: 'franklin', lat: 39.937, lng: -77.661, address: '20 S Main St, Chambersburg, PA' },
];

(async () => {
  let failed = 0;
  for (const test of CASES) {
    try {
      const result = await resolveCounty(test.key, test.lat, test.lng, test.address);
      const ok = result.owner && result.parcelId;
      console.log(
        ok ? 'OK' : 'FAIL',
        test.key.padEnd(12),
        result.method.padEnd(8),
        result.owner?.slice(0, 40) || '-',
        result.parcelId || '-'
      );
      if (!ok) failed += 1;
    } catch (err) {
      console.log('ERR', test.key, err.message);
      failed += 1;
    }
  }
  process.exit(failed > 0 ? 1 : 0);
})();
