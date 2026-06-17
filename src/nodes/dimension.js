import paper from 'paper';
import { geoToPaperPath, flattenGeoToPathData } from '../utils/geoPathUtils';
import { extractPoints } from '../utils/geometryPoints';
import { filletCornersAt } from './radius';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

// Colour used for passive / driven (read-only, measured) dimensions, so they
// are visually distinct from active driving dimensions. Muted grey like CAD
// tools use for reference dimensions.
const PASSIVE_DIM_COLOR = '#9aa3ad';

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

/* Resize the input by scaling about a pivot, returning a fresh booleanResult.
   Used to drive linear / radius / diameter dimensions. */
function scaleGeo(geo, sx, sy, pivotX, pivotY) {
  ensurePaper();
  if (!isFinite(sx) || !isFinite(sy) || !isFinite(pivotX) || !isFinite(pivotY)) return geo;
  if (sx === 0 || sy === 0) return geo;
  const path = geoToPaperPath(geo);
  if (!path) return geo;
  path.scale(sx, sy, new paper.Point(pivotX, pivotY));
  const out = paperPathToGeo(path, geo);
  path.remove();
  // Guard against degenerate output (empty/collapsed) that would break the renderer.
  if (!out || !out.pathData) return geo;
  return out;
}

/* Rotate ONLY arm B about the vertex, leaving arm A fixed, so an angle
   dimension opens/closes the angle between two arms instead of spinning the
   whole shape. A segment belongs to arm B if its direction from the vertex is
   angularly closer to B's direction than to A's. The vertex segment and the
   handles travel with their anchors. */
function rotateArm(geo, deg, v, a, b) {
  ensurePaper();
  if (!isFinite(deg) || Math.abs(deg) < 1e-9) return geo;
  const path = geoToPaperPath(geo);
  if (!path) return geo;

  const angA = Math.atan2(a.y - v.y, a.x - v.x);
  const angB = Math.atan2(b.y - v.y, b.x - v.x);
  // Smallest absolute angular difference between two angles.
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
    return new paper.Point(
      v.x + dx * cos - dy * sin,
      v.y + dx * sin + dy * cos,
    );
  };

  const rotateSegs = (segs) => {
    for (const s of segs) {
      const dx = s.point.x - v.x, dy = s.point.y - v.y;
      const r = Math.hypot(dx, dy);
      if (r < 1e-6) continue; // the vertex itself stays put
      const ang = Math.atan2(dy, dx);
      // Belongs to arm B if closer to B's direction than A's.
      if (angDiff(ang, angB) < angDiff(ang, angA)) {
        s.point = rot(s.point);
      }
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

/* Push/pull an edge: translate path segments that lie on the moving side of a
   dividing line by `delta` along the unit direction (ux, uy). The dividing line
   passes through the pinned point (px, py) and is perpendicular to the
   direction. Only SHARP-corner segments are moved; smooth (curved) segments —
   e.g. the points making up a circular arc from a boolean union — are left
   untouched so the curve keeps its exact shape instead of being dragged along.
   Bezier handles travel with their anchor point (Paper stores them relative). */
function translateHalfSpace(geo, ux, uy, delta, px, py, sharpPts) {
  ensurePaper();
  if (!isFinite(ux) || !isFinite(uy) || !isFinite(delta)) return geo;
  if (Math.abs(delta) < 1e-9) return geo;
  const path = geoToPaperPath(geo);
  if (!path) return geo;

  const tx = ux * delta, ty = uy * delta;
  const eps = 1e-6;

  // Translate every anchor at or beyond the threshold plane (which passes
  // through (px,py) — the moving EDGE — perpendicular to the push direction).
  // Only the outer edge group moves; interior features (e.g. a centered arc)
  // stay put, and the segments connecting them to the moved edge stretch to
  // follow. Bezier handles are stored relative to their anchor, so moving an
  // anchor carries its handles too (no tearing of curved segments that move).
  let movedCount = 0;
  const moveSegments = (segs) => {
    const targets = [];
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      const rel = (s.point.x - px) * ux + (s.point.y - py) * uy;
      if (rel >= -eps) targets.push(s);
    }
    for (const s of targets) {
      s.point = new paper.Point(s.point.x + tx, s.point.y + ty);
      movedCount++;
    }
  };

  if (path.className === 'CompoundPath') {
    for (const child of (path.children || [])) moveSegments(child.segments);
  } else {
    moveSegments(path.segments);
  }

  const out = paperPathToGeo(path, geo);
  path.remove();
  if (typeof window !== 'undefined' && window.__DIM_DEBUG) {
    console.log('[translateHalfSpace] movedCount=', movedCount, 'delta=', delta, 'dir=', ux, uy);
  }
  if (!out || !out.pathData) return geo;
  return out;
}

/* Move only the single vertex at (px,py) by (tx,ty). Used for general
   polylines/polygons where a linear dimension should set the length of one
   picked edge by relocating just its movable endpoint, leaving every other
   vertex (and the rest of the shape) untouched. A rigid half-space push would
   instead drag along every vertex beyond a plane, warping an irregular shape.
   Bezier handles travel with their anchor (Paper stores them relative), so a
   curved segment that shares this vertex keeps its shape. */
function translatePoint(geo, tx, ty, px, py) {
  ensurePaper();
  if (!isFinite(tx) || !isFinite(ty)) return geo;
  if (Math.abs(tx) < 1e-9 && Math.abs(ty) < 1e-9) return geo;
  const path = geoToPaperPath(geo);
  if (!path) return geo;

  // Match the vertex closest to (px,py) within a small tolerance, so we move
  // exactly the picked endpoint even after prior edits nudged coordinates.
  let best = null, bestD = Infinity;
  const consider = (segs) => {
    for (const s of segs) {
      const d = Math.hypot(s.point.x - px, s.point.y - py);
      if (d < bestD) { bestD = d; best = s; }
    }
  };
  if (path.className === 'CompoundPath') {
    for (const child of (path.children || [])) consider(child.segments);
  } else {
    consider(path.segments);
  }

  if (best && bestD <= Math.max(2, Math.hypot(path.bounds.width, path.bounds.height) * 0.05)) {
    best.point = new paper.Point(best.point.x + tx, best.point.y + ty);
  }

  const out = paperPathToGeo(path, geo);
  path.remove();
  if (!out || !out.pathData) return geo;
  return out;
}

/* A polygon/polyline (all-sharp corners, not round) should drive a linear
   dimension by moving a single picked vertex rather than pushing a half-space.
   Rectangles keep using the half-space push (cleaner for a box edge). */
function isPolyline(geo, pts) {
  if (!geo) return false;
  if (geo.type === 'rect' || geo.type === 'roundedRect') return false;
  if (isCircular(geo)) return false;
  if (!pts || pts.length < 3) return false;
  // Treat as a polyline when (almost) every vertex is a sharp corner — i.e. a
  // straight-edged polygon, not a shape dominated by arcs.
  const sharp = pts.filter((p) => p.sharp).length;
  return sharp >= pts.length - 1;
}

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

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

/* Find the point in `pts` nearest to (x, y). Anchors are stored as coordinates
   at creation time; resolving by nearest point keeps them stable even after the
   shape is converted to a booleanResult (whose vertex order differs from the
   original rect) or rescaled by a previous dimension. */
function nearestPoint(pts, x, y) {
  if (!isFinite(x) || !isFinite(y)) return null;
  let best = null, bestD = Infinity;
  for (const p of pts) {
    const d = dist(p.x, p.y, x, y);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/* Resolve a dimension anchor. Prefers stored coordinates (xKey/yKey) matched to
   the nearest current vertex; falls back to the stored index for older dims.
   If the closest vertex is far from the stored point (e.g. a boolean op merged
   or reordered vertices so the original corner no longer exists), keep the raw
   stored coordinate so the dimension still spans the originally-picked span
   instead of collapsing onto a wrong/shared vertex. */
function resolveAnchor(pts, dim, idxKey, xKey, yKey) {
  if (dim[xKey] != null && dim[yKey] != null) {
    const near = nearestPoint(pts, dim[xKey], dim[yKey]);
    if (near) {
      const snapTol = anchorSnapTolerance(pts);
      const d = dist(near.x, near.y, dim[xKey], dim[yKey]);
      if (d <= snapTol) return near;
      // No vertex close enough: trust the stored coordinate verbatim.
      return { x: dim[xKey], y: dim[yKey], idx: -1, sharp: true };
    }
    return { x: dim[xKey], y: dim[yKey], idx: -1, sharp: true };
  }
  return pts[dim[idxKey]];
}

/* Default gap between a dimension line and the edge it measures, scaled to the
   geometry so it neither floats far away on a small sketch nor hugs the edge on
   a large one. A fixed world-unit offset (the old behaviour) looked enormous on
   a small floorplan-sized polyline, which read as the dimension "floating far"
   from the edge. */
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

/* A snap tolerance scaled to the geometry so it works at any zoom/size. */
function anchorSnapTolerance(pts) {
  if (!pts || pts.length === 0) return 1;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
  }
  const diag = Math.hypot(maxX - minX, maxY - minY) || 1;
  return Math.max(2, diag * 0.05); // 5% of the bounding diagonal
}

/* Detect the center + radius of a roughly-circular shape so radius/diameter
   dimensions can drive it. Returns null if the shape isn't circular enough. */
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

/* Fit a circle to the arc nearest a clicked point. Used to MEASURE the radius
   of a curved sub-feature on a compound/boolean shape (e.g. a circular bump
   merged into a rectangle), where there is no standalone circle to inspect.
   Samples three points along the curve closest to (clickX, clickY) and solves
   for the circle through them. Returns null if the local geometry is too flat
   (i.e. effectively a straight edge). */
function fitCircleAt(geo, clickX, clickY) {
  ensurePaper();
  const path = geoToPaperPath(geo);
  if (!path) return null;
  try {
    const click = new paper.Point(clickX, clickY);
    const loc = path.getNearestLocation(click);
    if (!loc || !loc.curve) return null;

    // Walk outward from the clicked curve, collecting contiguous CURVED curves
    // (the arc). Straight curves (a rectangle edge) bound the arc and stop the
    // walk, so we never fold a flat edge into the fit (which inflates radius).
    const isCurved = (c) => {
      if (!c) return false;
      if (c.isStraight && c.isStraight()) return false;
      // A curve is effectively straight if its handles are ~zero.
      const h1 = c.handle1 ? c.handle1.length : 0;
      const h2 = c.handle2 ? c.handle2.length : 0;
      return h1 > 1e-6 || h2 > 1e-6;
    };

    const start = loc.curve;
    if (!isCurved(start)) return null;
    const arcCurves = [start];
    // forward
    for (let c = start.next; c && c !== start && isCurved(c); c = c.next) arcCurves.push(c);
    // backward
    for (let c = start.previous; c && c !== start && isCurved(c); c = c.previous) arcCurves.unshift(c);

    // Sample points evenly along the collected arc.
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
    // Fall back to a 3-point fit spanning the arc ends + middle.
    const a = samples[0], m = samples[Math.floor(samples.length / 2)], z = samples[samples.length - 1];
    return circleThrough3(a[0], a[1], m[0], m[1], z[0], z[1]);
  } finally {
    path.remove();
  }
}

/* Least-squares (Kåsa) circle fit over many sample points. More stable than a
   3-point fit for noisy/short arcs. Returns {cx, cy, r} or null. */
function fitCircleLSQ(pts) {
  const n = pts.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (const [x, y] of pts) {
    const z = x * x + y * y;
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
    sxz += x * z; syz += y * z; sz += z;
  }
  // Solve the normal equations for [A, B, C] in: A*x + B*y + C = -(x^2+y^2)
  const m = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const rhs = [-sxz, -syz, -sz];
  const sol = solve3x3(m, rhs);
  if (!sol) return null;
  const [A, B, C] = sol;
  const cx = -A / 2, cy = -B / 2;
  const r2 = cx * cx + cy * cy - C;
  if (!(r2 > 0)) return null;
  const r = Math.sqrt(r2);
  if (!isFinite(r) || r < 1e-6) return null;
  return { cx, cy, r };
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
  const Dx = det(col(m, 0, b));
  const Dy = det(col(m, 1, b));
  const Dz = det(col(m, 2, b));
  return [Dx / D, Dy / D, Dz / D];
}

/* Circle through three points; returns {cx, cy, r} or null if collinear. */
function circleThrough3(ax, ay, bx, by, cx2, cy2) {
  const d = 2 * (ax * (by - cy2) + bx * (cy2 - ay) + cx2 * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const ax2 = ax * ax + ay * ay;
  const bx2 = bx * bx + by * by;
  const cx22 = cx2 * cx2 + cy2 * cy2;
  const ux = (ax2 * (by - cy2) + bx2 * (cy2 - ay) + cx22 * (ay - by)) / d;
  const uy = (ax2 * (cx2 - bx) + bx2 * (ax - cx2) + cx22 * (bx - ax)) / d;
  const r = Math.hypot(ax - ux, ay - uy);
  if (!isFinite(r) || r < 1e-6) return null;
  return { cx: ux, cy: uy, r };
}

/* Heuristic: is the shape actually round (circle/ellipse/arc), as opposed to a
   polygon with sharp corners? Used to decide whether the Radius tool drives the
   whole shape's radius or instead fillets a clicked corner. */
export function isCircular(geo) {
  if (!geo) return false;
  if (geo.type === 'ellipse' || geo.type === 'arc') return true;
  if (geo.type === 'rect' || geo.type === 'roundedRect') return false;
  // For paths, compare actual area/perimeter to that of a perfect circle with
  // the same bounding box. A circle's area ≈ π r²; a square's is (2r)². If the
  // shape fills far less of its bounding box than a circle would, treat it as
  // non-round. This reliably separates circles/ellipses from rectangles/polys.
  try {
    ensurePaper();
    const path = geoToPaperPath(geo);
    if (!path) return false;
    const b = path.bounds;
    const area = Math.abs(path.area);
    path.remove();
    if (b.width < 1e-6 || b.height < 1e-6) return false;
    const boxArea = b.width * b.height;
    const ratio = area / boxArea; // circle ≈ 0.785, square = 1.0
    return ratio > 0.70 && ratio < 0.92;
  } catch {
    return false;
  }
}

/* Apply one driving dimension to the current geometry. Anchors are looked up
   against `basePoints` (the original input's extracted points) but measured on
   the live geometry's points so sequential edits compose correctly. */
function applyDimension(geo, dim) {
  dim._drive = null;
  dim._angleDrive = null;
  const value = dim.value;
  if (value == null || !isFinite(value)) return geo;

  if (dim.kind === 'radius' || dim.kind === 'diameter') {
    const circle = detectCircle(geo);
    if (!circle || circle.r < 1e-6) return geo;
    const targetR = dim.kind === 'diameter' ? value / 2 : value;
    const factor = targetR / circle.r;
    if (!isFinite(factor) || factor <= 0) return geo;
    return scaleGeo(geo, factor, factor, circle.cx, circle.cy);
  }

  if (dim.kind === 'arcRadius') {
    // Measure-only: the arc belongs to a merged boolean path, so there is no
    // standalone circle to rescale. Leave geometry untouched.
    return geo;
  }

  if (dim.kind === 'fillet') {
    // Fillets are applied together in a single pass (see applyFillets) so that
    // chaining multiple fillets doesn't re-flatten existing arcs into chamfers.
    return geo;
  }

  const pts = extractPoints(geo);
  if (dim.kind === 'angle') {
    const v = resolveAnchor(pts, dim, 'v', 'vx', 'vy');
    const a = resolveAnchor(pts, dim, 'a', 'ax', 'ay');
    const b = resolveAnchor(pts, dim, 'b', 'bx', 'by');
    if (!v || !a || !b) return geo;
    const ang1 = Math.atan2(a.y - v.y, a.x - v.x);
    const ang2 = Math.atan2(b.y - v.y, b.x - v.x);
    let current = (ang2 - ang1) * 180 / Math.PI;
    while (current <= -180) current += 360;
    while (current > 180) current -= 360;
    const currentMag = Math.abs(current);
    if (currentMag < 1e-6) return geo;
    // Rotate only arm B about the vertex so the angle BETWEEN the two arms
    // changes, instead of spinning the whole shape (which keeps the angle the
    // same). Arm A stays put as the reference.
    const deltaDeg = (Math.sign(current) || 1) * (value - currentMag);
    // If the value matches the measured angle (e.g. the dimension was just
    // placed, not edited), don't rotate or record a drive. Reconstructing arm B
    // from angA + sign*value can land it on the wrong winding side, which drew
    // the arc/witness arms off the actual corner. Leaving _angleDrive null lets
    // the annotation use the real, resolved arm directions.
    if (Math.abs(deltaDeg) < 1e-6) {
      dim._drive = null;
      dim._angleDrive = null;
      return geo;
    }
    const rotated = rotateArm(geo, deltaDeg, v, a, b);
    dim._drive = null;
    // Record the driven angle so the annotation draws the NEW angle instead of
    // re-measuring arm B from its now-stale stored anchor (which would still
    // read the original angle). Arm A is the fixed reference.
    const sign = Math.sign(current) || 1;
    dim._angleDrive = {
      vx: v.x, vy: v.y,
      angA: Math.atan2(a.y - v.y, a.x - v.x), // fixed reference arm
      armLenA: dist(v.x, v.y, a.x, a.y),
      armLenB: dist(v.x, v.y, b.x, b.y),
      sign,
      value, // target magnitude in degrees
    };
    return rotated;
  }

  // linear (default) — push/pull the dimensioned edge by translating the
  // geometry on the far (b) side of the pinned point a, instead of scaling the
  // whole shape (which would distort neighbouring features like a circle).
  const a = resolveAnchor(pts, dim, 'a', 'ax', 'ay');
  const b = resolveAnchor(pts, dim, 'b', 'bx', 'by');
  if (!a || !b) return geo;
  const axis = dim.axis || 'aligned';

  // A linear dimension across a whole circular shape would tear it into a
  // teardrop if we pushed only one edge. Scale about the centre instead. We
  // scale only along the dimension's axis (non-uniform), so a horizontal and a
  // vertical linear dimension together turn the circle into an ellipse; an
  // aligned dimension scales uniformly along its direction.
  if (isCircular(geo)) {
    const circle = detectCircle(geo);
    if (circle && circle.r > 1e-6) {
      let current;
      if (axis === 'horizontal') current = Math.abs(b.x - a.x);
      else if (axis === 'vertical') current = Math.abs(b.y - a.y);
      else current = dist(a.x, a.y, b.x, b.y);
      if (current > 1e-6) {
        const factor = value / current;
        if (isFinite(factor) && factor > 0) {
          let sx, sy, scaled;
          if (axis === 'horizontal') {
            sx = factor; sy = 1;
            scaled = scaleGeo(geo, sx, sy, circle.cx, circle.cy);
          } else if (axis === 'vertical') {
            sx = 1; sy = factor;
            scaled = scaleGeo(geo, sx, sy, circle.cx, circle.cy);
          } else {
            // Aligned: scale uniformly so the circle stays round along its span.
            scaled = scaleGeo(geo, factor, factor, circle.cx, circle.cy);
          }
          // Record drive so the annotation spans the scaled axis, centred on the
          // shape: pin = centre - axis*value/2, mover = centre + axis*value/2.
          const cx = circle.cx, cy = circle.cy;
          let ux, uy;
          if (axis === 'horizontal') { ux = 1; uy = 0; }
          else if (axis === 'vertical') { ux = 0; uy = 1; }
          else { const d = dist(a.x, a.y, b.x, b.y) || 1; ux = (b.x - a.x) / d; uy = (b.y - a.y) / d; }
          dim._drive = {
            pinX: cx - ux * value / 2, pinY: cy - uy * value / 2,
            ux, uy, value,
          };
          return scaled;
        }
      }
    }
  }

  if (typeof window !== 'undefined' && window.__DIM_DEBUG) {
    console.log('[applyDimension linear]', { value, axis, a, b, ptsCount: pts.length });
  }

  // Decide which endpoint to pin: keep the side that holds MORE of the shape
  // stationary and push the smaller side, so editing an edge doesn't drag the
  // bulk of the geometry (or a neighbouring feature) along with it. This makes
  // the result independent of the order the two points were picked.
  const choosePin = (p0, p1, ux, uy) => {
    // Count vertices on p1's side of the line through p0 (and vice-versa).
    let n0 = 0, n1 = 0;
    for (const p of pts) {
      const r0 = (p.x - p0.x) * ux + (p.y - p0.y) * uy; // >0 => p1 side of p0
      const r1 = (p.x - p1.x) * ux + (p.y - p1.y) * uy; // <0 => p0 side of p1
      if (r0 > 1e-6) n1++;
      if (r1 < -1e-6) n0++;
    }
    // Pin the endpoint whose side has more vertices (the larger, stable side).
    return n0 >= n1 ? { pin: p0, mover: p1 } : { pin: p1, mover: p0 };
  };

  if (axis === 'horizontal') {
    const current = Math.abs(b.x - a.x);
    if (current < 1e-6) return geo;
    const { pin, mover } = choosePin(a, b, 1, 0);
    const dir = Math.sign(mover.x - pin.x) || 1;
    const delta = value - current;        // positive => edge moves outward
    dim._drive = { pinX: pin.x, pinY: pin.y, ux: dir, uy: 0, value };
    if (typeof window !== 'undefined' && window.__DIM_DEBUG) {
      console.log('[applyDimension horizontal]', { current, value, delta, pin, mover, dir });
    }
    if (isPolyline(geo, pts)) {
      // Move only the picked endpoint along X; record explicit endpoints so the
      // annotation spans pin -> moved mover (the two may differ in Y).
      const movedX = mover.x + dir * delta;
      dim._drive = { ax: pin.x, ay: pin.y, bx: movedX, by: mover.y, value };
      return translatePoint(geo, dir * delta, 0, mover.x, mover.y);
    }
    // Threshold plane at the moving edge so interior features stay fixed.
    return translateHalfSpace(geo, dir, 0, delta, mover.x, mover.y, pts);
  }
  if (axis === 'vertical') {
    const current = Math.abs(b.y - a.y);
    if (current < 1e-6) return geo;
    const { pin, mover } = choosePin(a, b, 0, 1);
    const dir = Math.sign(mover.y - pin.y) || 1;
    const delta = value - current;
    dim._drive = { pinX: pin.x, pinY: pin.y, ux: 0, uy: dir, value };
    if (isPolyline(geo, pts)) {
      const movedY = mover.y + dir * delta;
      dim._drive = { ax: pin.x, ay: pin.y, bx: mover.x, by: movedY, value };
      return translatePoint(geo, 0, dir * delta, mover.x, mover.y);
    }
    return translateHalfSpace(geo, 0, dir, delta, mover.x, mover.y, pts);
  }

  // aligned: push/pull along the a->b direction
  const current = dist(a.x, a.y, b.x, b.y);
  if (current < 1e-6) return geo;
  const u0x = (b.x - a.x) / current, u0y = (b.y - a.y) / current;
  const { pin, mover } = choosePin(a, b, u0x, u0y);
  let ux = (mover.x - pin.x), uy = (mover.y - pin.y);
  const ulen = Math.hypot(ux, uy) || 1;
  ux /= ulen; uy /= ulen;
  const delta = value - current;
  dim._drive = { pinX: pin.x, pinY: pin.y, ux, uy, value };
  if (isPolyline(geo, pts)) {
    // Move only the picked endpoint along the a->b direction so the edge
    // length becomes `value`; the pin and all other vertices stay put.
    const movedX = mover.x + ux * delta, movedY = mover.y + uy * delta;
    dim._drive = { ax: pin.x, ay: pin.y, bx: movedX, by: movedY, value };
    return translatePoint(geo, ux * delta, uy * delta, mover.x, mover.y);
  }
  return translateHalfSpace(geo, ux, uy, delta, mover.x, mover.y, pts);
}

/* ---- Annotation geometry (the visible dimension graphics) ---- */

/* Current endpoints of a linear dimension on the DRIVEN geometry.
   The originally-picked ax/ay/bx/by become stale after the edge is pushed, so
   the annotation must use live positions. Strategy: the pinned endpoint (the
   one on the larger, stationary side) still coincides with a real vertex, so we
   snap it to the nearest current vertex; the moved endpoint is then placed at
   the driven distance (`value`) from the pin along the dimension axis. When the
   dimension has no driving value yet, both anchors snap to their nearest
   vertices as picked. */
function drivenLinearEndpoints(pts, dim) {
  const rawA = resolveAnchor(pts, dim, 'a', 'ax', 'ay');
  const rawB = resolveAnchor(pts, dim, 'b', 'bx', 'by');
  if (!rawA || !rawB) return null;

  // If the geometry was actually driven, applyDimension recorded the exact pin
  // and push direction. Reuse it so the annotation lands on the same edge the
  // drive moved (the pinned endpoint stays put; the mover is pin + dir*value).
  // This avoids the annotation re-deriving a different pin than the drive used.
  if (dim._drive) {
    // Polyline single-point move stores explicit endpoints (pin + moved mover).
    if (dim._drive.bx != null) {
      const { ax, ay, bx, by } = dim._drive;
      const pin = { x: ax, y: ay };
      const mover = { x: bx, y: by };
      const dA = dist(rawA.x, rawA.y, ax, ay);
      const dB = dist(rawB.x, rawB.y, ax, ay);
      return dA <= dB ? { a: pin, b: mover } : { a: mover, b: pin };
    }
    const { pinX, pinY, ux, uy, value } = dim._drive;
    const pin = { x: pinX, y: pinY };
    const mover = { x: pinX + ux * value, y: pinY + uy * value };
    // Decide a/b order: whichever raw anchor is closer to the pin is the pin.
    const dA = dist(rawA.x, rawA.y, pinX, pinY);
    const dB = dist(rawB.x, rawB.y, pinX, pinY);
    return dA <= dB ? { a: pin, b: mover } : { a: mover, b: pin };
  }

  const axis = dim.axis || 'aligned';
  // Axis unit vector in the picked orientation (a -> b).
  let ux, uy;
  if (axis === 'horizontal') { ux = Math.sign(rawB.x - rawA.x) || 1; uy = 0; }
  else if (axis === 'vertical') { ux = 0; uy = Math.sign(rawB.y - rawA.y) || 1; }
  else {
    const dx = rawB.x - rawA.x, dy = rawB.y - rawA.y;
    const len = Math.hypot(dx, dy) || 1;
    ux = dx / len; uy = dy / len;
  }

  // No driving value: just snap both anchors to nearest current vertices.
  if (dim.value == null || !isFinite(dim.value)) {
    const sa = nearestPoint(pts, rawA.x, rawA.y) || rawA;
    const sb = nearestPoint(pts, rawB.x, rawB.y) || rawB;
    return { a: { x: sa.x, y: sa.y }, b: { x: sb.x, y: sb.y } };
  }

  // Determine which endpoint was pinned (same rule applyDimension uses): the
  // side with more vertices stays put. Snap the pin to its live vertex, then
  // project the mover out to the driven length along the axis.
  let n0 = 0, n1 = 0;
  for (const p of pts) {
    const r0 = (p.x - rawA.x) * ux + (p.y - rawA.y) * uy;
    const r1 = (p.x - rawB.x) * ux + (p.y - rawB.y) * uy;
    if (r0 > 1e-6) n1++;
    if (r1 < -1e-6) n0++;
  }
  const aIsPin = n0 >= n1;
  const pinRaw = aIsPin ? rawA : rawB;
  const pinSnapped = nearestPoint(pts, pinRaw.x, pinRaw.y) || pinRaw;
  // Direction from pin toward mover (preserving picked orientation).
  const dirSign = aIsPin ? 1 : -1;
  const dvx = ux * dirSign, dvy = uy * dirSign;
  const moverX = pinSnapped.x + dvx * dim.value;
  const moverY = pinSnapped.y + dvy * dim.value;
  const pin = { x: pinSnapped.x, y: pinSnapped.y };
  const mover = { x: moverX, y: moverY };
  // Return in the original a/b order so witness lines stay consistent.
  return aIsPin ? { a: pin, b: mover } : { a: mover, b: pin };
}

function arrowPath(tipX, tipY, dirX, dirY, size) {
  // dir points from the tip back along the dimension line
  const len = Math.hypot(dirX, dirY) || 1;
  const ux = dirX / len, uy = dirY / len;
  const px = -uy, py = ux; // perpendicular
  const w = size * 0.35;
  const bx = tipX + ux * size, by = tipY + uy * size;
  const x1 = bx + px * w, y1 = by + py * w;
  const x2 = bx - px * w, y2 = by - py * w;
  return `M ${tipX} ${tipY} L ${x1} ${y1} L ${x2} ${y2} Z`;
}

function fmtValue(v, decimals, units) {
  if (v == null || !isFinite(v)) return '';
  const s = Number(v).toFixed(decimals);
  return units ? `${s} ${units}` : s;
}

/* Build a dimAnnotation geo describing witness lines, the dimension line,
   arrowheads and the value label for a single dimension on the driven geo. */
function buildAnnotation(geo, dim, style) {
  const { color, textSize, arrowSize, decimals, units } = style;
  const lines = [];
  const arrows = [];
  let label = null;
  // The point on the geometry that a dragged label's leader connects back to.
  let leaderAnchor = null;

  if (dim.kind === 'arcRadius') {
    // Measure-only radius of a clicked arc on a compound/boolean shape.
    const cx0 = dim.ax, cy0 = dim.ay;
    if (cx0 == null || cy0 == null) return null;
    const circ = fitCircleAt(geo, cx0, cy0);
    if (!circ) return null;
    // Passive (driven) dimensions render in a muted colour to signal they
    // are read-only, mirroring SolidWorks' grey driven dimensions.
    const passiveStyle = { ...style, color: PASSIVE_DIM_COLOR };
    // Anchor the arrow exactly on the clicked arc point so the leader always
    // touches the visible arc (the fitted centre may be slightly off, but the
    // click is guaranteed to lie on the curve). Direction = centre -> click.
    let dx = cx0 - circ.cx, dy = cy0 - circ.cy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const tipX = cx0, tipY = cy0;
    lines.push([circ.cx, circ.cy, tipX, tipY]);
    arrows.push(arrowPath(tipX, tipY, -ux, -uy, arrowSize));
    const lx = tipX + ux * textSize * 1.4;
    const ly = tipY + uy * textSize * 1.4;
    label = { x: lx, y: ly, text: 'R' + fmtValue(circ.r, decimals, units), anchor: 'middle' };
    leaderAnchor = { x: tipX, y: tipY };
    return finishAnnotation(dim, lines, arrows, label, leaderAnchor, passiveStyle, true);
  }

  if (dim.kind === 'radius' || dim.kind === 'diameter') {
    const circle = detectCircle(geo);
    if (!circle) return null;
    const dirAng = (dim.labelAngle ?? -45) * Math.PI / 180;
    const ux = Math.cos(dirAng), uy = Math.sin(dirAng);
    const isDia = dim.kind === 'diameter';
    const startX = isDia ? circle.cx - ux * circle.r : circle.cx;
    const startY = isDia ? circle.cy - uy * circle.r : circle.cy;
    const tipX = circle.cx + ux * circle.r;
    const tipY = circle.cy + uy * circle.r;
    lines.push([startX, startY, tipX, tipY]);
    arrows.push(arrowPath(tipX, tipY, -ux, -uy, arrowSize));
    if (isDia) arrows.push(arrowPath(startX, startY, ux, uy, arrowSize));
    const lx = circle.cx + ux * (circle.r + textSize * 1.4);
    const ly = circle.cy + uy * (circle.r + textSize * 1.4);
    const prefix = isDia ? '\u2300' : 'R';
    label = { x: lx, y: ly, text: prefix + fmtValue(isDia ? circle.r * 2 : circle.r, decimals, units), anchor: 'middle' };
    leaderAnchor = { x: tipX, y: tipY };
    return finishAnnotation(dim, lines, arrows, label, leaderAnchor, style, true);
  }

  if (dim.kind === 'fillet') {
    // The geo passed in is already filleted, so the original sharp corner is
    // gone. Use the live corner position (resolved against the pre-fillet geo)
    // so the leader stays on the corner even after the shape was resized.
    const cx = dim._corner?.x ?? dim.ax;
    const cy = dim._corner?.y ?? dim.ay;
    if (cx == null || cy == null) return null;
    const b = geo.bounds || { x: cx, y: cy, width: 0, height: 0 };
    const centerX = b.x + b.width / 2;
    const centerY = b.y + b.height / 2;
    let dirX = centerX - cx, dirY = centerY - cy;
    const len = Math.hypot(dirX, dirY) || 1;
    dirX /= len; dirY /= len;
    const r = dim.value > 0 ? dim.value : 0;
    // Leader runs from a point on the rounded arc inward a short distance.
    const arcX = cx + dirX * r * 0.6;
    const arcY = cy + dirY * r * 0.6;
    const tailX = cx + dirX * (r * 0.6 + textSize * 2.2);
    const tailY = cy + dirY * (r * 0.6 + textSize * 2.2);
    lines.push([arcX, arcY, tailX, tailY]);
    arrows.push(arrowPath(arcX, arcY, dirX, dirY, arrowSize));
    label = {
      x: tailX + dirX * textSize * 0.6,
      y: tailY + dirY * textSize * 0.6,
      text: 'R' + fmtValue(r, decimals, units),
      anchor: 'middle',
    };
    leaderAnchor = { x: arcX, y: arcY };
    return finishAnnotation(dim, lines, arrows, label, leaderAnchor, style, true);
  }

  const pts = extractPoints(geo);

  if (dim.kind === 'angle') {
    let v, ang1, ang2;
    if (dim._angleDrive) {
      // Use the recorded drive so the annotation reflects the NEW angle. Arm A
      // is the fixed reference; arm B is at angA + sign*value.
      const dr = dim._angleDrive;
      v = { x: dr.vx, y: dr.vy };
      ang1 = dr.angA;
      ang2 = dr.angA + dr.sign * dr.value * Math.PI / 180;
    } else {
      v = resolveAnchor(pts, dim, 'v', 'vx', 'vy');
      const a = resolveAnchor(pts, dim, 'a', 'ax', 'ay');
      const b = resolveAnchor(pts, dim, 'b', 'bx', 'by');
      if (!v || !a || !b) return null;
      ang1 = Math.atan2(a.y - v.y, a.x - v.x);
      ang2 = Math.atan2(b.y - v.y, b.x - v.x);
    }
    const r = autoOffset(geo, pts) * 1.2;
    // small witness extensions along each arm
    lines.push([v.x, v.y, v.x + Math.cos(ang1) * r, v.y + Math.sin(ang1) * r]);
    lines.push([v.x, v.y, v.x + Math.cos(ang2) * r, v.y + Math.sin(ang2) * r]);
    // arc between arms
    const steps = 24;
    let delta = ang2 - ang1;
    while (delta <= -Math.PI) delta += Math.PI * 2;
    while (delta > Math.PI) delta -= Math.PI * 2;
    for (let i = 0; i < steps; i++) {
      const t0 = ang1 + delta * (i / steps);
      const t1 = ang1 + delta * ((i + 1) / steps);
      lines.push([
        v.x + Math.cos(t0) * r, v.y + Math.sin(t0) * r,
        v.x + Math.cos(t1) * r, v.y + Math.sin(t1) * r,
      ]);
    }
    const mid = ang1 + delta / 2;
    const lx = v.x + Math.cos(mid) * (r + textSize);
    const ly = v.y + Math.sin(mid) * (r + textSize);
    label = { x: lx, y: ly, text: fmtValue(Math.abs(delta) * 180 / Math.PI, decimals, '') + '\u00b0', anchor: 'middle' };
    // A dragged angle label just relocates the number — don't draw a leader
    // stub (that was the stray "extra line"). Pass no leaderAnchor so
    // finishAnnotation only repositions the label.
    return finishAnnotation(dim, lines, arrows, label, null, style);
  }

  // linear
  // After driving, the moved edge no longer sits at the originally-picked
  // coordinates, so resolving against the stale ax/ay/bx/by leaves the
  // annotation behind. Re-derive the current endpoints from the live geometry
  // (pinned point stays put; the moved point is pin + axis*value).
  const ep = drivenLinearEndpoints(pts, dim);
  if (!ep) return null;
  const a = ep.a, b = ep.b;
  const axis = dim.axis || 'aligned';
  const off = autoOffset(geo, pts);
  const hasPos = dim.labelPos && isFinite(dim.labelPos.x) && isFinite(dim.labelPos.y);

  let ax = a.x, ay = a.y, bx = b.x, by = b.y;
  let measured;

  if (axis === 'horizontal') {
    measured = Math.abs(bx - ax);
    // When the label has been dragged, the whole dimension line (and its
    // arrowheads) follows it to the dragged height; otherwise use the default
    // offset below the edge.
    const lineY = hasPos ? dim.labelPos.y : Math.max(ay, by) + off;
    lines.push([ax, ay, ax, lineY]);          // witness 1
    lines.push([bx, by, bx, lineY]);          // witness 2
    lines.push([ax, lineY, bx, lineY]);       // dimension line
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
    // aligned
    measured = dist(ax, ay, bx, by);
    let dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const nx = -dy, ny = dx; // perpendicular
    // The perpendicular distance of the dimension line follows the dragged
    // label (projected onto the perpendicular); the label may also slide along
    // the line. Falls back to the fixed offset when not dragged.
    let perp = off;
    let along = 0;
    if (hasPos) {
      const mx0 = (ax + bx) / 2, my0 = (ay + by) / 2;
      const rx = dim.labelPos.x - mx0, ry = dim.labelPos.y - my0;
      perp = rx * nx + ry * ny;
      along = rx * dx + ry * dy;
    }
    const ox = nx * perp, oy = ny * perp;
    const a2x = ax + ox, a2y = ay + oy, b2x = bx + ox, b2y = by + oy;
    lines.push([ax, ay, a2x, a2y]);   // witness 1
    lines.push([bx, by, b2x, b2y]);   // witness 2
    lines.push([a2x, a2y, b2x, b2y]); // dimension line
    arrows.push(arrowPath(a2x, a2y, b2x - a2x, b2y - a2y, arrowSize));
    arrows.push(arrowPath(b2x, b2y, a2x - b2x, a2y - b2y, arrowSize));
    const mx = (a2x + b2x) / 2 + dx * along + nx * textSize * 0.7;
    const my = (a2y + b2y) / 2 + dy * along + ny * textSize * 0.7;
    label = { x: mx, y: my, text: fmtValue(measured, decimals, units), anchor: 'middle' };
  }

  // Linear labels already move with the dimension line above, so don't let
  // finishAnnotation add a trailing connector.
  return finishAnnotation({ ...dim, labelPos: undefined }, lines, arrows, label, null, style);
}

/* If the dimension has a dragged label position (dim.labelPos), relocate the
   label there. For leader-style callouts (radius/diameter/fillet) the whole
   leader and its arrowhead follow the label: a single line runs from the
   feature to the moved text with the arrowhead planted on the feature, just
   like SolidWorks. For linear/angle dimensions the measurement line and its
   arrowheads stay on the feature and only a thin connector trails to the text. */
function finishAnnotation(dim, lines, arrows, label, leaderAnchor, style, leaderType) {
  const { color, textSize, arrowSize } = style;
  if (dim.labelPos && isFinite(dim.labelPos.x) && isFinite(dim.labelPos.y) && leaderAnchor) {
    label = { ...label, x: dim.labelPos.x, y: dim.labelPos.y };
    let dx = label.x - leaderAnchor.x;
    let dy = label.y - leaderAnchor.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const gap = textSize * 0.9;
    const endX = label.x - ux * gap;
    const endY = label.y - uy * gap;
    if (leaderType) {
      // The arrow + arrowhead come along: drop the original feature stub and
      // draw one leader from the feature anchor out to the label.
      lines = [[leaderAnchor.x, leaderAnchor.y, endX, endY]];
      // dir points from the tip (feature) back toward the label.
      arrows = [arrowPath(leaderAnchor.x, leaderAnchor.y, ux, uy, arrowSize)];
    } else {
      lines.push([leaderAnchor.x, leaderAnchor.y, endX, endY]);
    }
  } else if (dim.labelPos && isFinite(dim.labelPos.x) && isFinite(dim.labelPos.y)) {
    label = { ...label, x: dim.labelPos.x, y: dim.labelPos.y };
  }
  return { type: 'dimAnnotation', lines, arrows, label, color, textSize, bounds: annBounds(lines, label, textSize) };
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

export function getDimensionLabelPoint(geo, dim, style) {
  const ann = buildAnnotation(geo, dim, style || { color: '#000', textSize: 14, arrowSize: 8, decimals: 1, units: '' });
  return ann && ann.label ? { x: ann.label.x, y: ann.label.y, text: ann.label.text } : null;
}

export function measureDimension(geo, dim) {
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
    // Default the fillet radius to a fraction of the shape so the first value
    // is sensible; the user then edits it.
    const b = geo?.bounds;
    if (b) return Math.round(Math.min(b.width, b.height) * 0.2 * 100) / 100;
    return 10;
  }
  const pts = extractPoints(geo);
  if (dim.kind === 'angle') {
    const v = resolveAnchor(pts, dim, 'v', 'vx', 'vy');
    const a = resolveAnchor(pts, dim, 'a', 'ax', 'ay');
    const b = resolveAnchor(pts, dim, 'b', 'bx', 'by');
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
  if (!inputGeo) return null;
  ensurePaper();
  let driven = inputGeo;
  for (const dim of dims) {
    driven = applyDimension(driven, dim);
  }
  resolveFilletCorners(driven, dims);
  return applyFillets(driven, dims);
}

/* For each fillet dim, snap its stored corner (ax/ay) to the nearest vertex of
   the geometry as it stands right before fillets are applied, and stash the
   live position on dim._corner. This keeps the fillet (and its leader) glued to
   the right corner even after linear dimensions resize the shape. */
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

/* Apply all fillet dimensions in a single pass. Doing every corner at once from
   the current (pre-fillet) geometry avoids re-parsing already-rounded arcs as
   straight segments, which previously turned an earlier fillet into a chamfer
   when a second fillet was added. */
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

  // Drive geometry by applying each dimension that has a target value.
  let driven = inputGeo;
  for (const dim of dims) {
    driven = applyDimension(driven, dim);
  }
  resolveFilletCorners(driven, dims);
  driven = applyFillets(driven, dims);

  if (!showDims || dims.length === 0) {
    return driven;
  }

  const annotations = [];
  for (const dim of dims) {
    const ann = buildAnnotation(driven, dim, style);
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
