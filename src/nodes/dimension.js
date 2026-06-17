import paper from 'paper';
import { geoToPaperPath, flattenGeoToPathData } from '../utils/geoPathUtils';
import { extractPoints } from '../utils/geometryPoints';
import { filletCornersAt } from './radius';

/*
 * Clean dimensioning core.
 *
 * Single source of truth: every dimension stores the coordinates the user
 * picked (ax,ay,bx,by for linear; vx,vy,ax,ay,bx,by for angle; ax,ay for
 * radial/fillet). On each evaluation those coordinates are resolved against the
 * LIVE geometry's vertices (nearest match). The drive step and the annotation
 * step BOTH read from the same resolveAnchor result, so they can never disagree
 * (which was the root cause of every prior glitch).
 *
 * Drive model: a linear dimension moves ONLY its second vertex (B) along the
 * dimension axis so the measured span equals the typed value. A and every other
 * vertex stay fixed. Circles/ellipses scale per-axis about their centre.
 */

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

function parseDimensions(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function dist(ax, ay, bx, by) { return Math.hypot(bx - ax, by - ay); }

function fmtValue(v, decimals, units) {
  if (v == null || !isFinite(v)) return '';
  const s = Number(v).toFixed(decimals);
  return units ? `${s} ${units}` : s;
}

/* ---- geometry round-trip ---- */

function paperPathToGeo(path, source) {
  const bounds = path.bounds;
  const hasFill = source.fill && source.fill !== 'none';
  return {
    type: 'booleanResult',
    pathData: path.pathData,
    fill: hasFill ? source.fill : 'none',
    stroke: source.stroke || '#000000',
    strokeWidth: source.strokeWidth ?? 1,
    strokeLinecap: source.strokeLinecap,
    strokeLinejoin: source.strokeLinejoin,
    strokeDasharray: source.strokeDasharray,
    fillRule: source.fillRule,
    opacity: source.opacity,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}

/* ---- anchor resolution (the single source of truth) ---- */

/* Find the vertex in `pts` nearest to (x, y). */
function nearestPoint(pts, x, y) {
  if (!isFinite(x) || !isFinite(y)) return null;
  let best = null, bestD = Infinity;
  for (const p of pts) {
    const d = dist(p.x, p.y, x, y);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/* A snap tolerance scaled to the geometry so it works at any zoom/size. */
function anchorSnapTolerance(pts) {
  if (!pts || pts.length === 0) return 1;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY) || 1;
  return Math.max(2, diag * 0.05);
}

/* Resolve a dimension anchor to a live vertex.

   Vertex IDENTITY is a canonical index computed once per evaluation against the
   normalized input (see bindAnchors): the drive operations (rigid translation /
   arm rotation) never add, remove, or reorder vertices, and the pathData
   round-trip preserves segment order, so that index refers to the same corner
   after any number of edits. We therefore trust the bound index (_ai/_bi/_vi)
   first. If it is missing (not yet bound) we fall back to coordinate-nearest,
   then to the raw stored coordinate. Drive and annotation both call this, so
   they always read the identical vertex. */
function resolveAnchor(pts, dim, idxKey, xKey, yKey) {
  const boundKey = '_' + idxKey + 'i';
  const bi = dim[boundKey];
  if (Number.isInteger(bi) && bi >= 0 && bi < pts.length) {
    const p = pts[bi];
    return { x: p.x, y: p.y, idx: p.idx, sharp: p.sharp };
  }
  if (dim[xKey] != null && dim[yKey] != null) {
    const near = nearestPoint(pts, dim[xKey], dim[yKey]);
    if (near) return { x: near.x, y: near.y, idx: near.idx, sharp: near.sharp };
    return { x: dim[xKey], y: dim[yKey], idx: -1, sharp: true };
  }
  const p = pts[dim[idxKey]];
  return p ? { x: p.x, y: p.y, idx: p.idx, sharp: p.sharp } : null;
}

/* Bind each dimension's anchors to canonical vertex indices of the normalized
   input, ONCE, before any driving. After this every resolveAnchor call uses the
   stable index, so a dimension keeps referring to the same corner even though
   primitives (rect/ellipse) get reindexed when converted to a booleanResult and
   even though earlier dimensions move vertices around. Radial/fillet/arcRadius
   dims don't use vertex anchors, so they are skipped. */
function bindAnchors(canonicalPts, dims) {
  const bind = (dim, idxKey, xKey, yKey) => {
    if (dim[xKey] != null && dim[yKey] != null) {
      const near = nearestPoint(canonicalPts, dim[xKey], dim[yKey]);
      dim['_' + idxKey + 'i'] = near ? near.idx : null;
    } else if (Number.isInteger(dim[idxKey])) {
      dim['_' + idxKey + 'i'] = dim[idxKey];
    } else {
      dim['_' + idxKey + 'i'] = null;
    }
  };
  for (const dim of dims) {
    if (dim.kind === 'angle') {
      bind(dim, 'v', 'vx', 'vy');
      bind(dim, 'a', 'ax', 'ay');
      bind(dim, 'b', 'bx', 'by');
    } else if (dim.kind === 'relation' || dim.kind === 'linear' || !dim.kind) {
      bind(dim, 'a', 'ax', 'ay');
      bind(dim, 'b', 'bx', 'by');
    }
  }
}

/* Normalize any input geometry to a canonical booleanResult so its vertex order
   is fixed for the whole drive sequence. Primitives (rect/ellipse) otherwise
   get reindexed on their first conversion, which would break index identity. */
function normalizeInput(geo) {
  if (!geo) return geo;
  if (geo.type === 'booleanResult') return geo;
  ensurePaper();
  const path = geoToPaperPath(geo);
  if (!path) return geo;
  const out = paperPathToGeo(path, geo);
  path.remove();
  return out && out.pathData ? out : geo;
}

/* Resolve an angle's three points by TOPOLOGY rather than absolute coordinate.
   The corner vertex V is found by nearest match (it stays fixed), then arms A
   and B are taken as V's two adjacent vertices along the path. After driving
   rotates arm B, B is still V's neighbour, so the annotation tracks the rotated
   edge instead of re-measuring a stale stored coordinate. The stored arm
   directions only decide which neighbour is labelled A vs B (stable
   orientation); the positions used are always the live ones. Falls back to the
   plain coordinate anchors if topology can't be recovered. */
function resolveCornerArms(geo, dim) {
  ensurePaper();
  const vx = dim.vx, vy = dim.vy;
  if (vx == null || vy == null) return null;
  const path = geoToPaperPath(geo);
  if (!path) return null;
  try {
    const children = path.className === 'CompoundPath' ? (path.children || []) : [path];
    let bestSeg = null, bestD = Infinity;
    for (const child of children) {
      for (const s of child.segments) {
        const d = Math.hypot(s.point.x - vx, s.point.y - vy);
        if (d < bestD) { bestD = d; bestSeg = s; }
      }
    }
    if (!bestSeg) return null;
    const prev = bestSeg.previous;
    const next = bestSeg.next;
    if (!prev || !next) return null;
    const v = { x: bestSeg.point.x, y: bestSeg.point.y };
    const n1 = { x: prev.point.x, y: prev.point.y };
    const n2 = { x: next.point.x, y: next.point.y };
    // Decide which neighbour is arm A using the originally-picked direction, so
    // the labelled angle keeps a stable orientation across edits.
    let aDir;
    if (dim.ax != null && dim.ay != null) {
      aDir = Math.atan2(dim.ay - vy, dim.ax - vx);
    } else {
      aDir = Math.atan2(n1.y - v.y, n1.x - v.x);
    }
    const angDiff = (p, q) => {
      let d = p - q;
      while (d <= -Math.PI) d += 2 * Math.PI;
      while (d > Math.PI) d -= 2 * Math.PI;
      return Math.abs(d);
    };
    const ang1 = Math.atan2(n1.y - v.y, n1.x - v.x);
    const ang2 = Math.atan2(n2.y - v.y, n2.x - v.x);
    const a = angDiff(ang1, aDir) <= angDiff(ang2, aDir) ? n1 : n2;
    const b = a === n1 ? n2 : n1;
    return { v, a, b };
  } finally {
    path.remove();
  }
}

/* Default gap between a dimension/arc and the edge it measures, scaled to the
   geometry so it neither floats far on a small sketch nor hugs a large one. */
function autoOffset(geo, pts) {
  let diag = 0;
  const b = geo && geo.bounds;
  if (b && isFinite(b.width) && isFinite(b.height)) {
    diag = Math.hypot(b.width, b.height) || 0;
  } else if (pts && pts.length) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of pts) {
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
    }
    diag = Math.hypot(maxX - minX, maxY - minY) || 0;
  }
  if (diag > 0) return Math.min(40, Math.max(8, diag * 0.12));
  return 30;
}

/* ---- circular-shape detection (kept from the original; sound) ---- */

/* Detect the center + radius of a roughly-circular shape so radius/diameter
   and per-axis linear dimensions can drive it. */
function detectCircle(geo) {
  if (geo.type === 'ellipse') {
    return { cx: geo.cx, cy: geo.cy, r: (geo.rx + geo.ry) / 2 };
  }
  ensurePaper();
  const path = geoToPaperPath(geo);
  if (!path) return null;
  const b = path.bounds;
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  path.remove();
  return { cx, cy, r: (b.width + b.height) / 4 };
}

/* Is the shape actually round (circle/ellipse/arc) vs a sharp-cornered polygon?
   Decides whether a linear dim scales the whole shape or moves one vertex, and
   whether the Radius tool drives the shape or fillets a corner. */
export function isCircular(geo) {
  if (!geo) return false;
  if (geo.type === 'ellipse' || geo.type === 'arc') return true;
  if (geo.type === 'rect' || geo.type === 'roundedRect') return false;
  try {
    ensurePaper();
    const path = geoToPaperPath(geo);
    if (!path) return false;
    const b = path.bounds;
    const area = Math.abs(path.area);

    // A circle/ellipse is built from curved segments with (almost) no sharp
    // corners; a polygon (rect, L-shape, floorplan) is straight edges meeting at
    // sharp corners. The area ratio alone can't tell an L-shape (~0.79) from a
    // circle (~0.785), so require the outline to be mostly curved before we ever
    // treat a linear dim as a circle scale. This prevents floorplans from being
    // distorted as if they were circles.
    const segs = path.className === 'CompoundPath'
      ? (path.children || []).flatMap((c) => c.segments)
      : path.segments;
    let curved = 0, total = 0;
    for (const s of segs) {
      total++;
      const h1 = s.handleIn ? s.handleIn.length : 0;
      const h2 = s.handleOut ? s.handleOut.length : 0;
      if (h1 > 1e-3 || h2 > 1e-3) curved++;
    }
    path.remove();
    if (total === 0) return false;
    const curvedFrac = curved / total;
    if (curvedFrac < 0.6) return false; // mostly straight => polygon, not round

    if (b.width < 1e-6 || b.height < 1e-6) return false;
    const ratio = area / (b.width * b.height); // circle ~0.785, square 1.0
    return ratio > 0.70 && ratio < 0.92;
  } catch {
    return false;
  }
}

/* Solve a 3x3 linear system via Cramer's rule; returns [x,y,z] or null. */
function solve3x3(m, b) {
  const det = (a) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
    - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
    + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const D = det(m);
  if (Math.abs(D) < 1e-12) return null;
  const col = (a, i, v) => a.map((row, ri) => row.map((val, ci) => (ci === i ? v[ri] : val)));
  return [det(col(m, 0, b)) / D, det(col(m, 1, b)) / D, det(col(m, 2, b)) / D];
}

/* Circle through three points; returns {cx, cy, r} or null if collinear. */
function circleThrough3(ax, ay, bx, by, cx2, cy2) {
  const d = 2 * (ax * (by - cy2) + bx * (cy2 - ay) + cx2 * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const ax2 = ax * ax + ay * ay, bx2 = bx * bx + by * by, cx22 = cx2 * cx2 + cy2 * cy2;
  const ux = (ax2 * (by - cy2) + bx2 * (cy2 - ay) + cx22 * (ay - by)) / d;
  const uy = (ax2 * (cx2 - bx) + bx2 * (ax - cx2) + cx22 * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  if (!isFinite(r) || r < 1e-6) return null;
  return { cx: ux, cy: uy, r };
}

/* Least-squares (Kasa) circle fit over many sample points. */
function fitCircleLSQ(pts) {
  const n = pts.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    sxz += x * z; syz += y * z; sz += z;
  }
  const m = [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, n]];
  const sol = solve3x3(m, [-sxz, -syz, -sz]);
  if (!sol) return null;
  const [A, B, C] = sol;
  const cx = -A / 2, cy = -B / 2;
  const r2 = cx * cx + cy * cy - C;
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  if (!isFinite(r) || r < 1e-6) return null;
  return { cx, cy, r };
}

/* Fit a circle to the arc nearest a clicked point (measure-only radius of a
   curved sub-feature on a compound/boolean shape). */
function fitCircleAt(geo, clickX, clickY) {
  ensurePaper();
  const path = geoToPaperPath(geo);
  if (!path) return null;
  try {
    const loc = path.getNearestLocation(new paper.Point(clickX, clickY));
    if (!loc || !loc.curve) return null;
    const isCurved = (c) => {
      if (!c) return false;
      if (c.isStraight && c.isStraight()) return false;
      const h1 = c.handle1 ? c.handle1.length : 0;
      const h2 = c.handle2 ? c.handle2.length : 0;
      return h1 > 1e-6 || h2 > 1e-6;
    };
    const start = loc.curve;
    if (!isCurved(start)) return null;
    const arcCurves = [start];
    for (let c = start.next; c && c !== start && isCurved(c); c = c.next) arcCurves.push(c);
    for (let c = start.previous; c && c !== start && isCurved(c); c = c.previous) arcCurves.unshift(c);
    const samples = [];
    const perCurve = 6;
    for (const c of arcCurves) {
      for (let i = 0; i <= perCurve; i++) {
        const p = c.getPointAtTime(i / perCurve);
        samples.push([p.x, p.y]);
      }
    }
    if (samples.length < 3) return null;
    const fit = fitCircleLSQ(samples);
    if (fit) return fit;
    const a = samples[0], mid = samples[Math.floor(samples.length / 2)], z = samples[samples.length - 1];
    return circleThrough3(a[0], a[1], mid[0], mid[1], z[0], z[1]);
  } finally {
    path.remove();
  }
}

/* ---- drive primitives ---- */

/* Rigid half-space translation: shift every vertex on the mover's side of the
   dividing plane by (tx,ty). The plane passes through the pinned point (pinX,
   pinY) and is perpendicular to the push direction (ux,uy). Because an entire
   sub-chain of the polygon translates together, every edge keeps its original
   direction — a rectilinear floorplan stays rectilinear (walls remain
   orthogonal) instead of shearing, which is what moving a single shared vertex
   would do. Bezier handles travel with their anchor (Paper stores them
   relative), so curved segments that move keep their shape. */
function translateHalfSpace(geo, ux, uy, delta, pinX, pinY) {
  ensurePaper();
  if (!isFinite(ux) || !isFinite(uy) || !isFinite(delta)) return geo;
  if (Math.abs(delta) < 1e-9) return geo;
  const path = geoToPaperPath(geo);
  if (!path) return geo;

  const tx = ux * delta, ty = uy * delta;
  const eps = 1e-6;
  const move = (segs) => {
    for (const s of segs) {
      const rel = (s.point.x - pinX) * ux + (s.point.y - pinY) * uy;
      if (rel > eps) s.point = new paper.Point(s.point.x + tx, s.point.y + ty);
    }
  };
  if (path.className === 'CompoundPath') {
    for (const child of (path.children || [])) move(child.segments);
  } else {
    move(path.segments);
  }
  const out = paperPathToGeo(path, geo);
  path.remove();
  if (!out || !out.pathData) return geo;
  return out;
}

/* Scale about a pivot (drives radius/diameter and round-shape linear dims). */
function scaleGeo(geo, sx, sy, pivotX, pivotY) {
  ensurePaper();
  if (!isFinite(sx) || !isFinite(sy) || !isFinite(pivotX) || !isFinite(pivotY)) return geo;
  if (sx === 0 || sy === 0) return geo;
  const path = geoToPaperPath(geo);
  if (!path) return geo;
  path.scale(sx, sy, new paper.Point(pivotX, pivotY));
  const out = paperPathToGeo(path, geo);
  path.remove();
  if (!out || !out.pathData) return geo;
  return out;
}

/* Rotate ONLY arm B about the vertex, leaving arm A fixed, so an angle
   dimension opens/closes the angle between two arms instead of spinning the
   whole shape. A segment belongs to arm B if its direction from the vertex is
   angularly closer to B's direction than to A's. */
function rotateArm(geo, deg, v, a, b) {
  ensurePaper();
  if (!isFinite(deg) || Math.abs(deg) < 1e-9) return geo;
  const path = geoToPaperPath(geo);
  if (!path) return geo;

  const angA = Math.atan2(a.y - v.y, a.x - v.x);
  const angB = Math.atan2(b.y - v.y, b.x - v.x);
  const angDiff = (p, q) => {
    let d = p - q;
    while (d <= -Math.PI) d += 2 * Math.PI;
    while (d > Math.PI) d -= 2 * Math.PI;
    return Math.abs(d);
  };
  const rad = deg * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const rot = (pt) => {
    const dx = pt.x - v.x, dy = pt.y - v.y;
    return new paper.Point(v.x + dx * cos - dy * sin, v.y + dx * sin + dy * cos);
  };
  const rotateSegs = (segs) => {
    for (const s of segs) {
      const dx = s.point.x - v.x, dy = s.point.y - v.y;
      if (Math.hypot(dx, dy) < 1e-6) continue;
      const ang = Math.atan2(dy, dx);
      if (angDiff(ang, angB) < angDiff(ang, angA)) s.point = rot(s.point);
    }
  };
  if (path.className === 'CompoundPath') {
    for (const child of (path.children || [])) rotateSegs(child.segments);
  } else {
    rotateSegs(path.segments);
  }
  const out = paperPathToGeo(path, geo);
  path.remove();
  if (!out || !out.pathData) return geo;
  return out;
}

/* ---- drive dispatch ---- */

/* Span of A -> B measured along the axis direction. */
function axisSpan(axis, a, b) {
  if (axis === 'horizontal') return Math.abs(b.x - a.x);
  if (axis === 'vertical') return Math.abs(b.y - a.y);
  return dist(a.x, a.y, b.x, b.y);
}

/* Pick which endpoint to pin (hold fixed) for a linear drive. We pin the side
   that has MORE of the shape's vertices, so the smaller side moves. This makes
   the result independent of the order the two points were picked, and keeps the
   bulk of a floorplan stationary while one wall is pushed out. */
function choosePin(pts, a, b, ux, uy) {
  let nA = 0, nB = 0; // vertices strictly on A-side / B-side of the mid plane
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  for (const p of pts) {
    const rel = (p.x - mx) * ux + (p.y - my) * uy;
    if (rel < -1e-6) nA++;
    else if (rel > 1e-6) nB++;
  }
  // Pin the side with more vertices; push the lighter side.
  return nA >= nB ? { pin: a, mover: b } : { pin: b, mover: a };
}

function driveLinear(geo, dim) {
  const value = dim.value;
  if (value == null || !isFinite(value) || value <= 0) return geo;
  const pts = extractPoints(geo);
  const a = resolveAnchor(pts, dim, 'a', 'ax', 'ay');
  const b = resolveAnchor(pts, dim, 'b', 'bx', 'by');
  if (!a || !b) return geo;
  const axis = dim.axis || 'aligned';

  // Round shapes: scale about centre so a horizontal + vertical pair makes an
  // ellipse and a single dim keeps the shape round, instead of tearing it. The
  // measured span is the shape's extent along the axis (diameter), not the gap
  // between two adjacent ellipse vertices.
  if (isCircular(geo)) {
    const circle = detectCircle(geo);
    if (circle && circle.r > 1e-6 && geo.bounds) {
      let current;
      if (axis === 'horizontal') current = geo.bounds.width;
      else if (axis === 'vertical') current = geo.bounds.height;
      else current = axisSpan(axis, a, b);
      if (current > 1e-6) {
        const factor = value / current;
        if (isFinite(factor) && factor > 0) {
          if (axis === 'horizontal') return scaleGeo(geo, factor, 1, circle.cx, circle.cy);
          if (axis === 'vertical') return scaleGeo(geo, 1, factor, circle.cx, circle.cy);
          return scaleGeo(geo, factor, factor, circle.cx, circle.cy);
        }
      }
    }
    return geo;
  }

  // Rigid half-space push along the axis so the span A->B becomes `value` while
  // every edge keeps its direction (orthogonal walls stay orthogonal).
  const span = axisSpan(axis, a, b);
  if (span < 1e-6) return geo;
  const delta = value - span;
  if (Math.abs(delta) < 1e-9) return geo;

  // Axis unit vector (positive sense); the push direction is from pin to mover.
  let ax, ay;
  if (axis === 'horizontal') { ax = 1; ay = 0; }
  else if (axis === 'vertical') { ax = 0; ay = 1; }
  else { const d = dist(a.x, a.y, b.x, b.y) || 1; ax = (b.x - a.x) / d; ay = (b.y - a.y) / d; }

  const { pin, mover } = choosePin(pts, a, b, ax, ay);
  // Direction from pin toward mover along the axis.
  let ux = mover.x - pin.x, uy = mover.y - pin.y;
  if (axis === 'horizontal') { ux = Math.sign(ux) || 1; uy = 0; }
  else if (axis === 'vertical') { ux = 0; uy = Math.sign(uy) || 1; }
  else { const l = Math.hypot(ux, uy) || 1; ux /= l; uy /= l; }

  // Push everything strictly beyond the pin (on the mover's side) outward by
  // delta. The plane sits at the pin, so the pinned half stays put.
  return translateHalfSpace(geo, ux, uy, delta, pin.x, pin.y);
}

function driveAngle(geo, dim) {
  const value = dim.value;
  if (value == null || !isFinite(value)) return geo;
  const pts = extractPoints(geo);
  const arms = resolveCornerArms(geo, dim);
  const v = arms ? arms.v : resolveAnchor(pts, dim, 'v', 'vx', 'vy');
  const a = arms ? arms.a : resolveAnchor(pts, dim, 'a', 'ax', 'ay');
  const b = arms ? arms.b : resolveAnchor(pts, dim, 'b', 'bx', 'by');
  if (!v || !a || !b) return geo;
  const ang1 = Math.atan2(a.y - v.y, a.x - v.x);
  const ang2 = Math.atan2(b.y - v.y, b.x - v.x);
  let current = (ang2 - ang1) * 180 / Math.PI;
  while (current <= -180) current += 360;
  while (current > 180) current -= 360;
  const currentMag = Math.abs(current);
  if (currentMag < 1e-6) return geo;
  // Rotate arm B by the signed delta so the angle between arms becomes `value`.
  // Arm A is the fixed reference; the sign preserves the current winding so B
  // opens/closes toward its existing side (never flips across A).
  const deltaDeg = (Math.sign(current) || 1) * (value - currentMag);
  if (Math.abs(deltaDeg) < 1e-6) return geo;
  return rotateArm(geo, deltaDeg, v, a, b);
}

function driveRadial(geo, dim) {
  const value = dim.value;
  if (value == null || !isFinite(value) || value <= 0) return geo;
  const circle = detectCircle(geo);
  if (!circle || circle.r < 1e-6) return geo;
  const targetR = dim.kind === 'diameter' ? value / 2 : value;
  const factor = targetR / circle.r;
  if (!isFinite(factor) || factor <= 0) return geo;
  return scaleGeo(geo, factor, factor, circle.cx, circle.cy);
}

/* Apply a geometric relation (horizontal / vertical line lock). Unlike a
   dimension it has no numeric value: it forces the edge A->B to lie on an axis
   by moving the mover endpoint's half-space so the edge becomes axis-aligned,
   while keeping the rest of the shape rigid (so a floorplan doesn't warp). For a
   'horizontal' relation the mover endpoint is shifted vertically to match the
   pinned endpoint's y; for 'vertical', horizontally to match its x. */
function driveRelation(geo, dim) {
  const rel = dim.relation;
  if (rel !== 'horizontal' && rel !== 'vertical') return geo;
  const pts = extractPoints(geo);
  const a = resolveAnchor(pts, dim, 'a', 'ax', 'ay');
  const b = resolveAnchor(pts, dim, 'b', 'bx', 'by');
  if (!a || !b) return geo;

  // Pin the endpoint on the larger side of the shape (matches linear driving),
  // and move the lighter endpoint onto the relation axis.
  const axisU = rel === 'horizontal' ? { x: 0, y: 1 } : { x: 1, y: 0 };
  const { pin, mover } = choosePin(pts, a, b, axisU.x, axisU.y);

  if (rel === 'horizontal') {
    // Move the mover's half-space in y so the mover's y matches the pin's y.
    const delta = pin.y - mover.y;
    if (Math.abs(delta) < 1e-9) return geo;
    // Push the half-space that contains the mover (the side where (p-pin)·u>0).
    const dir = Math.sign(mover.y - pin.y) || 1;
    return translateHalfSpace(geo, 0, dir, dir * delta, pin.x, pin.y);
  }
  const delta = pin.x - mover.x;
  if (Math.abs(delta) < 1e-9) return geo;
  const dir = Math.sign(mover.x - pin.x) || 1;
  return translateHalfSpace(geo, dir, 0, dir * delta, pin.x, pin.y);
}

/* Apply one driving dimension. No side-channel state is written: the drive only
   transforms geometry; the annotation later re-resolves the same anchors, so
   the two cannot disagree. */
function applyDimension(geo, dim) {
  if (dim.kind === 'relation') return driveRelation(geo, dim);
  if (dim.kind === 'radius' || dim.kind === 'diameter') return driveRadial(geo, dim);
  // arcRadius is measure-only; fillets are applied together in applyFillets.
  if (dim.kind === 'arcRadius' || dim.kind === 'fillet') return geo;
  if (dim.kind === 'angle') return driveAngle(geo, dim);
  return driveLinear(geo, dim);
}

/* ---- annotation geometry (the visible dimension graphics) ---- */

// Colour used for passive / measure-only (read-only) dimensions.
const PASSIVE_DIM_COLOR = '#9aa3ad';
// Colour used for over-constrained / conflicting dimensions.
const CONFLICT_DIM_COLOR = '#e03131';

function arrowPath(tipX, tipY, dirX, dirY, size) {
  // dir points from the tip back along the dimension line
  const len = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / len, uy = dirY / len;
  const px = -uy, py = ux;
  const w = size * 0.35;
  const bx = tipX + ux * size, by = tipY + uy * size;
  const x1 = bx + px * w, y1 = by + py * w;
  const x2 = bx - px * w, y2 = by - py * w;
  return `M ${tipX} ${tipY} L ${x1} ${y1} L ${x2} ${y2} Z`;
}

function annBounds(lines, label, textSize) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x1, y1, x2, y2] of lines) {
    minX = Math.min(minX, x1, x2); minY = Math.min(minY, y1, y2);
    maxX = Math.max(maxX, x1, x2); maxY = Math.max(maxY, y1, y2);
  }
  if (label) {
    minX = Math.min(minX, label.x - textSize * 2); maxX = Math.max(maxX, label.x + textSize * 2);
    minY = Math.min(minY, label.y - textSize); maxY = Math.max(maxY, label.y + textSize);
  }
  if (!isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/* For leader-style callouts (radius/diameter/fillet), a dragged label moves the
   whole leader + arrowhead to the new text position. Linear/angle labels are
   repositioned inline by their builders, so they pass no leaderAnchor here. */
function finishAnnotation(dim, lines, arrows, label, leaderAnchor, style, leaderType) {
  const { color, textSize, arrowSize } = style;
  if (dim.labelPos && isFinite(dim.labelPos.x) && isFinite(dim.labelPos.y) && leaderAnchor) {
    label = { ...label, x: dim.labelPos.x, y: dim.labelPos.y };
    const dx = label.x - leaderAnchor.x, dy = label.y - leaderAnchor.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const gap = textSize * 0.9;
    const endX = label.x - ux * gap, endY = label.y - uy * gap;
    if (leaderType) {
      lines = [[leaderAnchor.x, leaderAnchor.y, endX, endY]];
      arrows = [arrowPath(leaderAnchor.x, leaderAnchor.y, ux, uy, arrowSize)];
    } else {
      lines.push([leaderAnchor.x, leaderAnchor.y, endX, endY]);
    }
  } else if (dim.labelPos && isFinite(dim.labelPos.x) && isFinite(dim.labelPos.y)) {
    label = { ...label, x: dim.labelPos.x, y: dim.labelPos.y };
  }
  const ann = { type: 'dimAnnotation', lines, arrows, label, color, textSize, bounds: annBounds(lines, label, textSize) };
  // Over-constrained: paint everything red and stamp an X next to the value so
  // the user can see exactly which dimension breaks the math (SolidWorks-style).
  if (style.conflict && label) {
    ann.color = CONFLICT_DIM_COLOR;
    ann.marker = { type: 'conflict', x: label.x, y: label.y, size: textSize };
  }
  return ann;
}

/* Build the dimAnnotation for a single dimension on the ALREADY-DRIVEN geo.
   Linear/angle annotations resolve the same anchors the drive used, so they
   land exactly on the driven geometry without any reconstruction. */
function buildAnnotation(geo, dim, style, conflict) {
  if (conflict) style = { ...style, conflict: true };
  const { color, textSize, arrowSize, decimals, units } = style;
  const lines = [];
  const arrows = [];
  let label = null;

  if (dim.kind === 'relation') {
    // Draw a small tick + H/V glyph at the midpoint of the edge.
    const pts = extractPoints(geo);
    const a = resolveAnchor(pts, dim, 'a', 'ax', 'ay');
    const b = resolveAnchor(pts, dim, 'b', 'bx', 'by');
    if (!a || !b) return null;
    const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy, ny = dx;
    const off = textSize * 1.1;
    const gx = mx + nx * off, gy = my + ny * off;
    const glyph = dim.relation === 'horizontal' ? 'H' : 'V';
    label = { x: gx, y: gy, text: glyph, anchor: 'middle' };
    lines.push([mx, my, mx + nx * off * 0.55, my + ny * off * 0.55]);
    return finishAnnotation(dim, lines, arrows, label, null, { ...style, textSize: textSize * 0.9 });
  }

  if (dim.kind === 'arcRadius') {
    const cx0 = dim.ax, cy0 = dim.ay;
    if (cx0 == null || cy0 == null) return null;
    const circ = fitCircleAt(geo, cx0, cy0);
    if (!circ) return null;
    const passiveStyle = { ...style, color: PASSIVE_DIM_COLOR };
    let dx = cx0 - circ.cx, dy = cy0 - circ.cy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    lines.push([circ.cx, circ.cy, cx0, cy0]);
    arrows.push(arrowPath(cx0, cy0, -ux, -uy, arrowSize));
    label = { x: cx0 + ux * textSize * 1.4, y: cy0 + uy * textSize * 1.4, text: 'R' + fmtValue(circ.r, decimals, units), anchor: 'middle' };
    return finishAnnotation(dim, lines, arrows, label, { x: cx0, y: cy0 }, passiveStyle, true);
  }

  if (dim.kind === 'radius' || dim.kind === 'diameter') {
    const circle = detectCircle(geo);
    if (!circle) return null;
    const dirAng = (dim.labelAngle ?? -45) * Math.PI / 180;
    const ux = Math.cos(dirAng), uy = Math.sin(dirAng);
    const isDia = dim.kind === 'diameter';
    const startX = isDia ? circle.cx - ux * circle.r : circle.cx;
    const startY = isDia ? circle.cy - uy * circle.r : circle.cy;
    const tipX = circle.cx + ux * circle.r, tipY = circle.cy + uy * circle.r;
    lines.push([startX, startY, tipX, tipY]);
    arrows.push(arrowPath(tipX, tipY, -ux, -uy, arrowSize));
    if (isDia) arrows.push(arrowPath(startX, startY, ux, uy, arrowSize));
    const lx = circle.cx + ux * (circle.r + textSize * 1.4);
    const ly = circle.cy + uy * (circle.r + textSize * 1.4);
    const prefix = isDia ? '\u2300' : 'R';
    label = { x: lx, y: ly, text: prefix + fmtValue(isDia ? circle.r * 2 : circle.r, decimals, units), anchor: 'middle' };
    return finishAnnotation(dim, lines, arrows, label, { x: tipX, y: tipY }, style, true);
  }

  if (dim.kind === 'fillet') {
    const cx = dim._corner?.x ?? dim.ax;
    const cy = dim._corner?.y ?? dim.ay;
    if (cx == null || cy == null) return null;
    const b = geo.bounds || { x: cx, y: cy, width: 0, height: 0 };
    const centerX = b.x + b.width / 2, centerY = b.y + b.height / 2;
    let dirX = centerX - cx, dirY = centerY - cy;
    const len = Math.hypot(dirX, dirY) || 1;
    dirX /= len; dirY /= len;
    const r = dim.value > 0 ? dim.value : 0;
    const arcX = cx + dirX * r * 0.6, arcY = cy + dirY * r * 0.6;
    const tailX = cx + dirX * (r * 0.6 + textSize * 2.2), tailY = cy + dirY * (r * 0.6 + textSize * 2.2);
    lines.push([arcX, arcY, tailX, tailY]);
    arrows.push(arrowPath(arcX, arcY, dirX, dirY, arrowSize));
    label = { x: tailX + dirX * textSize * 0.6, y: tailY + dirY * textSize * 0.6, text: 'R' + fmtValue(r, decimals, units), anchor: 'middle' };
    return finishAnnotation(dim, lines, arrows, label, { x: arcX, y: arcY }, style, true);
  }

  const pts = extractPoints(geo);

  if (dim.kind === 'angle') {
    const arms = resolveCornerArms(geo, dim);
    const v = arms ? arms.v : resolveAnchor(pts, dim, 'v', 'vx', 'vy');
    const a = arms ? arms.a : resolveAnchor(pts, dim, 'a', 'ax', 'ay');
    const b = arms ? arms.b : resolveAnchor(pts, dim, 'b', 'bx', 'by');
    if (!v || !a || !b) return null;
    const ang1 = Math.atan2(a.y - v.y, a.x - v.x);
    const ang2 = Math.atan2(b.y - v.y, b.x - v.x);
    const r = autoOffset(geo, pts) * 1.2;
    lines.push([v.x, v.y, v.x + Math.cos(ang1) * r, v.y + Math.sin(ang1) * r]);
    lines.push([v.x, v.y, v.x + Math.cos(ang2) * r, v.y + Math.sin(ang2) * r]);
    let delta = ang2 - ang1;
    while (delta <= -Math.PI) delta += Math.PI * 2;
    while (delta > Math.PI) delta -= Math.PI * 2;
    const steps = 24;
    for (let i = 0; i < steps; i++) {
      const t0 = ang1 + delta * (i / steps);
      const t1 = ang1 + delta * ((i + 1) / steps);
      lines.push([v.x + Math.cos(t0) * r, v.y + Math.sin(t0) * r, v.x + Math.cos(t1) * r, v.y + Math.sin(t1) * r]);
    }
    const mid = ang1 + delta / 2;
    label = {
      x: v.x + Math.cos(mid) * (r + textSize),
      y: v.y + Math.sin(mid) * (r + textSize),
      text: fmtValue(Math.abs(delta) * 180 / Math.PI, decimals, '') + '\u00b0',
      anchor: 'middle',
    };
    return finishAnnotation(dim, lines, arrows, label, null, style);
  }

  // linear: resolve the same anchors the drive used. Since the drive moved B to
  // its target position, the resolved B already sits on the driven edge.
  const a = resolveAnchor(pts, dim, 'a', 'ax', 'ay');
  const b = resolveAnchor(pts, dim, 'b', 'bx', 'by');
  if (!a || !b) return null;
  const axis = dim.axis || 'aligned';
  const off = autoOffset(geo, pts);
  const hasPos = dim.labelPos && isFinite(dim.labelPos.x) && isFinite(dim.labelPos.y);
  const ax = a.x, ay = a.y, bx = b.x, by = b.y;
  let measured;

  if (axis === 'horizontal') {
    measured = Math.abs(bx - ax);
    const lineY = hasPos ? dim.labelPos.y : Math.max(ay, by) + off;
    lines.push([ax, ay, ax, lineY]);
    lines.push([bx, by, bx, lineY]);
    lines.push([ax, lineY, bx, lineY]);
    arrows.push(arrowPath(ax, lineY, bx - ax, 0, arrowSize));
    arrows.push(arrowPath(bx, lineY, ax - bx, 0, arrowSize));
    const lblX = hasPos ? dim.labelPos.x : (ax + bx) / 2;
    label = { x: lblX, y: lineY - textSize * 0.4, text: fmtValue(measured, decimals, units), anchor: 'middle' };
  } else if (axis === 'vertical') {
    measured = Math.abs(by - ay);
    const lineX = hasPos ? dim.labelPos.x : Math.max(ax, bx) + off;
    lines.push([ax, ay, lineX, ay]);
    lines.push([bx, by, lineX, by]);
    lines.push([lineX, ay, lineX, by]);
    arrows.push(arrowPath(lineX, ay, 0, by - ay, arrowSize));
    arrows.push(arrowPath(lineX, by, 0, ay - by, arrowSize));
    const lblY = hasPos ? dim.labelPos.y : (ay + by) / 2;
    label = { x: lineX + textSize * 0.5, y: lblY, text: fmtValue(measured, decimals, units), anchor: 'start' };
  } else {
    measured = dist(ax, ay, bx, by);
    let dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy, ny = dx;
    let perp = off, along = 0;
    if (hasPos) {
      const mx0 = (ax + bx) / 2, my0 = (ay + by) / 2;
      const rx = dim.labelPos.x - mx0, ry = dim.labelPos.y - my0;
      perp = rx * nx + ry * ny;
      along = rx * dx + ry * dy;
    }
    const ox = nx * perp, oy = ny * perp;
    const a2x = ax + ox, a2y = ay + oy, b2x = bx + ox, b2y = by + oy;
    lines.push([ax, ay, a2x, a2y]);
    lines.push([bx, by, b2x, b2y]);
    lines.push([a2x, a2y, b2x, b2y]);
    arrows.push(arrowPath(a2x, a2y, b2x - a2x, b2y - a2y, arrowSize));
    arrows.push(arrowPath(b2x, b2y, a2x - b2x, a2y - b2y, arrowSize));
    label = {
      x: (a2x + b2x) / 2 + dx * along + nx * textSize * 0.7,
      y: (a2y + b2y) / 2 + dy * along + ny * textSize * 0.7,
      text: fmtValue(measured, decimals, units),
      anchor: 'middle',
    };
  }
  // Labels already moved with the line above, so suppress the trailing leader.
  return finishAnnotation({ ...dim, labelPos: undefined }, lines, arrows, label, null, style);
}

/* ---- public API ---- */

export function getDimensionLabelPoint(geo, dim, style) {
  const ann = buildAnnotation(geo, dim, style || { color: '#000', textSize: 14, arrowSize: 8, decimals: 1, units: '' });
  return ann && ann.label ? { x: ann.label.x, y: ann.label.y, text: ann.label.text } : null;
}

export function measureDimension(geo, dim) {
  if (dim.kind === 'relation') {
    // Residual misalignment from the relation axis (0 when perfectly aligned).
    const pts = extractPoints(geo);
    const a = resolveAnchor(pts, dim, 'a', 'ax', 'ay');
    const b = resolveAnchor(pts, dim, 'b', 'bx', 'by');
    if (!a || !b) return null;
    return dim.relation === 'horizontal' ? Math.abs(b.y - a.y) : Math.abs(b.x - a.x);
  }
  if (dim.kind === 'arcRadius') {
    const circ = (dim.ax != null && dim.ay != null) ? fitCircleAt(geo, dim.ax, dim.ay) : null;
    return circ ? circ.r : null;
  }
  if (dim.kind === 'radius' || dim.kind === 'diameter') {
    const circle = detectCircle(geo);
    if (!circle) return null;
    return dim.kind === 'diameter' ? circle.r * 2 : circle.r;
  }
  if (dim.kind === 'fillet') {
    const b = geo?.bounds;
    if (b) return Math.round(Math.min(b.width, b.height) * 0.2 * 100) / 100;
    return 10;
  }
  const pts = extractPoints(geo);
  if (dim.kind === 'angle') {
    const arms = resolveCornerArms(geo, dim);
    const v = arms ? arms.v : resolveAnchor(pts, dim, 'v', 'vx', 'vy');
    const a = arms ? arms.a : resolveAnchor(pts, dim, 'a', 'ax', 'ay');
    const b = arms ? arms.b : resolveAnchor(pts, dim, 'b', 'bx', 'by');
    if (!v || !a || !b) return null;
    let delta = Math.atan2(b.y - v.y, b.x - v.x) - Math.atan2(a.y - v.y, a.x - v.x);
    while (delta <= -Math.PI) delta += Math.PI * 2;
    while (delta > Math.PI) delta -= Math.PI * 2;
    return Math.abs(delta) * 180 / Math.PI;
  }
  const a = resolveAnchor(pts, dim, 'a', 'ax', 'ay');
  const b = resolveAnchor(pts, dim, 'b', 'bx', 'by');
  if (!a || !b) return null;
  if (dim.axis === 'horizontal') return Math.abs(b.x - a.x);
  if (dim.axis === 'vertical') return Math.abs(b.y - a.y);
  return dist(a.x, a.y, b.x, b.y);
}

export function driveGeometry(inputGeo, dims) {
  const res = solveDimensions(inputGeo, dims);
  return res ? res.geo : null;
}

/* Drive all dimensions, then detect which ones the final geometry fails to
   satisfy (SolidWorks-style over-defined detection). A dimension "breaks the
   math" when its target can't be met because an earlier dimension/relation
   already pinned the same geometry — the residual exceeds a tolerance. Returns
   the driven geometry plus a Set of conflicting dimension ids. */
export function solveDimensions(inputGeo, dims) {
  if (!inputGeo) return null;
  ensurePaper();
  const base = normalizeInput(inputGeo);
  let canonicalPts = [];
  try { canonicalPts = extractPoints(base) || []; } catch { canonicalPts = []; }
  bindAnchors(canonicalPts, dims);
  let driven = base;
  for (const dim of dims) driven = applyDimension(driven, dim);
  resolveFilletCorners(driven, dims);
  driven = applyFillets(driven, dims);

  const conflicts = new Set();
  for (const dim of dims) {
    if (!isDrivingDim(dim)) continue;
    const measured = measureDimension(driven, dim);
    if (measured == null) continue;
    if (dim.kind === 'relation') {
      // Aligned when residual misalignment is ~0 (allow sub-pixel slack).
      if (measured > Math.max(0.5, dimScaleTol(driven))) conflicts.add(dim.id);
      continue;
    }
    const target = dim.value;
    if (target == null || !isFinite(target)) continue;
    const tol = dim.kind === 'angle'
      ? 0.5 // half a degree
      : Math.max(0.5, Math.abs(target) * 0.01); // 1% or half a unit
    if (Math.abs(measured - target) > tol) conflicts.add(dim.id);
  }
  return { geo: driven, conflicts };
}

/* A dimension that actually drives geometry (so it can be over-constrained).
   arcRadius is measure-only; fillet is a cosmetic corner, never conflicting. */
function isDrivingDim(dim) {
  return dim.kind !== 'arcRadius' && dim.kind !== 'fillet';
}

/* Small absolute tolerance scaled to the geometry size, for relation residuals. */
function dimScaleTol(geo) {
  const b = geo?.bounds;
  if (!b) return 0.5;
  return Math.max(0.5, Math.hypot(b.width, b.height) * 0.002);
}

/* ---- fillets (applied in one pass after all driving) ---- */

/* Snap each fillet's stored corner to the nearest live vertex right before
   fillets are applied, so the fillet stays glued to the right corner after any
   resize. */
function resolveFilletCorners(geo, dims) {
  const fillets = dims.filter((d) => d.kind === 'fillet' && d.ax != null && d.ay != null);
  if (fillets.length === 0) return;
  let pts = [];
  try { pts = extractPoints(geo) || []; } catch { pts = []; }
  for (const d of fillets) {
    const near = pts.length ? nearestPoint(pts, d.ax, d.ay) : null;
    d._corner = near ? { x: near.x, y: near.y } : { x: d.ax, y: d.ay };
  }
}

/* Apply all fillet dimensions in a single pass from the current pre-fillet
   geometry, so chaining fillets doesn't re-flatten earlier arcs into chamfers. */
function applyFillets(geo, dims) {
  const fillets = dims.filter((d) => d.kind === 'fillet' && d.value > 0 && d.ax != null && d.ay != null);
  if (fillets.length === 0) return geo;

  let pathData = geo.type === 'booleanResult' ? geo.pathData : null;
  if (!pathData) {
    const flat = flattenGeoToPathData(geo);
    pathData = flat?.pathData || null;
  }
  if (!pathData) return geo;

  try {
    const corners = fillets.map((d) => ({
      x: d._corner?.x ?? d.ax,
      y: d._corner?.y ?? d.ay,
      radius: d.value,
    }));
    const res = filletCornersAt(pathData, corners);
    if (!res || !res.pathData) return geo;
    return {
      type: 'booleanResult',
      pathData: res.pathData,
      fill: geo.fill && geo.fill !== 'none' ? geo.fill : 'none',
      stroke: geo.stroke || '#000000',
      strokeWidth: geo.strokeWidth ?? 1,
      opacity: geo.opacity,
      bounds: res.bounds,
    };
  } catch {
    return geo;
  }
}

export function dimensionRuntime(params, inputs) {
  const inputGeo = inputs.geometry_in;
  if (!inputGeo) return null;

  const dims = parseDimensions(params.dimensions);
  const showDims = params.show_dimensions !== false;
  const style = {
    color: params.dim_color ?? '#1366d6',
    textSize: params.text_size ?? 14,
    arrowSize: params.arrow_size ?? 8,
    decimals: params.decimals ?? 1,
    units: params.units ?? '',
  };

  ensurePaper();

  const solved = solveDimensions(inputGeo, dims);
  const driven = solved ? solved.geo : inputGeo;
  const conflicts = solved ? solved.conflicts : new Set();

  if (!showDims || dims.length === 0) return driven;

  const annotations = [];
  for (const dim of dims) {
    const ann = buildAnnotation(driven, dim, style, conflicts.has(dim.id));
    if (ann) annotations.push(ann);
  }

  const children = [driven, ...annotations];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of children) {
    if (c && c.bounds) {
      minX = Math.min(minX, c.bounds.x);
      minY = Math.min(minY, c.bounds.y);
      maxX = Math.max(maxX, c.bounds.x + c.bounds.width);
      maxY = Math.max(maxY, c.bounds.y + c.bounds.height);
    }
  }

  return {
    type: 'group',
    children,
    bounds: {
      x: isFinite(minX) ? minX : 0,
      y: isFinite(minY) ? minY : 0,
      width: isFinite(maxX - minX) ? maxX - minX : 0,
      height: isFinite(maxY - minY) ? maxY - minY : 0,
    },
  };
}
