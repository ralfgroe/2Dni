import paper from 'paper';
import { geoToPaperPath } from '../utils/geoPathUtils';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

function segGeo(paperPath, src, roundCaps) {
  const pathData = paperPath.pathData;
  const b = paperPath.bounds;
  return {
    type: 'booleanResult',
    pathData,
    fill: src.fill && src.fill !== 'none' ? src.fill : 'none',
    stroke: src.stroke || '#000000',
    strokeWidth: src.strokeWidth ?? 1,
    strokeLinecap: roundCaps ? 'round' : undefined,
    opacity: src.opacity,
    bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
  };
}

function dotGeo(pt, radius, src) {
  const circle = new paper.Path.Circle(pt, radius);
  const pathData = circle.pathData;
  const b = circle.bounds;
  circle.remove();
  return {
    type: 'booleanResult',
    pathData,
    fill: src.stroke || '#000000',
    stroke: 'none',
    strokeWidth: 0,
    opacity: src.opacity,
    bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
  };
}

// Walks a single paper.Path along its arc length, emitting a real geometry
// piece for every dash (or dot) so each piece is independently selectable.
function dashSinglePath(srcPath, src, opts) {
  const { style, dashLen, gapLen, roundCaps } = opts;
  const total = srcPath.length;
  if (total <= 0) return [];

  const pieces = [];
  const period = Math.max(0.01, dashLen + gapLen);

  if (style === 'Dotted') {
    // Place a real round dot at the start of every period. Dot radius tracks
    // half the stroke width so it visually matches the old shader dotted line.
    const r = Math.max(0.4, (src.strokeWidth ?? 1) / 2);
    for (let d = 0; d <= total; d += period) {
      const pt = srcPath.getPointAt(Math.min(d, total));
      if (pt) pieces.push(dotGeo(pt, r, src));
    }
    return pieces;
  }

  // Dashed: build a real polyline sub-path for each dash run by sampling points
  // along the source path between the dash's start and end offsets.
  let d = 0;
  while (d < total) {
    const start = d;
    const end = Math.min(d + dashLen, total);
    const runLen = end - start;
    if (runLen > 0.01) {
      const piece = new paper.Path();
      const steps = Math.max(2, Math.ceil(runLen / 2));
      for (let s = 0; s <= steps; s++) {
        const off = start + (runLen * s) / steps;
        const pt = srcPath.getPointAt(Math.min(off, total));
        if (pt) piece.add(pt);
      }
      if (piece.segments.length >= 2) {
        pieces.push(segGeo(piece, src, roundCaps));
      }
      piece.remove();
    }
    d += period;
  }
  return pieces;
}

function geoToPieces(geo, opts) {
  if (!geo) return [];

  if ((geo.type === 'group' || geo.type === 'boolean') && Array.isArray(geo.children)) {
    const out = [];
    for (const child of geo.children) out.push(...geoToPieces(child, opts));
    return out;
  }

  const paperPath = geoToPaperPath(geo);
  if (!paperPath) return [];

  const children = paperPath instanceof paper.CompoundPath
    ? [...paperPath.children]
    : [paperPath];

  const pieces = [];
  for (const child of children) {
    pieces.push(...dashSinglePath(child, geo, opts));
  }
  paperPath.remove();
  return pieces;
}

export function dashesRuntime(params, inputs) {
  ensurePaper();

  const geo = inputs?.geometry_in;
  if (!geo) return null;

  const opts = {
    style: params.style ?? 'Dashed',
    dashLen: Math.max(0.1, params.dash_length ?? 8),
    gapLen: Math.max(0, params.gap_length ?? 8),
    roundCaps: params.round_caps ?? true,
  };

  const pieces = geoToPieces(geo, opts);
  if (pieces.length === 0) return geo;

  const bs = pieces.map((c) => c.bounds).filter(Boolean);
  const minX = bs.length ? Math.min(...bs.map((b) => b.x)) : 0;
  const minY = bs.length ? Math.min(...bs.map((b) => b.y)) : 0;
  const maxX = bs.length ? Math.max(...bs.map((b) => b.x + b.width)) : 0;
  const maxY = bs.length ? Math.max(...bs.map((b) => b.y + b.height)) : 0;

  return {
    type: 'group',
    children: pieces,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}
