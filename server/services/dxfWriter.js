/**
 * Minimal DXF R12 (AC1009) writer — the most widely readable flavor
 * (AutoCAD, Civil 3D, Revit import, MicroStation, BricsCAD, QGIS, LibreCAD).
 */

const R12_LAYER_NAME = /[^A-Z0-9_$-]/g;

function cleanLayerName(name) {
  return String(name).toUpperCase().replace(R12_LAYER_NAME, '_');
}

/** R12 text is ASCII-only; drop anything else rather than corrupt the file. */
function cleanText(text) {
  return String(text ?? '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]/g, '')
    .trim();
}

function fmt(value) {
  return Number(value).toFixed(3);
}

function createDxf() {
  const layers = new Map();
  const entities = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const extend = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  return {
    /** color: AutoCAD Color Index (1 red, 3 green, 4 cyan, 5 blue, 7 white/black, 8 gray). */
    addLayer(name, color) {
      layers.set(cleanLayerName(name), color);
    },

    addPolyline(layer, points, closed = false) {
      if (!points || points.length < 2) return;
      const name = cleanLayerName(layer);
      const lines = ['0', 'POLYLINE', '8', name, '66', '1', '70', closed ? '1' : '0', '10', '0.0', '20', '0.0', '30', '0.0'];
      for (const [x, y] of points) {
        extend(x, y);
        lines.push('0', 'VERTEX', '8', name, '10', fmt(x), '20', fmt(y), '30', '0.0');
      }
      lines.push('0', 'SEQEND', '8', name);
      entities.push(lines);
    },

    addText(layer, [x, y], height, text) {
      const value = cleanText(text);
      if (!value) return;
      const name = cleanLayerName(layer);
      extend(x, y);
      entities.push([
        '0', 'TEXT', '8', name,
        '10', fmt(x), '20', fmt(y), '30', '0.0',
        '40', fmt(height),
        '1', value,
        '72', '1',
        '73', '2',
        '11', fmt(x), '21', fmt(y), '31', '0.0',
      ]);
    },

    /** Left-aligned text, for the notes block. */
    addTextLeft(layer, [x, y], height, text) {
      const value = cleanText(text);
      if (!value) return;
      extend(x, y);
      extend(x + value.length * height * 0.8, y + height);
      entities.push([
        '0', 'TEXT', '8', cleanLayerName(layer),
        '10', fmt(x), '20', fmt(y), '30', '0.0',
        '40', fmt(height),
        '1', value,
      ]);
    },

    toString() {
      const hasExtents = Number.isFinite(minX);
      const extMinX = hasExtents ? minX : 0;
      const extMinY = hasExtents ? minY : 0;
      const extMaxX = hasExtents ? maxX : 1;
      const extMaxY = hasExtents ? maxY : 1;
      // State Plane coordinates are millions of feet from the origin. AutoCAD opens a
      // DXF at its saved view, which defaults to 0,0, so the drawing looks empty until
      // someone types ZOOM EXTENTS. Frame the opening view on the geometry instead.
      const viewCenterX = (extMinX + extMaxX) / 2;
      const viewCenterY = (extMinY + extMaxY) / 2;
      const viewHeight = Math.max(extMaxX - extMinX, extMaxY - extMinY, 1) * 1.2;

      const out = [
        '0', 'SECTION', '2', 'HEADER',
        '9', '$ACADVER', '1', 'AC1009',
        '9', '$INSUNITS', '70', '2',
        '9', '$EXTMIN', '10', fmt(extMinX), '20', fmt(extMinY), '30', '0.0',
        '9', '$EXTMAX', '10', fmt(extMaxX), '20', fmt(extMaxY), '30', '0.0',
        '9', '$LIMMIN', '10', fmt(extMinX), '20', fmt(extMinY),
        '9', '$LIMMAX', '10', fmt(extMaxX), '20', fmt(extMaxY),
        '9', '$VIEWCTR', '10', fmt(viewCenterX), '20', fmt(viewCenterY),
        '9', '$VIEWSIZE', '40', fmt(viewHeight),
        '9', '$VIEWDIR', '10', '0.0', '20', '0.0', '30', '1.0',
        '0', 'ENDSEC',
        '0', 'SECTION', '2', 'TABLES',
        '0', 'TABLE', '2', 'VPORT', '70', '1',
        '0', 'VPORT', '2', '*ACTIVE', '70', '0',
        '10', '0.0', '20', '0.0',
        '11', '1.0', '21', '1.0',
        '12', fmt(viewCenterX), '22', fmt(viewCenterY),
        '13', '0.0', '23', '0.0',
        '14', '1.0', '24', '1.0',
        '15', '10.0', '25', '10.0',
        '16', '0.0', '26', '0.0', '36', '1.0',
        '17', '0.0', '27', '0.0', '37', '0.0',
        '40', fmt(viewHeight),
        '41', '1.6',
        '42', '50.0',
        '43', '0.0',
        '44', '0.0',
        '50', '0.0',
        '51', '0.0',
        '71', '0',
        '72', '100',
        '73', '1',
        '74', '3',
        '75', '0',
        '76', '1',
        '77', '0',
        '78', '0',
        '0', 'ENDTAB',
        '0', 'TABLE', '2', 'LTYPE', '70', '1',
        '0', 'LTYPE', '2', 'CONTINUOUS', '70', '0', '3', 'Solid line', '72', '65', '73', '0', '40', '0.0',
        '0', 'ENDTAB',
        '0', 'TABLE', '2', 'LAYER', '70', String(layers.size + 1),
        '0', 'LAYER', '2', '0', '70', '0', '62', '7', '6', 'CONTINUOUS',
      ];
      for (const [name, color] of layers) {
        out.push('0', 'LAYER', '2', name, '70', '0', '62', String(color), '6', 'CONTINUOUS');
      }
      out.push(
        '0', 'ENDTAB',
        '0', 'TABLE', '2', 'STYLE', '70', '1',
        '0', 'STYLE', '2', 'STANDARD', '70', '0',
        '40', '0.0', '41', '1.0', '50', '0.0', '71', '0', '42', '0.2',
        '3', 'txt',
        '0', 'ENDTAB',
        '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'
      );
      for (const entity of entities) out.push(...entity);
      out.push('0', 'ENDSEC', '0', 'EOF');
      return `${out.join('\r\n')}\r\n`;
    },
  };
}

module.exports = { createDxf };
