import paper from 'paper';
import { geoToPaperPath } from './geoPathUtils';

/* ========================================
   Geometry → polygon flattening (shared by OBJ & GEO)
   ======================================== */

const FLATTEN_TOLERANCE = 1;

function flattenPaperPath(paperPath) {
  if (!paperPath) return [];
  paperPath.flatten(FLATTEN_TOLERANCE);

  if (paperPath.className === 'CompoundPath') {
    return (paperPath.children || []).map((child) => ({
      points: child.segments.map((s) => [s.point.x, s.point.y]),
      closed: child.closed,
    }));
  }
  return [{
    points: paperPath.segments.map((s) => [s.point.x, s.point.y]),
    closed: paperPath.closed,
  }];
}

function collectPolygons(geo, fill) {
  if (!geo) return [];

  const currentFill = geo.fill || fill || '#cccccc';

  if (geo.type === 'group' || geo.type === 'boolean') {
    const results = [];
    for (const child of (geo.children || [])) {
      results.push(...collectPolygons(child, currentFill));
    }
    return results;
  }

  const pp = geoToPaperPath(geo);
  if (!pp) return [];
  const polys = flattenPaperPath(pp);
  pp.remove();
  return polys.map((p) => ({ ...p, fill: currentFill, layer: geo.layer ?? 0 }));
}

function hexToRgb01(hex) {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16) / 255;
  const g = parseInt(h.substring(2, 4), 16) / 255;
  const b = parseInt(h.substring(4, 6), 16) / 255;
  return [r, g, b];
}

/* ========================================
   OBJ Export
   ======================================== */

export function exportOBJ(geometry, params) {
  const { filename = 'export' } = params;
  const polys = collectPolygons(geometry, '#cccccc');
  if (polys.length === 0) return;

  const lines = ['# Wavefront OBJ – exported from 2Dni', `# ${polys.length} polygon(s)`, ''];
  let vertexOffset = 1;

  for (let pi = 0; pi < polys.length; pi++) {
    const poly = polys[pi];
    if (poly.points.length < 2) continue;
    lines.push(`g piece_${pi}`);
    for (const [x, y] of poly.points) {
      lines.push(`v ${x.toFixed(4)} ${(-y).toFixed(4)} 0.0000`);
    }
    const n = poly.points.length;
    if (poly.closed && n >= 3) {
      const face = [];
      for (let i = 0; i < n; i++) face.push(vertexOffset + i);
      lines.push(`f ${face.join(' ')}`);
    } else {
      for (let i = 0; i < n - 1; i++) {
        lines.push(`l ${vertexOffset + i} ${vertexOffset + i + 1}`);
      }
    }
    lines.push('');
    vertexOffset += n;
  }

  downloadFile(lines.join('\n'), `${filename}.obj`, 'text/plain');
}

/* ========================================
   Houdini .geo JSON Export
   ======================================== */

export function exportGEO(geometry, params) {
  const { filename = 'export' } = params;
  const polys = collectPolygons(geometry, '#cccccc');
  if (polys.length === 0) return;

  const allPoints = [];
  const allColors = [];
  const allLayers = [];
  const primitives = [];
  let globalVtx = 0;

  for (const poly of polys) {
    if (poly.points.length < 2) continue;
    const startVtx = globalVtx;
    const [cr, cg, cb] = hexToRgb01(poly.fill);

    for (const [x, y] of poly.points) {
      allPoints.push(x, -y, 0);
      allColors.push(cr, cg, cb);
      allLayers.push(poly.layer);
      globalVtx++;
    }

    const verts = [];
    for (let i = startVtx; i < globalVtx; i++) verts.push(i);

    primitives.push({
      type: poly.closed ? 'Poly' : 'PolyLine',
      vertices: verts,
      closed: poly.closed,
    });
  }

  const pointCount = globalVtx;
  const vertexCount = globalVtx;

  const geo = {
    fileversion: '18.5.351',
    hasindex: false,
    pointcount: pointCount,
    vertexcount: vertexCount,
    primitivecount: primitives.length,
    info: { software: '2Dni', artist: 'Exported from 2Dni node editor' },
    topology: {
      pointref: { indices: Array.from({ length: vertexCount }, (_, i) => i) },
    },
    attributes: {
      pointattributes: [
        {
          scope: 'public',
          type: 'numeric',
          name: 'P',
          options: { type: { type: 'string', value: 'point' } },
          values: {
            size: 3,
            storage: 'fpreal32',
            tuples: chunkArray(allPoints, 3),
          },
        },
        {
          scope: 'public',
          type: 'numeric',
          name: 'Cd',
          options: { type: { type: 'string', value: 'color' } },
          values: {
            size: 3,
            storage: 'fpreal32',
            tuples: chunkArray(allColors, 3),
          },
        },
        {
          scope: 'public',
          type: 'numeric',
          name: 'layer',
          options: {},
          values: {
            size: 1,
            storage: 'int32',
            tuples: allLayers.map((v) => [v]),
          },
        },
      ],
    },
    primitives: primitives.map((prim) => [
      prim.closed ? 'run' : 'run',
      'Poly',
      {
        vertex: prim.vertices,
        closed: prim.closed,
      },
    ]),
  };

  downloadFile(JSON.stringify(geo, null, 2), `${filename}.geo`, 'application/json');
}

function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size).map((v) => Math.round(v * 10000) / 10000));
  }
  return result;
}

/* ========================================
   SVG Export
   ======================================== */

export function exportSVG(geometry, params) {
  const {
    canvasWidth = 1920,
    canvasHeight = 1080,
    backgroundColor = '#ffffff',
    filename = 'export',
  } = params;

  const svgContent = geometryToSVGString(geometry);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">
  <g transform="translate(${canvasWidth / 2}, ${canvasHeight / 2})">
    ${svgContent}
  </g>
</svg>`;

  downloadFile(svg, `${filename}.svg`, 'image/svg+xml');
}

export function exportPNG(geometry, params) {
  const {
    canvasWidth = 1920,
    canvasHeight = 1080,
    backgroundColor = '#ffffff',
    filename = 'export',
  } = params;

  const svgContent = geometryToSVGString(geometry);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">
  <rect width="${canvasWidth}" height="${canvasHeight}" fill="${backgroundColor}" />
  <g transform="translate(${canvasWidth / 2}, ${canvasHeight / 2})">
    ${svgContent}
  </g>
</svg>`;

  const img = new Image();
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    canvas.toBlob((pngBlob) => {
      if (pngBlob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(pngBlob);
        a.download = `${filename}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    }, 'image/png');
  };

  img.src = url;
}

function geometryToSVGString(geo) {
  if (!geo) return '';

  switch (geo.type) {
    case 'line':
      return `<line x1="${geo.x1}" y1="${geo.y1}" x2="${geo.x2}" y2="${geo.y2}" stroke="${geo.stroke}" stroke-width="${geo.strokeWidth}" />`;

    case 'rect':
      return `<rect x="${geo.x}" y="${geo.y}" width="${geo.width}" height="${geo.height}" fill="${geo.fill}" stroke="${geo.stroke}" stroke-width="${geo.strokeWidth}" />`;

    case 'ellipse':
      return `<ellipse cx="${geo.cx}" cy="${geo.cy}" rx="${geo.rx}" ry="${geo.ry}" fill="${geo.fill}" stroke="${geo.stroke}" stroke-width="${geo.strokeWidth}" />`;

    case 'arc':
      return `<path d="${geo.pathData}" fill="${geo.fill}" stroke="${geo.stroke}" stroke-width="${geo.strokeWidth}" />`;

    case 'roundedRect': {
      const corners = geo.corners || [geo.rx, geo.rx, geo.rx, geo.rx];
      const d = exportRoundedRectPath(geo.x, geo.y, geo.width, geo.height, corners);
      return `<path d="${d}" fill="${geo.fill}" stroke="${geo.stroke}" stroke-width="${geo.strokeWidth}" />`;
    }

    case 'text': {
      const anchor = geo.textAlign === 'center' ? 'middle'
        : geo.textAlign === 'right' ? 'end' : 'start';
      const strokeAttr = geo.stroke && geo.stroke !== 'none'
        ? ` stroke="${geo.stroke}" stroke-width="${geo.strokeWidth || 0}" paint-order="stroke"`
        : '';
      return `<text x="0" y="${geo.fontSize}" font-family="${geo.fontFamily}" font-size="${geo.fontSize}" font-weight="${geo.fontWeight}" font-style="${geo.fontStyle || 'normal'}" letter-spacing="${geo.letterSpacing || 0}" text-anchor="${anchor}" fill="${geo.fill}"${strokeAttr}>${escapeXml(geo.content)}</text>`;
    }

    case 'group': {
      const { translate_x = 0, translate_y = 0, rotate = 0, scale_x = 1, scale_y = 1, pivot_x = 0, pivot_y = 0 } = geo.transform || {};
      const childSvg = (geo.children || []).map(geometryToSVGString).join('\n    ');
      return `<g transform="translate(${translate_x}, ${translate_y}) rotate(${rotate}, ${pivot_x}, ${pivot_y}) scale(${scale_x}, ${scale_y})">\n    ${childSvg}\n  </g>`;
    }

    case 'boolean': {
      const childSvg = (geo.children || []).map(geometryToSVGString).join('\n    ');
      return `<g>\n    ${childSvg}\n  </g>`;
    }

    case 'booleanResult':
      return `<path d="${geo.pathData}" fill="${geo.fill}" stroke="${geo.stroke}" stroke-width="${geo.strokeWidth}" />`;

    case 'export':
      return geometryToSVGString(geo.geometry);

    default:
      return '';
  }
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportRoundedRectPath(x, y, w, h, corners) {
  const [tl, tr, br, bl] = corners;
  return [
    `M ${x + tl} ${y}`,
    `L ${x + w - tr} ${y}`,
    tr > 0 ? `A ${tr} ${tr} 0 0 1 ${x + w} ${y + tr}` : `L ${x + w} ${y}`,
    `L ${x + w} ${y + h - br}`,
    br > 0 ? `A ${br} ${br} 0 0 1 ${x + w - br} ${y + h}` : `L ${x + w} ${y + h}`,
    `L ${x + bl} ${y + h}`,
    bl > 0 ? `A ${bl} ${bl} 0 0 1 ${x} ${y + h - bl}` : `L ${x} ${y + h}`,
    `L ${x} ${y + tl}`,
    tl > 0 ? `A ${tl} ${tl} 0 0 1 ${x + tl} ${y}` : `L ${x} ${y}`,
    'Z',
  ].join(' ');
}
