import paper from 'paper';
import { geoToPaperPath } from './geoPathUtils';

/* ========================================
   Geometry → polygon flattening (shared by OBJ & GEO)
   ======================================== */

const FLATTEN_TOLERANCE = 0.1;

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

  const pointTuples = [];
  const colorTuples = [];
  const layerTuples = [];
  const vertexIndices = [];
  const primVertCounts = [];
  let globalPt = 0;

  for (const poly of polys) {
    if (poly.points.length < 2) continue;
    const [cr, cg, cb] = hexToRgb01(poly.fill);
    const startPt = globalPt;

    for (const [x, y] of poly.points) {
      pointTuples.push([round4(x), round4(-y), 0]);
      colorTuples.push([round4(cr), round4(cg), round4(cb)]);
      layerTuples.push([poly.layer]);
      vertexIndices.push(globalPt);
      globalPt++;
    }

    primVertCounts.push(globalPt - startPt);
  }

  const pointCount = globalPt;
  const vertexCount = vertexIndices.length;
  const primitiveCount = primVertCounts.length;
  const nverticesRle = buildRle(primVertCounts);

  const geoArray = [
    'fileversion', '20.0.547',
    'hasindex', false,
    'pointcount', pointCount,
    'vertexcount', vertexCount,
    'primitivecount', primitiveCount,
    'info', {
      software: '2Dni',
      artist: 'Exported from 2Dni node editor',
    },
    'topology', [
      'pointref', [
        'indices', vertexIndices,
      ],
    ],
    'attributes', [
      'pointattributes', [
        [
          [
            'scope', 'public',
            'type', 'numeric',
            'name', 'P',
            'options', {
              type: { type: 'string', value: 'point' },
            },
          ],
          [
            'size', 3,
            'storage', 'fpreal32',
            'defaults', [
              'size', 1,
              'storage', 'fpreal64',
              'values', [0],
            ],
            'values', [
              'size', 3,
              'storage', 'fpreal32',
              'tuples', pointTuples,
            ],
          ],
        ],
        [
          [
            'scope', 'public',
            'type', 'numeric',
            'name', 'Cd',
            'options', {
              type: { type: 'string', value: 'color' },
            },
          ],
          [
            'size', 3,
            'storage', 'fpreal32',
            'defaults', [
              'size', 1,
              'storage', 'fpreal64',
              'values', [1],
            ],
            'values', [
              'size', 3,
              'storage', 'fpreal32',
              'tuples', colorTuples,
            ],
          ],
        ],
        [
          [
            'scope', 'public',
            'type', 'numeric',
            'name', 'layer',
            'options', {},
          ],
          [
            'size', 1,
            'storage', 'int32',
            'defaults', [
              'size', 1,
              'storage', 'int32',
              'values', [0],
            ],
            'values', [
              'size', 1,
              'storage', 'int32',
              'tuples', layerTuples,
            ],
          ],
        ],
      ],
    ],
    'primitives', [
      [
        [
          'type', 'Polygon_run',
        ],
        [
          'startvertex', 0,
          'nprimitives', primitiveCount,
          'nvertices_rle', nverticesRle,
        ],
      ],
    ],
  ];

  downloadFile(JSON.stringify(geoArray, null, '\t'), `${filename}.geo`, 'application/json');
}

function round4(v) {
  return Math.round(v * 10000) / 10000;
}

function buildRle(counts) {
  if (counts.length === 0) return [];
  const rle = [];
  let i = 0;
  while (i < counts.length) {
    const val = counts[i];
    let run = 1;
    while (i + run < counts.length && counts[i + run] === val) run++;
    rle.push(val, run);
    i += run;
  }
  return rle;
}

function chunkArray(arr, size) {
  const result = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size).map((v) => Math.round(v * 10000) / 10000));
  }
  return result;
}

/* ========================================
   Geometry bounding-box (for centering exports)
   ======================================== */

function mergeBox(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

export function computeGeoBounds(geo) {
  if (!geo) return null;

  if (geo.bounds && geo.type !== 'group' && geo.type !== 'boolean' && geo.type !== 'export') {
    const b = geo.bounds;
    return { minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height };
  }

  switch (geo.type) {
    case 'line':
      return {
        minX: Math.min(geo.x1, geo.x2),
        minY: Math.min(geo.y1, geo.y2),
        maxX: Math.max(geo.x1, geo.x2),
        maxY: Math.max(geo.y1, geo.y2),
      };

    case 'rect':
    case 'roundedRect':
    case 'image':
      return {
        minX: geo.x ?? 0,
        minY: geo.y ?? 0,
        maxX: (geo.x ?? 0) + (geo.width ?? 0),
        maxY: (geo.y ?? 0) + (geo.height ?? 0),
      };

    case 'ellipse':
      return {
        minX: (geo.cx ?? 0) - (geo.rx ?? 0),
        minY: (geo.cy ?? 0) - (geo.ry ?? 0),
        maxX: (geo.cx ?? 0) + (geo.rx ?? 0),
        maxY: (geo.cy ?? 0) + (geo.ry ?? 0),
      };

    case 'arc':
    case 'booleanResult': {
      const pp = geo.pathData ? geoToPaperPath(geo) : null;
      if (!pp) return null;
      const b = pp.bounds;
      pp.remove();
      return { minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height };
    }

    case 'text': {
      const pp = geoToPaperPath(geo);
      if (!pp) {
        const w = (geo.fontSize ?? 16) * (geo.content?.length ?? 1) * 0.6;
        const h = geo.fontSize ?? 16;
        return { minX: 0, minY: 0, maxX: w, maxY: h };
      }
      const b = pp.bounds;
      pp.remove();
      return { minX: b.x, minY: b.y, maxX: b.x + b.width, maxY: b.y + b.height };
    }

    case 'group': {
      let box = null;
      for (const child of (geo.children || [])) {
        box = mergeBox(box, computeGeoBounds(child));
      }
      if (!box) return null;
      const t = geo.transform || {};
      const tx = t.translate_x ?? 0;
      const ty = t.translate_y ?? 0;
      const sx = t.scale_x ?? 1;
      const sy = t.scale_y ?? 1;
      box.minX = box.minX * sx + tx;
      box.maxX = box.maxX * sx + tx;
      box.minY = box.minY * sy + ty;
      box.maxY = box.maxY * sy + ty;
      if (sx < 0) { const tmp = box.minX; box.minX = box.maxX; box.maxX = tmp; }
      if (sy < 0) { const tmp = box.minY; box.minY = box.maxY; box.maxY = tmp; }
      return box;
    }

    case 'boolean': {
      let box = null;
      for (const child of (geo.children || [])) {
        box = mergeBox(box, computeGeoBounds(child));
      }
      return box;
    }

    case 'export':
      return computeGeoBounds(geo.geometry);

    default:
      return null;
  }
}

export function centerTranslate(geo, canvasWidth, canvasHeight, offsetX = 0, offsetY = 0, zoom = 1) {
  const bounds = computeGeoBounds(geo);
  if (!bounds) return { tx: canvasWidth / 2 + offsetX, ty: canvasHeight / 2 + offsetY, zoom };
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  return { tx: canvasWidth / 2 - cx * zoom + offsetX, ty: canvasHeight / 2 - cy * zoom + offsetY, zoom };
}

function buildTransform(geo, canvasWidth, canvasHeight, offsetX, offsetY, zoom) {
  const { tx, ty, zoom: z } = centerTranslate(geo, canvasWidth, canvasHeight, offsetX, offsetY, zoom);
  if (z === 1) return `translate(${tx}, ${ty})`;
  return `translate(${tx}, ${ty}) scale(${z})`;
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
    offsetX = 0,
    offsetY = 0,
    zoom = 1,
  } = params;

  const svgContent = geometryToSVGString(geometry);
  const xform = buildTransform(geometry, canvasWidth, canvasHeight, offsetX, offsetY, zoom);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">
  <g transform="${xform}">
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
    offsetX = 0,
    offsetY = 0,
    zoom = 1,
  } = params;

  const svgContent = geometryToSVGString(geometry);
  const xform = buildTransform(geometry, canvasWidth, canvasHeight, offsetX, offsetY, zoom);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">
  <rect width="${canvasWidth}" height="${canvasHeight}" fill="${backgroundColor}" />
  <g transform="${xform}">
    ${svgContent}
  </g>
</svg>`;

  rasterizeAndDownload(svg, canvasWidth, canvasHeight, `${filename}.png`, 'image/png');
}

export function exportJPEG(geometry, params) {
  const {
    canvasWidth = 1920,
    canvasHeight = 1080,
    backgroundColor = '#ffffff',
    jpegQuality = 92,
    filename = 'export',
    offsetX = 0,
    offsetY = 0,
    zoom = 1,
  } = params;

  const svgContent = geometryToSVGString(geometry);
  const xform = buildTransform(geometry, canvasWidth, canvasHeight, offsetX, offsetY, zoom);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">
  <rect width="${canvasWidth}" height="${canvasHeight}" fill="${backgroundColor}" />
  <g transform="${xform}">
    ${svgContent}
  </g>
</svg>`;

  rasterizeAndDownload(svg, canvasWidth, canvasHeight, `${filename}.jpg`, 'image/jpeg', jpegQuality / 100);
}

function rasterizeAndDownload(svgStr, width, height, outFilename, mimeType, quality) {
  const img = new Image();
  const blob = new Blob([svgStr], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (mimeType === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
    }
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    canvas.toBlob((outBlob) => {
      if (outBlob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(outBlob);
        a.download = outFilename;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    }, mimeType, quality);
  };

  img.src = url;
}

function sortChildrenByLayer(children) {
  const hasLayers = children.some((c) => c && c.layer != null);
  if (!hasLayers) return children;
  return [...children].sort((a, b) => (a?.layer ?? 0) - (b?.layer ?? 0));
}

function geometryToSVGString(geo) {
  if (!geo) return '';

  const opAttr = geo.opacity != null && geo.opacity !== 1 ? ` opacity="${geo.opacity}"` : '';

  switch (geo.type) {
    case 'line':
      return `<line x1="${geo.x1}" y1="${geo.y1}" x2="${geo.x2}" y2="${geo.y2}" stroke="${geo.stroke}" stroke-width="${geo.strokeWidth}"${opAttr} />`;

    case 'rect':
      return `<rect x="${geo.x}" y="${geo.y}" width="${geo.width}" height="${geo.height}" fill="${geo.fill}" stroke="${geo.stroke}" stroke-width="${geo.strokeWidth}"${opAttr} />`;

    case 'ellipse':
      return `<ellipse cx="${geo.cx}" cy="${geo.cy}" rx="${geo.rx}" ry="${geo.ry}" fill="${geo.fill}" stroke="${geo.stroke}" stroke-width="${geo.strokeWidth}"${opAttr} />`;

    case 'arc':
      return `<path d="${geo.pathData}" fill="${geo.fill}" stroke="${geo.stroke}" stroke-width="${geo.strokeWidth}"${opAttr} />`;

    case 'roundedRect': {
      const corners = geo.corners || [geo.rx, geo.rx, geo.rx, geo.rx];
      const d = exportRoundedRectPath(geo.x, geo.y, geo.width, geo.height, corners);
      return `<path d="${d}" fill="${geo.fill}" stroke="${geo.stroke}" stroke-width="${geo.strokeWidth}"${opAttr} />`;
    }

    case 'text': {
      const anchor = geo.textAlign === 'center' ? 'middle'
        : geo.textAlign === 'right' ? 'end' : 'start';
      const strokeAttr = geo.stroke && geo.stroke !== 'none'
        ? ` stroke="${geo.stroke}" stroke-width="${geo.strokeWidth || 0}" paint-order="stroke"`
        : '';
      return `<text x="0" y="${geo.fontSize}" font-family="${geo.fontFamily}" font-size="${geo.fontSize}" font-weight="${geo.fontWeight}" font-style="${geo.fontStyle || 'normal'}" letter-spacing="${geo.letterSpacing || 0}" text-anchor="${anchor}" fill="${geo.fill}"${strokeAttr}${opAttr}>${escapeXml(geo.content)}</text>`;
    }

    case 'group': {
      const { translate_x = 0, translate_y = 0, rotate = 0, scale_x = 1, scale_y = 1, pivot_x = 0, pivot_y = 0 } = geo.transform || {};
      const sorted = sortChildrenByLayer(geo.children || []);
      const childSvg = sorted.map(geometryToSVGString).join('\n    ');
      return `<g transform="translate(${translate_x}, ${translate_y}) rotate(${rotate}, ${pivot_x}, ${pivot_y}) scale(${scale_x}, ${scale_y})"${opAttr}>\n    ${childSvg}\n  </g>`;
    }

    case 'boolean': {
      const sorted = sortChildrenByLayer(geo.children || []);
      const childSvg = sorted.map(geometryToSVGString).join('\n    ');
      return `<g${opAttr}>\n    ${childSvg}\n  </g>`;
    }

    case 'booleanResult':
      return `<path d="${geo.pathData}" fill="${geo.fill}" stroke="${geo.stroke}" stroke-width="${geo.strokeWidth}"${opAttr} />`;

    case 'image':
      if (geo.dataUrl) {
        return `<image href="${geo.dataUrl}" x="${geo.x ?? 0}" y="${geo.y ?? 0}" width="${geo.width ?? 0}" height="${geo.height ?? 0}" preserveAspectRatio="none"${opAttr} />`;
      }
      return '';

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
