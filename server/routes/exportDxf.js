const express = require('express');
const axios = require('axios');
const { COUNTIES } = require('../config/counties');
const { normalizeParcelProps, escapeArcGIS } = require('../services/parcelRecords');
const { createDxf } = require('../services/dxfWriter');

const router = express.Router();

// NAD83 / Pennsylvania South (ftUS). Each source projects from its own native NAD83
// data, so lines match county CAD/survey coordinates without a WGS84 datum shift.
const STATE_PLANE_WKID = 2272;
const QUERY_TIMEOUT = 25000;

const FEMA_ENDPOINT = 'https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query';
const NWI_ENDPOINT =
  'https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0/query';

const LAYERS = {
  parcel: ['SS-PARCEL', 7],
  parcelText: ['SS-PARCEL-TEXT', 7],
  adjacent: ['SS-ADJ-PARCELS', 8],
  adjacentText: ['SS-ADJ-PARCELS-TEXT', 8],
  floodway: ['SS-FLOODWAY', 1],
  sfha: ['SS-FLOOD-1PCT', 5],
  flood02: ['SS-FLOOD-0_2PCT', 4],
  floodText: ['SS-FLOOD-TEXT', 5],
  wetlands: ['SS-WETLANDS', 3],
  wetlandsText: ['SS-WETLANDS-TEXT', 3],
  notes: ['SS-NOTES', 7],
};

async function queryEsriJson(endpoint, params, attempt = 1) {
  try {
    const { data } = await axios.get(endpoint, {
      params: { ...params, outSR: STATE_PLANE_WKID, f: 'json' },
      timeout: QUERY_TIMEOUT,
    });
    if (data?.error) throw new Error(data.error.message || 'ArcGIS query error');
    return data.features || [];
  } catch (err) {
    const transient = !err.response || err.response.status >= 500;
    if (attempt < 2 && transient && err.code !== 'ECONNABORTED') {
      return queryEsriJson(endpoint, params, attempt + 1);
    }
    throw err;
  }
}

function envelopeParams(rect) {
  return {
    geometry: JSON.stringify({ ...rect, spatialReference: { wkid: STATE_PLANE_WKID } }),
    geometryType: 'esriGeometryEnvelope',
    inSR: STATE_PLANE_WKID,
    spatialRel: 'esriSpatialRelIntersects',
  };
}

function ringsBounds(rings) {
  let xmin = Infinity;
  let ymin = Infinity;
  let xmax = -Infinity;
  let ymax = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < xmin) xmin = x;
      if (y < ymin) ymin = y;
      if (x > xmax) xmax = x;
      if (y > ymax) ymax = y;
    }
  }
  return { xmin, ymin, xmax, ymax };
}

/** Area-weighted centroid of the largest ring — good label anchor for parcels. */
function ringsLabelPoint(rings) {
  let best = null;
  let bestArea = 0;
  for (const ring of rings) {
    let area = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [x0, y0] = ring[i];
      const [x1, y1] = ring[i + 1];
      const cross = x0 * y1 - x1 * y0;
      area += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
    if (Math.abs(area) > bestArea) {
      bestArea = Math.abs(area);
      best = [cx / (3 * area), cy / (3 * area)];
    }
  }
  return best;
}

/** Liang–Barsky: clip segment p→q to rect. Returns [a, b, startInside, endInside] or null. */
function clipSegment(p, q, rect) {
  const dx = q[0] - p[0];
  const dy = q[1] - p[1];
  let t0 = 0;
  let t1 = 1;
  const checks = [
    [-dx, p[0] - rect.xmin],
    [dx, rect.xmax - p[0]],
    [-dy, p[1] - rect.ymin],
    [dy, rect.ymax - p[1]],
  ];
  for (const [pp, qq] of checks) {
    if (pp === 0) {
      if (qq < 0) return null;
    } else {
      const t = qq / pp;
      if (pp < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return [
    [p[0] + t0 * dx, p[1] + t0 * dy],
    [p[0] + t1 * dx, p[1] + t1 * dy],
    t0 === 0,
    t1 === 1,
  ];
}

/**
 * Clip a ring's edges to rect, keeping only real boundary lines (no fake edges
 * along the clip box). Returns { closed: true, points } when nothing was cut,
 * otherwise open chains.
 */
function clipRing(ring, rect) {
  const chains = [];
  let current = null;
  let cut = false;
  let firstStartsAtVertex0 = false;
  let lastEndsAtClose = false;

  for (let i = 0; i < ring.length - 1; i += 1) {
    const seg = clipSegment(ring[i], ring[i + 1], rect);
    if (!seg) {
      cut = true;
      current = null;
      continue;
    }
    const [a, b, startInside, endInside] = seg;
    if (!startInside || !endInside) cut = true;
    if (current && startInside) {
      current.push(b);
    } else {
      current = [a, b];
      if (i === 0 && startInside) firstStartsAtVertex0 = true;
      chains.push(current);
    }
    if (!endInside) current = null;
    if (i === ring.length - 2) lastEndsAtClose = endInside;
  }

  if (!cut && chains.length === 1) return [{ closed: true, points: chains[0].slice(0, -1) }];

  if (chains.length > 1 && firstStartsAtVertex0 && lastEndsAtClose) {
    const last = chains.pop();
    chains[0] = [...last, ...chains[0].slice(1)];
  }
  return chains.map(points => ({ closed: false, points }));
}

function chainLength(points) {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return total;
}

/** Midpoint along the longest visible piece — where a label is actually readable. */
function chainsLabelPoint(pieces) {
  let longest = null;
  let longestLength = 0;
  for (const piece of pieces) {
    const length = chainLength(piece.points);
    if (length > longestLength) {
      longestLength = length;
      longest = piece.points;
    }
  }
  if (!longest) return null;
  let walked = 0;
  for (let i = 1; i < longest.length; i += 1) {
    const [x0, y0] = longest[i - 1];
    const [x1, y1] = longest[i];
    const seg = Math.hypot(x1 - x0, y1 - y0);
    if (walked + seg >= longestLength / 2 && seg > 0) {
      const t = (longestLength / 2 - walked) / seg;
      return [x0 + t * (x1 - x0), y0 + t * (y1 - y0)];
    }
    walked += seg;
  }
  return longest[0];
}

// Adjacent zones share boundary lines, so their labels often land on the same
// midpoint; stack later labels below earlier ones instead of overprinting.
function createLabelPlacer(spacing) {
  const placed = [];
  return point => {
    if (!point) return null;
    let [x, y] = point;
    while (placed.some(([px, py]) => Math.abs(px - x) < spacing * 8 && Math.abs(py - y) < spacing)) {
      y -= spacing;
    }
    placed.push([x, y]);
    return [x, y];
  };
}

function drawClippedRings(dxf, layer, rings, rect) {
  const pieces = rings.flatMap(ring => clipRing(ring, rect));
  for (const piece of pieces) dxf.addPolyline(layer, piece.points, piece.closed);
  return pieces;
}

function floodLayerFor(attrs) {
  const subtype = String(attrs.ZONE_SUBTY || '').toUpperCase();
  if (subtype.includes('FLOODWAY')) return 'floodway';
  if (attrs.SFHA_TF === 'T') return 'sfha';
  if (subtype.includes('0.2 PCT')) return 'flood02';
  return null;
}

function floodLabel(attrs, layerKey) {
  if (layerKey === 'floodway') return 'REGULATORY FLOODWAY';
  if (layerKey === 'flood02') return '0.2% ANNUAL CHANCE (SHADED X)';
  const bfe = Number(attrs.STATIC_BFE);
  const bfeText = Number.isFinite(bfe) && bfe > -9999 ? ` BFE ${bfe} FT` : '';
  return `ZONE ${attrs.FLD_ZONE || '?'}${bfeText}`;
}

function wetlandAttrs(attrs) {
  return {
    objectId: attrs.OBJECTID ?? attrs['Wetlands.OBJECTID'],
    code: attrs['Wetlands.ATTRIBUTE'] || attrs.ATTRIBUTE || '',
    type: attrs['Wetlands.WETLAND_TYPE'] || attrs.WETLAND_TYPE || '',
    acres: Number(attrs.ACRES ?? attrs['Wetlands.ACRES']),
  };
}

// NWI maps whole rivers as single polygons (the Susquehanna is one 67,000-acre
// feature) that the service can't return at full precision, and the query API
// can't clip. Look up attributes first, then fetch outlines only for normal-sized
// features; oversized ones are reported in the notes instead.
const NWI_MAX_DRAW_ACRES = 2000;

async function queryWetlands(clipRect) {
  const found = (await queryEsriJson(NWI_ENDPOINT, {
    ...envelopeParams(clipRect),
    outFields: '*',
    returnGeometry: false,
    resultRecordCount: 200,
  })).map(f => wetlandAttrs(f.attributes || {}));

  const drawable = found.filter(w => w.objectId != null && !(w.acres > NWI_MAX_DRAW_ACRES));
  const oversized = found.filter(w => w.acres > NWI_MAX_DRAW_ACRES);
  const features = drawable.length
    ? await queryEsriJson(NWI_ENDPOINT, {
      objectIds: drawable.map(w => w.objectId).join(','),
      outFields: '*',
      returnGeometry: true,
    })
    : [];
  return { features, oversized };
}

function safeFilename(text) {
  return String(text || 'site').replace(/[^a-z0-9]+/gi, '_').replace(/^_|_$/g, '').slice(0, 50);
}

router.get('/dxf', async (req, res) => {
  const { countyKey, parcelId, address } = req.query;
  const neighborIds = String(req.query.neighbors || '').split(',').map(s => s.trim()).filter(Boolean);
  const county = COUNTIES[countyKey];

  if (!county || !parcelId) {
    return res.status(400).json({ error: 'countyKey and parcelId are required' });
  }

  const idField = county.fields.parcelId;

  let subject;
  try {
    const features = await queryEsriJson(county.parcelEndpoint, {
      where: `${idField} = '${escapeArcGIS(parcelId)}'`,
      outFields: '*',
      returnGeometry: true,
    });
    subject = features.find(f => f.geometry?.rings?.length);
  } catch (err) {
    console.error('[exportDxf] parcel query failed:', err.message);
    return res.status(502).json({ error: 'County parcel service is not responding. Please try again.' });
  }

  if (!subject) {
    return res.status(404).json({ error: 'Parcel geometry not found for this parcel ID.' });
  }

  const subjectRings = subject.geometry.rings;
  const subjectProps = normalizeParcelProps(subject.attributes || {}, county, county.fields);
  const bounds = ringsBounds(subjectRings);
  const diag = Math.hypot(bounds.xmax - bounds.xmin, bounds.ymax - bounds.ymin);
  const margin = Math.max(300, diag * 0.5);
  const clipRect = {
    xmin: bounds.xmin - margin,
    ymin: bounds.ymin - margin,
    xmax: bounds.xmax + margin,
    ymax: bounds.ymax + margin,
  };
  const textHeight = Math.min(Math.max(diag / 45, 2.5), 60);

  const [parcelsResult, floodResult, wetlandsResult] = await Promise.allSettled([
    queryEsriJson(county.parcelEndpoint, {
      ...envelopeParams(clipRect),
      outFields: '*',
      returnGeometry: true,
      resultRecordCount: 300,
    }),
    queryEsriJson(FEMA_ENDPOINT, {
      ...envelopeParams(clipRect),
      outFields: 'FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE',
      returnGeometry: true,
      resultRecordCount: 100,
    }),
    queryWetlands(clipRect),
  ]);

  const dxf = createDxf();
  for (const [name, color] of Object.values(LAYERS)) dxf.addLayer(name, color);

  // Surrounding parcels (lines only within the export area); adjoiners get owner labels.
  const missing = [];
  if (parcelsResult.status === 'fulfilled') {
    const neighborSet = new Set(neighborIds);
    for (const feature of parcelsResult.value) {
      const rings = feature.geometry?.rings;
      const props = normalizeParcelProps(feature.attributes || {}, county, county.fields);
      if (!rings?.length || String(props.parcelId) === String(subjectProps.parcelId)) continue;
      const pieces = drawClippedRings(dxf, LAYERS.adjacent[0], rings, clipRect);
      if (!pieces.length || !neighborSet.has(String(props.parcelId))) continue;
      const anchor = ringsLabelPoint(rings);
      const inside =
        anchor &&
        anchor[0] > clipRect.xmin && anchor[0] < clipRect.xmax &&
        anchor[1] > clipRect.ymin && anchor[1] < clipRect.ymax;
      const point = inside ? anchor : chainsLabelPoint(pieces);
      if (!point) continue;
      dxf.addText(LAYERS.adjacentText[0], point, textHeight * 0.7, props.ownerName || 'UNKNOWN OWNER');
      dxf.addText(LAYERS.adjacentText[0], [point[0], point[1] - textHeight], textHeight * 0.6, props.parcelId);
    }
  } else {
    console.error('[exportDxf] surrounding parcels query failed:', parcelsResult.reason?.message);
    missing.push('adjoining parcels');
  }

  // Subject parcel — always whole and closed.
  for (const ring of subjectRings) dxf.addPolyline(LAYERS.parcel[0], ring.slice(0, -1), true);
  const subjectLabel = ringsLabelPoint(subjectRings);
  if (subjectLabel) {
    dxf.addText(LAYERS.parcelText[0], [subjectLabel[0], subjectLabel[1] + textHeight * 1.2], textHeight, subjectProps.ownerName || '');
    dxf.addText(LAYERS.parcelText[0], subjectLabel, textHeight * 0.85, `PARCEL ${subjectProps.parcelId}`);
    if (subjectProps.acreage) {
      dxf.addText(LAYERS.parcelText[0], [subjectLabel[0], subjectLabel[1] - textHeight * 1.2], textHeight * 0.85, `${subjectProps.acreage} AC (DEED)`);
    }
  }

  const placeHazardLabel = createLabelPlacer(textHeight * 1.1);
  if (floodResult.status === 'fulfilled') {
    for (const feature of floodResult.value) {
      const attrs = feature.attributes || {};
      const layerKey = floodLayerFor(attrs);
      if (!layerKey || !feature.geometry?.rings) continue;
      const pieces = drawClippedRings(dxf, LAYERS[layerKey][0], feature.geometry.rings, clipRect);
      const point = placeHazardLabel(chainsLabelPoint(pieces));
      if (point) dxf.addText(LAYERS.floodText[0], point, textHeight * 0.7, floodLabel(attrs, layerKey));
    }
  } else {
    console.error('[exportDxf] FEMA query failed:', floodResult.reason?.message);
    missing.push('FEMA flood zones');
  }

  const wetlandNotes = [];
  if (wetlandsResult.status === 'fulfilled') {
    for (const w of wetlandsResult.value.oversized) {
      wetlandNotes.push(
        `NWI ${w.code}${w.type ? ` (${w.type.toUpperCase()})` : ''}, ${Math.round(w.acres).toLocaleString('en-US')} AC, CROSSES EXPORT AREA - TOO LARGE TO DRAW`
      );
    }
    for (const feature of wetlandsResult.value.features) {
      if (!feature.geometry?.rings) continue;
      const { code, type } = wetlandAttrs(feature.attributes || {});
      const pieces = drawClippedRings(dxf, LAYERS.wetlands[0], feature.geometry.rings, clipRect);
      const point = placeHazardLabel(chainsLabelPoint(pieces));
      if (point) dxf.addText(LAYERS.wetlandsText[0], point, textHeight * 0.7, `NWI ${code}${type ? ` - ${type}` : ''}`);
    }
  } else {
    console.error('[exportDxf] NWI query failed:', wetlandsResult.reason?.message);
    missing.push('NWI wetlands');
  }

  const locality = [subjectProps.municipality, county.name, 'PA'].filter(Boolean).join(', ');
  const headline = address || subjectProps.siteAddress || '';
  const notes = [
    'SITESCOPE SITE EXPORT',
    headline,
    `PARCEL ${subjectProps.parcelId}${subjectProps.ownerName ? ` - ${subjectProps.ownerName}` : ''}`,
    headline.toUpperCase().includes(county.name.toUpperCase()) ? '' : locality,
    'COORDINATES: NAD83 PA STATE PLANE SOUTH (EPSG:2272), US SURVEY FEET',
    `SOURCES: ${county.name.toUpperCase()} GIS PARCELS, FEMA NFHL, USFWS NWI`,
    `FLOOD AND WETLAND LINES SHOWN WITHIN ${Math.round(margin)} FT OF PARCEL`,
    ...wetlandNotes,
    missing.length ? `NOT AVAILABLE AT EXPORT: ${missing.join(', ').toUpperCase()}` : '',
    `EXPORTED ${new Date().toISOString().slice(0, 10)}`,
    'GIS DATA - NOT A SURVEY. VERIFY BOUNDARIES, FLOOD ZONES AND WETLANDS.',
  ].filter(Boolean);
  const noteHeight = textHeight * 0.8;
  notes.forEach((line, i) => {
    dxf.addTextLeft(
      LAYERS.notes[0],
      [clipRect.xmin, clipRect.ymax + noteHeight * 1.6 * (notes.length - i)],
      i === 0 ? noteHeight * 1.3 : noteHeight,
      line
    );
  });

  const filename = `SiteScope_${safeFilename(subjectProps.siteAddress || address)}_${safeFilename(subjectProps.parcelId)}.dxf`;
  res.setHeader('Content-Type', 'application/dxf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
  return res.send(dxf.toString());
});

module.exports = router;
