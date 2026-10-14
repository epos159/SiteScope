/**
 * End-to-end address accuracy check.
 *
 * Pulls random real site addresses from each county's parcel layer, runs them
 * through /api/geocode + /api/parcels exactly like the client does, and reports
 * whether the resolved parcel ID matches the source record.
 *
 * Usage:
 *   node scripts/address-accuracy.js                 (local server on :3001)
 *   API_BASE=https://sitescope-o02t.onrender.com/api node scripts/address-accuracy.js
 *   SAMPLES=10 COUNTIES=york,dauphin node scripts/address-accuracy.js
 */
const axios = require('axios');
const { COUNTIES } = require('../config/counties');

const API_BASE = process.env.API_BASE || 'http://localhost:3001/api';
const SAMPLES = parseInt(process.env.SAMPLES || '6', 10);
const ONLY = process.env.COUNTIES ? process.env.COUNTIES.split(',') : Object.keys(COUNTIES);

const SAMPLE_ADDRESS = {
  york: a => a.PROPADR,
  adams: a => a.COMBINED_SITUS,
  lancaster: a => a.ADDRESS,
  cumberland: a => a.SITUS,
  dauphin: a =>
    [a.house_numb, a.prefix_dir, a.street_nam, a.street_suf]
      .filter(v => v != null && String(v).trim() && String(v).trim() !== '0')
      .join(' '),
  franklin: a => a.SITUSAddress1,
};

const VALID_ADDRESS = /^\d+[A-Z]?\s+[A-Z]/i;

async function sampleCounty(countyKey) {
  const county = COUNTIES[countyKey];
  const endpoint = county.parcelEndpoint;
  const { data: countData } = await axios.get(endpoint, {
    params: { where: '1=1', returnCountOnly: true, f: 'json' },
    timeout: 90000,
  });
  const total = countData.count || 0;
  const picks = [];

  for (let attempt = 0; attempt < SAMPLES * 4 && picks.length < SAMPLES; attempt += 1) {
    const offset = Math.floor(Math.random() * Math.max(total - 50, 1));
    const { data } = await axios.get(endpoint, {
      params: {
        where: '1=1',
        outFields: '*',
        returnGeometry: false,
        orderByFields: county.fields.parcelId,
        resultOffset: offset,
        resultRecordCount: 50,
        f: 'json',
      },
      timeout: 90000,
    });
    const candidates = (data.features || [])
      .map(f => f.attributes)
      .filter(a => {
        const addr = SAMPLE_ADDRESS[countyKey](a);
        return addr && VALID_ADDRESS.test(addr.trim()) && !/^0+\s/.test(addr.trim());
      });
    if (candidates.length) {
      const a = candidates[Math.floor(Math.random() * candidates.length)];
      picks.push({
        address: SAMPLE_ADDRESS[countyKey](a).replace(/\s+/g, ' ').trim(),
        parcelId: String(a[county.fields.parcelId]),
      });
    }
  }
  return picks;
}

async function runCase(countyKey, sample) {
  const started = Date.now();
  try {
    const { data: geo } = await axios.get(`${API_BASE}/geocode`, {
      params: { address: sample.address },
      timeout: 60000,
    });
    const { data: parcel } = await axios.get(`${API_BASE}/parcels`, {
      params: {
        lat: geo.lat,
        lng: geo.lng,
        countyKey: geo.countyKey,
        address: sample.address,
        parcelId: geo.parcelId,
      },
      timeout: 90000,
    });
    const gotId = parcel.feature?.properties?.parcelId;
    let outcome;
    if (geo.countyKey !== countyKey) outcome = `WRONG COUNTY (${geo.countyKey || 'none'})`;
    else if (!gotId) outcome = 'NO PARCEL';
    else if (String(gotId) === sample.parcelId) outcome = 'OK';
    else outcome = `WRONG PARCEL (${gotId} ${parcel.feature?.properties?.siteAddress || ''})`;
    return { outcome, ms: Date.now() - started, source: geo.source };
  } catch (err) {
    const status = err.response?.status;
    return { outcome: status === 404 ? 'NOT FOUND' : `ERROR ${status || err.message}`, ms: Date.now() - started };
  }
}

async function main() {
  console.log(`API: ${API_BASE}  samples/county: ${SAMPLES}\n`);
  const totals = { ok: 0, all: 0 };

  for (const countyKey of ONLY) {
    let samples;
    try {
      samples = await sampleCounty(countyKey);
    } catch (err) {
      console.log(`${countyKey}: could not sample (${err.message})`);
      continue;
    }

    for (const sample of samples) {
      const result = await runCase(countyKey, sample);
      totals.all += 1;
      if (result.outcome === 'OK') totals.ok += 1;
      console.log(
        `${countyKey.padEnd(10)} ${sample.address.padEnd(34)} ${(result.ms / 1000).toFixed(1).padStart(5)}s ${result.source ? `[${result.source}] ` : ''}${result.outcome}`
      );
    }
  }

  console.log(`\n${totals.ok}/${totals.all} resolved to the exact parcel`);
}

main();
