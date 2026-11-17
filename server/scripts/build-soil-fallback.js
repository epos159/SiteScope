/**
 * Builds server/data/soil-fallback.sqlite from a USDA SQLite SSURGO state GeoPackage.
 * The fallback answers soil queries for the supported counties when Soil Data Access is down.
 *
 * Source: https://nrcs.app.box.com/v/gateway (SSURGO > SQLite SSURGO (Geopackages) > States > SQLite_SSURGO_PA.7z)
 * USDA republishes it each October; re-run this after downloading the new release.
 *
 * Usage: node scripts/build-soil-fallback.js <path-to-SQLite_SSURGO_PA.gpkg> [--tolerance=deg]
 */
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { SURVEY_AREAS, COORD_SCALE, encodePolygon } = require('../services/soilFallback');

const OUTPUT = path.join(__dirname, '..', 'data', 'soil-fallback.sqlite');

const sourcePath = process.argv[2];
const toleranceArg = process.argv.find(a => a.startsWith('--tolerance='));
const tolerance = toleranceArg ? parseFloat(toleranceArg.split('=')[1]) : 0;

function gpkgToWkbOffset(blob) {
  if (blob[0] !== 0x47 || blob[1] !== 0x50) throw new Error('Not a GeoPackage geometry blob');
  const envelopeIndicator = (blob[3] >> 1) & 0x07;
  const envelopeBytes = [0, 32, 48, 48, 64][envelopeIndicator];
  if (envelopeBytes == null) throw new Error(`Bad envelope indicator ${envelopeIndicator}`);
  return 8 + envelopeBytes;
}

function readWkbPolygons(buf, start) {
  const polygons = [];
  let offset = start;

  function readGeometry() {
    const littleEndian = buf[offset] === 1;
    offset += 1;
    const readU32 = () => {
      const v = littleEndian ? buf.readUInt32LE(offset) : buf.readUInt32BE(offset);
      offset += 4;
      return v;
    };
    const readF64 = () => {
      const v = littleEndian ? buf.readDoubleLE(offset) : buf.readDoubleBE(offset);
      offset += 8;
      return v;
    };

    const rawType = readU32();
    const isoType = rawType & 0x0fffffff;
    const isoDims = Math.floor(isoType / 1000);
    const hasZ = (rawType & 0x80000000) !== 0 || isoDims === 1 || isoDims === 3;
    const hasM = (rawType & 0x40000000) !== 0 || isoDims === 2 || isoDims === 3;
    const baseType = isoType % 1000;
    const dims = 2 + (hasZ ? 1 : 0) + (hasM ? 1 : 0);

    if (baseType === 3) {
      const rings = [];
      const ringCount = readU32();
      for (let r = 0; r < ringCount; r++) {
        const pointCount = readU32();
        const ring = new Array(pointCount);
        for (let p = 0; p < pointCount; p++) {
          const x = readF64();
          const y = readF64();
          offset += (dims - 2) * 8;
          ring[p] = [x, y];
        }
        rings.push(ring);
      }
      polygons.push(rings);
    } else if (baseType === 6) {
      const count = readU32();
      for (let i = 0; i < count; i++) readGeometry();
    } else {
      throw new Error(`Unsupported WKB geometry type ${rawType}`);
    }
  }

  readGeometry();
  return polygons;
}

function simplifyRing(ring, tol) {
  if (tol <= 0 || ring.length <= 5) return ring;
  const keep = new Uint8Array(ring.length);
  keep[0] = 1;
  keep[ring.length - 1] = 1;
  const stack = [[0, ring.length - 1]];
  const tolSq = tol * tol;

  while (stack.length) {
    const [first, last] = stack.pop();
    const [ax, ay] = ring[first];
    const [bx, by] = ring[last];
    const dx = bx - ax;
    const dy = by - ay;
    const lenSq = dx * dx + dy * dy;
    let maxDist = 0;
    let index = -1;

    for (let i = first + 1; i < last; i++) {
      const [px, py] = ring[i];
      let distSq;
      if (lenSq === 0) {
        distSq = (px - ax) ** 2 + (py - ay) ** 2;
      } else {
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
        distSq = (px - ax - t * dx) ** 2 + (py - ay - t * dy) ** 2;
      }
      if (distSq > maxDist) {
        maxDist = distSq;
        index = i;
      }
    }

    if (index !== -1 && maxDist > tolSq) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }

  const simplified = ring.filter((_, i) => keep[i]);
  return simplified.length >= 4 ? simplified : ring;
}

function ringBounds(ring) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

function main() {
  if (!sourcePath || !fs.existsSync(sourcePath)) {
    console.error('Usage: node scripts/build-soil-fallback.js <path-to-SQLite_SSURGO_PA.gpkg> [--tolerance=deg]');
    process.exit(1);
  }
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  const areaList = SURVEY_AREAS.map(a => `'${a}'`).join(',');

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  if (fs.existsSync(OUTPUT)) fs.unlinkSync(OUTPUT);
  const out = new DatabaseSync(OUTPUT);

  out.exec(`
    PRAGMA journal_mode = OFF;
    PRAGMA synchronous = OFF;
    CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT);
    CREATE TABLE mapunit (mukey INTEGER PRIMARY KEY, musym TEXT, muname TEXT, areasymbol TEXT);
    CREATE TABLE component (
      mukey INTEGER, comppct_r REAL, slope_l REAL, slope_r REAL, slope_h REAL,
      drainagecl TEXT, hydgrp TEXT, hydricrating TEXT, taxorder TEXT, taxsubgrp TEXT
    );
    CREATE INDEX component_mukey ON component (mukey);
    CREATE TABLE polygon (id INTEGER PRIMARY KEY, mukey INTEGER, geom BLOB);
    CREATE VIRTUAL TABLE polygon_index USING rtree (id, min_x, max_x, min_y, max_y);
  `);

  const legend = source.prepare(`
    SELECT l.areasymbol, l.areaname, sc.saverest AS versionDate
    FROM legend l JOIN sacatalog sc ON sc.areasymbol = l.areasymbol
    WHERE l.areasymbol IN (${areaList})
  `).all();
  const missing = SURVEY_AREAS.filter(a => !legend.some(l => l.areasymbol === a));
  if (missing.length) throw new Error(`Survey areas missing from source: ${missing.join(', ')}`);

  const insertMeta = out.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  insertMeta.run('built_at', new Date().toISOString());
  insertMeta.run('source_file', path.basename(sourcePath));
  insertMeta.run('tolerance_deg', String(tolerance));
  insertMeta.run('survey_areas', JSON.stringify(legend));

  out.exec('BEGIN');

  const units = source.prepare(`
    SELECT mu.mukey, mu.musym, mu.muname, l.areasymbol
    FROM mapunit mu JOIN legend l ON l.lkey = mu.lkey
    WHERE l.areasymbol IN (${areaList})
  `).all();
  const insertUnit = out.prepare('INSERT INTO mapunit VALUES (?, ?, ?, ?)');
  for (const u of units) insertUnit.run(u.mukey, u.musym, u.muname, u.areasymbol);

  const components = source.prepare(`
    SELECT c.mukey, c.comppct_r, c.slope_l, c.slope_r, c.slope_h,
           c.drainagecl, c.hydgrp, c.hydricrating, c.taxorder, c.taxsubgrp
    FROM component c
    JOIN mapunit mu ON mu.mukey = c.mukey
    JOIN legend l ON l.lkey = mu.lkey
    WHERE l.areasymbol IN (${areaList}) AND c.majcompflag = 'Yes'
  `).all();
  const insertComponent = out.prepare('INSERT INTO component VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  for (const c of components) {
    insertComponent.run(
      c.mukey, c.comppct_r, c.slope_l, c.slope_r, c.slope_h,
      c.drainagecl, c.hydgrp, c.hydricrating, c.taxorder, c.taxsubgrp
    );
  }

  const insertPolygon = out.prepare('INSERT INTO polygon (id, mukey, geom) VALUES (?, ?, ?)');
  const insertIndex = out.prepare('INSERT INTO polygon_index VALUES (?, ?, ?, ?, ?)');
  const shapes = source.prepare(`SELECT mukey, shape FROM mupolygon WHERE areasymbol IN (${areaList})`);

  let polygonId = 0;
  let sourceVertices = 0;
  let keptVertices = 0;

  for (const row of shapes.iterate()) {
    const blob = Buffer.from(row.shape);
    for (const rings of readWkbPolygons(blob, gpkgToWkbOffset(blob))) {
      const simplified = rings.map(ring => {
        sourceVertices += ring.length;
        const s = simplifyRing(ring, tolerance);
        keptVertices += s.length;
        return s;
      });
      const b = ringBounds(simplified[0]);
      polygonId += 1;
      insertPolygon.run(polygonId, row.mukey, encodePolygon(simplified));
      insertIndex.run(polygonId, b.minX, b.maxX, b.minY, b.maxY);
    }
  }

  out.exec('COMMIT');
  out.exec('VACUUM');
  out.close();
  source.close();

  const sizeMb = (fs.statSync(OUTPUT).size / 1048576).toFixed(1);
  console.log(`Map units: ${units.length}, major components: ${components.length}`);
  console.log(`Polygons: ${polygonId}, vertices: ${sourceVertices} -> ${keptVertices} (tolerance ${tolerance}°, grid ${1 / COORD_SCALE}°)`);
  console.log(`Wrote ${OUTPUT} (${sizeMb} MB)`);
}

if (require.main === module) main();

module.exports = { gpkgToWkbOffset, readWkbPolygons };
