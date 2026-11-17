/**
 * Local SSURGO copy for the supported counties, used when USDA Soil Data Access is unreachable.
 * Built by scripts/build-soil-fallback.js; mirrors the SDA query in routes/soil.js
 * (major components of every map unit intersecting the area of interest).
 */
const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'soil-fallback.sqlite');

// Adams, Cumberland, Dauphin, Franklin, Lancaster, York
const SURVEY_AREAS = ['PA001', 'PA041', 'PA043', 'PA055', 'PA071', 'PA133'];

const COORD_SCALE = 1e6;

let db = null;
let dbUnavailable = false;
let surveyInfo = null;

// Geometry blob: varint ring count, varint point count per ring, then zigzag-varint
// coordinate deltas on a 1e-6° grid (~0.1 m). Decodes to one flat Int32Array [x0, y0, x1, y1, ...] per ring.
function encodePolygon(rings) {
  const bytes = [];
  const writeVarint = value => {
    let v = value >>> 0;
    while (v >= 0x80) {
      bytes.push((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    bytes.push(v);
  };
  const writeSigned = value => writeVarint((value << 1) ^ (value >> 31));

  writeVarint(rings.length);
  for (const ring of rings) writeVarint(ring.length);
  let prevX = 0;
  let prevY = 0;
  for (const ring of rings) {
    for (const [lng, lat] of ring) {
      const x = Math.round(lng * COORD_SCALE);
      const y = Math.round(lat * COORD_SCALE);
      writeSigned(x - prevX);
      writeSigned(y - prevY);
      prevX = x;
      prevY = y;
    }
  }
  return Buffer.from(bytes);
}

function decodePolygon(blob) {
  const bytes = blob instanceof Uint8Array ? blob : Buffer.from(blob);
  let offset = 0;
  const readVarint = () => {
    let result = 0;
    let shift = 0;
    let byte;
    do {
      byte = bytes[offset++];
      result |= (byte & 0x7f) << shift;
      shift += 7;
    } while (byte & 0x80);
    return result >>> 0;
  };
  const readSigned = () => {
    const v = readVarint();
    return (v >>> 1) ^ -(v & 1);
  };

  const ringCount = readVarint();
  const lengths = [];
  for (let r = 0; r < ringCount; r++) lengths.push(readVarint());
  let x = 0;
  let y = 0;
  return lengths.map(length => {
    const ring = new Int32Array(length * 2);
    for (let i = 0; i < length; i++) {
      x += readSigned();
      y += readSigned();
      ring[i * 2] = x;
      ring[i * 2 + 1] = y;
    }
    return ring;
  });
}

function openDb() {
  if (db || dbUnavailable) return db;
  if (!fs.existsSync(DB_PATH)) {
    dbUnavailable = true;
    console.warn('[soilFallback] data file missing, fallback disabled');
    return null;
  }
  try {
    const { DatabaseSync } = require('node:sqlite');
    db = new DatabaseSync(DB_PATH, { readOnly: true });
    const row = db.prepare("SELECT value FROM meta WHERE key = 'survey_areas'").get();
    surveyInfo = row ? JSON.parse(row.value) : [];
  } catch (err) {
    dbUnavailable = true;
    console.warn('[soilFallback] could not open data file:', err.message);
  }
  return db;
}

function pointInRing(ring, x, y) {
  let inside = false;
  const n = ring.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = ring[i * 2];
    const yi = ring[i * 2 + 1];
    const xj = ring[j * 2];
    const yj = ring[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointInPolygon(rings, x, y) {
  if (!pointInRing(rings[0], x, y)) return false;
  for (let h = 1; h < rings.length; h++) {
    if (pointInRing(rings[h], x, y)) return false;
  }
  return true;
}

// Liang–Barsky clip test
function segmentHitsRect(x1, y1, x2, y2, rect) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  let t0 = 0;
  let t1 = 1;
  const checks = [
    [-dx, x1 - rect.minX],
    [dx, rect.maxX - x1],
    [-dy, y1 - rect.minY],
    [dy, rect.maxY - y1],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return false;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return false;
        if (t < t1) t1 = t;
      }
    }
  }
  return true;
}

function polygonIntersectsRect(rings, rect) {
  for (const ring of rings) {
    const n = ring.length / 2;
    for (let i = 0; i < n - 1; i++) {
      if (segmentHitsRect(ring[i * 2], ring[i * 2 + 1], ring[i * 2 + 2], ring[i * 2 + 3], rect)) return true;
    }
  }
  const cx = (rect.minX + rect.maxX) / 2;
  const cy = (rect.minY + rect.maxY) / 2;
  return pointInPolygon(rings, cx, cy);
}

function mukeysIntersectingBox(database, box) {
  const candidates = database.prepare(`
    SELECT p.mukey, p.geom FROM polygon_index i
    JOIN polygon p ON p.id = i.id
    WHERE i.max_x >= ? AND i.min_x <= ? AND i.max_y >= ? AND i.min_y <= ?
  `).all(box.minLng, box.maxLng, box.minLat, box.maxLat);

  const rect = rectFromWgs84Box(box);
  const mukeys = new Set();
  for (const c of candidates) {
    if (mukeys.has(c.mukey)) continue;
    if (polygonIntersectsRect(decodePolygon(c.geom), rect)) mukeys.add(c.mukey);
  }
  return [...mukeys];
}

function rectFromWgs84Box({ minLng, minLat, maxLng, maxLat }) {
  return {
    minX: Math.round(minLng * COORD_SCALE),
    maxX: Math.round(maxLng * COORD_SCALE),
    minY: Math.round(minLat * COORD_SCALE),
    maxY: Math.round(maxLat * COORD_SCALE),
  };
}

/**
 * @param {{ method: string, box: { minLng, minLat, maxLng, maxLat } }[]} areas tried in order
 * @returns {{ rows: object[], method: string, surveyAreas: object[] } | null} null when no local data covers the point
 */
function lookupSoil(areas) {
  const database = openDb();
  if (!database) return null;

  for (const area of areas) {
    const mukeys = mukeysIntersectingBox(database, area.box);
    if (!mukeys.length) continue;

    const placeholders = mukeys.map(() => '?').join(',');
    const rows = database.prepare(`
      SELECT DISTINCT mu.mukey, mu.musym, mu.muname, mu.areasymbol,
        c.comppct_r, c.slope_l, c.slope_r, c.slope_h,
        c.drainagecl, c.hydgrp, c.hydricrating, c.taxorder, c.taxsubgrp
      FROM mapunit mu
      JOIN component c ON c.mukey = mu.mukey
      WHERE mu.mukey IN (${placeholders})
      ORDER BY c.comppct_r DESC
    `).all(...mukeys);

    const usedAreas = new Set(rows.map(r => r.areasymbol));
    return {
      rows: rows.map(r => ({ ...r, mukey: String(r.mukey) })),
      method: area.method,
      surveyAreas: surveyInfo.filter(s => usedAreas.has(s.areasymbol)),
    };
  }
  return null;
}

module.exports = { SURVEY_AREAS, COORD_SCALE, encodePolygon, decodePolygon, lookupSoil };
