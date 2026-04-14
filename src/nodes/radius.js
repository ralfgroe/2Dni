import paper from 'paper';
import { flattenGeoToPathData } from '../utils/geoPathUtils';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

function ensurePaper() {
  if (!paperInitialized && canvas) {
    paper.setup(canvas);
    paperInitialized = true;
  }
}

export function radiusRuntime(params, inputs) {
  const { radius = 10, point_selection = '*' } = params;
  const inputGeo = inputs.geometry_in;

  if (!inputGeo) return null;

  if (inputGeo.type === 'rect' || inputGeo.type === 'roundedRect') {
    const selected = parsePointSelection(point_selection, 4);
    const existing = inputGeo.corners || [0, 0, 0, 0];
    const corners = [
      selected.has(0) ? radius : existing[0],
      selected.has(1) ? radius : existing[1],
      selected.has(2) ? radius : existing[2],
      selected.has(3) ? radius : existing[3],
    ];

    return {
      ...inputGeo,
      type: 'roundedRect',
      corners,
      rx: radius,
      ry: radius,
    };
  }

  let workGeo = inputGeo;
  if (workGeo.type !== 'booleanResult') {
    const flattened = flattenGeoToPathData(workGeo);
    if (flattened) {
      workGeo = flattened;
    }
  }

  if (workGeo.type === 'booleanResult' && workGeo.pathData) {
    if (radius <= 0) return inputGeo;

    try {
      const result = filletPathData(workGeo.pathData, radius, point_selection);
      if (!result) {
        console.warn('[Radius] filletPathData returned null');
        return inputGeo;
      }
      console.log('[Radius] fillet applied, pathData length:', result.pathData.length, 'has C:', result.pathData.includes('C'));

      return {
        type: 'booleanResult',
        pathData: result.pathData,
        fill: workGeo.fill || inputGeo.fill || '#ffffff',
        stroke: workGeo.stroke || inputGeo.stroke || '#000000',
        strokeWidth: workGeo.strokeWidth ?? inputGeo.strokeWidth ?? 1,
        opacity: inputGeo.opacity,
        bounds: result.bounds,
      };
    } catch (e) {
      console.error('[Radius] fillet error:', e);
      return inputGeo;
    }
  }

  return {
    ...inputGeo,
    radius,
    pointSelection: point_selection,
  };
}

const SMOOTH_ANGLE_DEG = 20;

function parsePathPoints(pathData) {
  const points = [];
  let closed = false;
  const commands = pathData.match(/[MLHVCSQTAZmlhvcsqtaz][^MLHVCSQTAZmlhvcsqtaz]*/g);
  if (!commands) return { points, closed };

  let cx = 0, cy = 0;
  for (const cmd of commands) {
    const type = cmd[0];
    const nums = cmd.slice(1).trim().match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi);
    const vals = nums ? nums.map(Number) : [];

    switch (type) {
      case 'M':
        for (let i = 0; i < vals.length; i += 2) { cx = vals[i]; cy = vals[i + 1]; points.push({ x: cx, y: cy }); } break;
      case 'm':
        for (let i = 0; i < vals.length; i += 2) { cx += vals[i]; cy += vals[i + 1]; points.push({ x: cx, y: cy }); } break;
      case 'L':
        for (let i = 0; i < vals.length; i += 2) { cx = vals[i]; cy = vals[i + 1]; points.push({ x: cx, y: cy }); } break;
      case 'l':
        for (let i = 0; i < vals.length; i += 2) { cx += vals[i]; cy += vals[i + 1]; points.push({ x: cx, y: cy }); } break;
      case 'H': for (const v of vals) { cx = v; points.push({ x: cx, y: cy }); } break;
      case 'h': for (const v of vals) { cx += v; points.push({ x: cx, y: cy }); } break;
      case 'V': for (const v of vals) { cy = v; points.push({ x: cx, y: cy }); } break;
      case 'v': for (const v of vals) { cy += v; points.push({ x: cx, y: cy }); } break;
      case 'C':
        for (let i = 0; i < vals.length; i += 6) { cx = vals[i + 4]; cy = vals[i + 5]; points.push({ x: cx, y: cy }); } break;
      case 'c':
        for (let i = 0; i < vals.length; i += 6) { cx += vals[i + 4]; cy += vals[i + 5]; points.push({ x: cx, y: cy }); } break;
      case 'Z': case 'z': closed = true; break;
    }
  }
  return { points, closed };
}

function dist(a, b) {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}
function norm(v) {
  const l = Math.sqrt(v.x * v.x + v.y * v.y);
  return l < 1e-9 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
}

function filletPathData(pathData, radius, pointSel) {
  const { points: rawPts, closed } = parsePathPoints(pathData);
  if (rawPts.length < 3) return null;

  const pts = [];
  pts.push(rawPts[0]);
  for (let i = 1; i < rawPts.length; i++) {
    if (dist(rawPts[i], pts[pts.length - 1]) > 0.5) pts.push(rawPts[i]);
  }
  if (closed && pts.length > 2 && dist(pts[0], pts[pts.length - 1]) < 1) pts.pop();
  if (pts.length < 3) return null;

  const n = pts.length;
  const selected = parsePointSelection(pointSel, n);

  const segLens = [];
  for (let i = 0; i < n - 1; i++) segLens.push(dist(pts[i], pts[i + 1]));
  if (closed) segLens.push(dist(pts[n - 1], pts[0]));

  const offsets = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (!selected.has(i)) continue;
    if (!closed && (i === 0 || i === n - 1)) continue;

    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;
    const dA = norm({ x: pts[prev].x - pts[i].x, y: pts[prev].y - pts[i].y });
    const dB = norm({ x: pts[next].x - pts[i].x, y: pts[next].y - pts[i].y });
    const dot = dA.x * dB.x + dA.y * dB.y;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    if (angle < SMOOTH_ANGLE_DEG * Math.PI / 180) continue;

    const tanHalf = Math.tan(angle / 2);
    if (tanHalf < 0.001) continue;

    const segIn = closed ? segLens[(i - 1 + n) % n] : (i > 0 ? segLens[i - 1] : Infinity);
    const segOut = closed ? segLens[i] : (i < n - 1 ? segLens[i] : Infinity);
    const maxR = Math.min(segIn, segOut) * 0.45;
    const effR = Math.min(radius, maxR);
    offsets[i] = effR / tanHalf;
  }

  const numEdges = closed ? n : n - 1;
  for (let ci = 0; ci < numEdges; ci++) {
    const a = ci, b = (ci + 1) % n;
    if (offsets[a] <= 0 && offsets[b] <= 0) continue;
    const total = offsets[a] + offsets[b];
    const avail = segLens[ci] * 0.95;
    if (total > avail) {
      const s = avail / total;
      if (offsets[a] > 0) offsets[a] *= s;
      if (offsets[b] > 0) offsets[b] *= s;
    }
  }

  let d = '';
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  function trackBounds(x, y) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }

  for (let i = 0; i < n; i++) {
    const off = offsets[i];

    if (off < 0.01) {
      const { x, y } = pts[i];
      d += (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`);
      trackBounds(x, y);
      continue;
    }

    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;
    const dA = norm({ x: pts[prev].x - pts[i].x, y: pts[prev].y - pts[i].y });
    const dB = norm({ x: pts[next].x - pts[i].x, y: pts[next].y - pts[i].y });

    const pA = { x: pts[i].x + dA.x * off, y: pts[i].y + dA.y * off };
    const pB = { x: pts[i].x + dB.x * off, y: pts[i].y + dB.y * off };

    const dot = dA.x * dB.x + dA.y * dB.y;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    const arcSweep = Math.PI - angle;
    const effR = off * Math.tan(angle / 2);

    const k = (4 / 3) * Math.tan(arcSweep / 4);
    const hLen = k * effR;
    const hAx = -dA.x * hLen, hAy = -dA.y * hLen;
    const hBx = -dB.x * hLen, hBy = -dB.y * hLen;

    const cp1x = pA.x + hAx, cp1y = pA.y + hAy;
    const cp2x = pB.x + hBx, cp2y = pB.y + hBy;

    d += (i === 0 ? `M ${pA.x} ${pA.y}` : ` L ${pA.x} ${pA.y}`);
    d += ` C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${pB.x} ${pB.y}`;

    trackBounds(pA.x, pA.y);
    trackBounds(pB.x, pB.y);
    trackBounds(cp1x, cp1y);
    trackBounds(cp2x, cp2y);
  }

  if (closed) d += ' Z';

  return {
    pathData: d,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}

function parsePointSelection(sel, total) {
  if (sel === '*' || !sel || sel.trim() === '') {
    const s = new Set();
    for (let i = 0; i < total; i++) s.add(i);
    return s;
  }

  const result = new Set();
  const parts = sel.split(',').map((p) => p.trim()).filter(Boolean);
  for (const p of parts) {
    const idx = parseInt(p, 10);
    if (!isNaN(idx) && idx >= 0 && idx < total) result.add(idx);
  }
  return result;
}
