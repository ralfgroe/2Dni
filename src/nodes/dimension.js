import paper from 'paper';
import { geoToPaperPath, flattenGeoToPathData } from '../utils/geoPathUtils';
import { extractPoints } from '../utils/geometryPoints';
import { filletCornersAt } from './radius';
import { buildSystem, solve, tryAddConstraint, analyzeDOF, buildStiffness } from './constraintSolver';

/*
 * Dimensioning core, rebuilt on a real geometric constraint solver.
 *
 * The previous heuristic "push one vertex" approach could never reliably mimic
 * SolidWorks, so this version models the sketch the way a CAD kernel does:
 *   - every sketch vertex is a pair of unknowns (x, y);
 *   - each edge gets an implicit relation (Horizontal / Vertical / fixed-angle)
 *     inferred from how it was drawn, so undimensioned geometry stays rigid;
 *   - each user dimension/relation is a constraint equation;
 *   - constraintSolver.js solves the whole system numerically, returning the
 *     minimal-movement configuration that satisfies everything.
 *
 * Dimensions are added incrementally (creation order). A new dimension that the
 * solver cannot satisfy without breaking an earlier one — or that adds no new
 * information — is OVER-DEFINED: it is flagged red with an "X" and NOT applied,
 * exactly like SolidWorks. The whole sketch is also classified under/fully/over-
 * defined for status coloring (blue / black / red).
 */

const CONFLICT_DIM_COLOR = '#e03131';
const PASSIVE_DIM_COLOR = '#868e96';
const UNDER_COLOR = '#1366d6';  // blue: under-defined (free DOF remain)
const FULLY_COLOR = '#1a1a1a';  // black: fully defined

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

/* Normalize any input geometry to a canonical booleanResult so its vertex order
   is fixed for the whole drive sequence. */
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

/* ---- sketch extraction: geometry -> {vertices, edges, closed, subpaths} ----
   The solver works on a flat list of vertices and the edges (vertex-index pairs)
   connecting them. We pull these from the path's segments, preserving order so a
   vertex index is stable across edits (driving never reorders segments). Each
   subpath records its [startIdx, endIdx, closed] so we can rebuild pathData. */
function geoToSketch(geo) {
  ensurePaper();
  const path = geoToPaperPath(geo);
  if (!path) return null;
  try {
    const children = path.className === 'CompoundPath' ? (path.children || []) : [path];
    const vertices = [];
    const edges = [];
    const subpaths = [];
    let gi = 0;
    for (const child of children) {
      const segs = child.segments || [];
      if (segs.length === 0) continue;
      const start = gi;
      for (const s of segs) {
        vertices.push({
          x: s.point.x,
          y: s.point.y,
          // store relative bezier handles so curved edges keep their shape when
          // their anchor vertex moves.
          hin: s.handleIn ? { x: s.handleIn.x, y: s.handleIn.y } : null,
          hout: s.handleOut ? { x: s.handleOut.x, y: s.handleOut.y } : null,
        });
        gi++;
      }
      const end = gi - 1;
      const closed = !!child.closed;
      for (let i = start; i < end; i++) edges.push([i, i + 1]);
      if (closed && end > start) edges.push([end, start]);
      subpaths.push({ start, end, closed });
    }
    return { vertices, edges, subpaths, source: geo };
  } finally {
    path.remove();
  }
}

/* Rebuild a booleanResult from solved vertex positions, reusing the stored
   bezier handles so curves are preserved. */
function sketchToGeo(sketch, V, source) {
  ensurePaper();
  const children = [];
  for (const sp of sketch.subpaths) {
    const p = new paper.Path();
    for (let i = sp.start; i <= sp.end; i++) {
      const v = sketch.vertices[i];
      const pt = new paper.Point(V[2 * i], V[2 * i + 1]);
      const seg = new paper.Segment(pt,
        v.hin ? new paper.Point(v.hin.x, v.hin.y) : null,
        v.hout ? new paper.Point(v.hout.x, v.hout.y) : null);
      p.add(seg);
    }
    if (sp.closed) p.closePath();
    children.push(p);
  }
  let item;
  if (children.length === 1) {
    item = children[0];
  } else {
    item = new paper.CompoundPath({ children });
  }
  const out = paperPathToGeo(item, source);
  item.remove();
  return out;
}

/* ---- anchor resolution (single source of truth for drive + annotation) ---- */

function nearestPoint(pts, x, y) {
  if (!isFinite(x) || !isFinite(y)) return null;
  let best = null, bestD = Infinity;
  for (const p of pts) {
    const d = dist(p.x, p.y, x, y);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

function nearestPointExcept(pts, x, y, exceptIdx) {
  let best = null, bestD = Infinity;
  for (const p of pts) {
    if (p.idx === exceptIdx) continue;
    const d = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}

/* Resolve a dimension anchor to a live vertex, trusting the bound canonical
   index first, then coordinate-nearest, then the raw stored coordinate. */
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

/* Bind each dimension's anchors to canonical vertex indices once, before any
   solving, so a dimension keeps referring to the same corner across edits. */
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
      if (dim._ai != null && dim._ai === dim._bi) {
        if (Number.isInteger(dim.a) && Number.isInteger(dim.b)
            && dim.a !== dim.b
            && dim.a >= 0 && dim.a < canonicalPts.length
            && dim.b >= 0 && dim.b < canonicalPts.length) {
          dim._ai = dim.a;
          dim._bi = dim.b;
        } else if (dim.bx != null && dim.by != null) {
          const alt = nearestPointExcept(canonicalPts, dim.bx, dim.by, dim._ai);
          if (alt) dim._bi = alt.idx;
        }
      }
    }
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

/* Resolve an angle's three points by topology so the annotation tracks the
   rotated arm after driving instead of a stale stored coordinate. */
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

/* ---- circular-shape detection ---- */

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
    if (curvedFrac < 0.6) return false;
    if (b.width < 1e-6 || b.height < 1e-6) return false;
    const ratio = area / (b.width * b.height);
    return ratio > 0.70 && ratio < 0.92;
  } catch {
    return false;
  }
}

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

/* ---- constraint assembly ---------------------------------------------------
   Build the solver constraint list for a sketch + the user's dimensions.

   Order matters for SolidWorks-style behavior:
     1. Anchor the first vertex of the first subpath (grounds translation).
     2. Add an implicit relation per edge (H / V / fixed-angle) so undimensioned
        geometry stays rigid. A directional explicit relation on the same edge
        supersedes its implicit one; a distance dimension does NOT (a dimensioned
        horizontal wall is still horizontal).
     3. Add the user's driving dimensions in creation order via tryAddConstraint,
        so any that can't be satisfied are detected as conflicts and skipped. */

const EDGE_KEY = (a, b) => `${Math.min(a, b)}-${Math.max(a, b)}`;

/* Map a dimension's resolved anchor vertices back to sketch vertex indices.
   The sketch vertex order matches extractPoints' idx order (both come from the
   same path segment walk), so the bound index is directly usable. */
function dimVertexIndices(dim, pts) {
  const out = {};
  for (const [ik, xk, yk] of [['a', 'ax', 'ay'], ['b', 'bx', 'by'], ['v', 'vx', 'vy']]) {
    const r = resolveAnchor(pts, dim, ik, xk, yk);
    if (r && r.idx >= 0) out[ik] = r.idx;
  }
  return out;
}

/* Implicit per-edge relations from the seed geometry. */
function implicitRelations(sketch, V) {
  const rels = [];
  for (const [a, b] of sketch.edges) {
    const dx = V[2 * b] - V[2 * a];
    const dy = V[2 * b + 1] - V[2 * a + 1];
    const adx = Math.abs(dx), ady = Math.abs(dy);
    let rel;
    if (ady < 1e-4 && adx > 1e-4) rel = { type: 'horizontal', a, b };
    else if (adx < 1e-4 && ady > 1e-4) rel = { type: 'vertical', a, b };
    else rel = { type: 'fixedAngle', a, b, theta0: Math.atan2(dy, dx) };
    rel._edge = [a, b];
    rels.push(rel);
  }
  return rels;
}

/* Convert one driving dimension to a solver constraint (or null if it doesn't
   drive vertices, e.g. arcRadius/fillet which are cosmetic/measure-only). */
function dimToConstraint(dim, idx) {
  if (dim.value == null || !isFinite(dim.value)) return null;
  if (dim.kind === 'relation') {
    if (dim.relation === 'horizontal' && idx.a != null && idx.b != null) return { type: 'horizontal', a: idx.a, b: idx.b, _edge: [idx.a, idx.b] };
    if (dim.relation === 'vertical' && idx.a != null && idx.b != null) return { type: 'vertical', a: idx.a, b: idx.b, _edge: [idx.a, idx.b] };
    return null;
  }
  if (dim.kind === 'angle') {
    if (idx.v == null || idx.a == null || idx.b == null) return null;
    return { type: 'angle', v: idx.v, a: idx.a, b: idx.b, value: dim.value };
  }
  if (dim.kind === 'linear' || !dim.kind) {
    if (idx.a == null || idx.b == null) return null;
    const axis = dim.axis === 'horizontal' ? 'horizontal' : dim.axis === 'vertical' ? 'vertical' : 'aligned';
    return { type: 'distance', a: idx.a, b: idx.b, axis, value: dim.value };
  }
  return null;
}

/* The public solve. Returns { geo, skeleton, conflicts:Set<id>, status, perDim }.
   `geo` is the display geometry (fillets baked in); `skeleton` is the solved
   polygon WITHOUT fillets, used for picking/anchoring/measuring. */
export function solveDimensions(inputGeo, dimsRaw) {
  const input = normalizeInput(inputGeo);
  if (!input) return { geo: inputGeo, skeleton: inputGeo, conflicts: new Set(), status: 'under', perDim: {} };

  // Radial / fillet dims don't drive vertices; split them out (applied later).
  const dims = (dimsRaw || []).slice();
  const driveDims = dims.filter((d) => d.kind !== 'arcRadius' && d.kind !== 'fillet' && d.kind !== 'radius' && d.kind !== 'diameter');

  const sketch = geoToSketch(input);
  if (!sketch || sketch.vertices.length < 2) {
    // Nothing to solve numerically (e.g. a circle) — fall back to circle drive.
    const geo = driveCircles(input, dims);
    return { geo, skeleton: geo, conflicts: new Set(), status: 'under', perDim: {} };
  }

  // Canonical points for anchor binding (idx order matches sketch vertex order).
  const canonicalPts = sketch.vertices.map((v, i) => ({ x: v.x, y: v.y, idx: i, sharp: true }));
  bindAnchors(canonicalPts, driveDims);

  const n = sketch.vertices.length;
  const sys0 = buildSystem(sketch.vertices, []);
  const V0 = sys0.V;

  // Base constraints: ground + implicit relations (minus those superseded by an
  // explicit directional relation dimension on the same edge).
  const explicitDirEdges = new Set();
  for (const d of driveDims) {
    if (d.kind === 'relation') {
      const idx = dimVertexIndices(d, canonicalPts);
      if (idx.a != null && idx.b != null) explicitDirEdges.add(EDGE_KEY(idx.a, idx.b));
    }
  }
  const base = [{ type: 'anchor', v: 0, x: V0[0], y: V0[1] }];
  for (const rel of implicitRelations(sketch, V0)) {
    if (explicitDirEdges.has(EDGE_KEY(rel._edge[0], rel._edge[1]))) continue;
    base.push(rel);
  }

  // Add each driving dimension in creation order. Over-defined ones are skipped
  // and flagged; the rest accumulate into the satisfied constraint set.
  const conflicts = new Set();
  const perDim = {};
  let active = base.slice();

  for (const d of driveDims) {
    const idx = dimVertexIndices(d, canonicalPts);
    const c = dimToConstraint(d, idx);
    if (!c) { perDim[d.id] = 'inactive'; continue; }
    const res = tryAddConstraint(active, c, sketch.vertices, {
      stiffness: buildStiffness(n, [...active, c]),
    });
    if (res.conflict) {
      conflicts.add(d.id);
      perDim[d.id] = 'conflict';
      // keep prior solution; do not add the conflicting constraint
    } else {
      active.push(c);
      perDim[d.id] = 'driving';
    }
  }

  // Final solve of all accepted constraints for a clean configuration.
  const sysF = buildSystem(sketch.vertices, active);
  const solvedF = solve(sysF, { stiffness: buildStiffness(n, active) });
  const dof = analyzeDOF(sysF, solvedF);
  const status = conflicts.size > 0 ? 'over' : dof.status;

  let skeleton = sketchToGeo(sketch, solvedF.V, input);
  if (!skeleton || !skeleton.pathData) skeleton = input;

  // The display geometry has cosmetic fillets baked in, but the SKELETON (the
  // solved polygon without fillets) is what the overlay must pick/anchor/measure
  // against — fillets add arc points that would otherwise shift vertex indices
  // and corrupt every dimension's anchor. Keep the two separate.
  const geo = applyFillets(skeleton, dims);
  return { geo, skeleton, conflicts, status, perDim };
}

/* Circle/ellipse driving for round shapes (no polygon vertices to solve). A
   radius/diameter dim scales uniformly; a per-axis linear dim scales that axis
   (lets you turn a circle into an ellipse), about the shape center. */
function driveCircles(geo, dims) {
  const circle = detectCircle(geo);
  if (!circle) return geo;
  let sx = 1, sy = 1;
  for (const d of dims) {
    if (d.value == null || !isFinite(d.value) || d.value <= 0) continue;
    if (d.kind === 'radius') { sx = sy = d.value / circle.r; }
    else if (d.kind === 'diameter') { sx = sy = (d.value / 2) / circle.r; }
    else if (d.kind === 'linear' || !d.kind) {
      const target = d.value / 2; // half-extent
      if (d.axis === 'vertical') sy = target / circle.r;
      else sx = target / circle.r;
    }
  }
  if (sx === 1 && sy === 1) return geo;
  ensurePaper();
  const path = geoToPaperPath(geo);
  if (!path) return geo;
  path.scale(sx, sy, new paper.Point(circle.cx, circle.cy));
  const out = paperPathToGeo(path, geo);
  path.remove();
  return out && out.pathData ? out : geo;
}

/* ---- fillets (cosmetic corners, applied after solving) ---- */

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

function applyFillets(geo, dims) {
  const fillets = dims.filter((d) => d.kind === 'fillet' && d.value > 0 && d.ax != null && d.ay != null);
  if (fillets.length === 0) return geo;
  resolveFilletCorners(geo, dims);
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

/* ---- annotation builders (visual contract for dimAnnotation) ---- */

function arrowPath(tipX, tipY, dirX, dirY, size) {
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
  if (style.conflict && label) {
    ann.color = CONFLICT_DIM_COLOR;
    ann.label = { ...label, text: 'X' };
    ann.marker = { type: 'conflict', x: label.x, y: label.y, size: textSize };
  }
  return ann;
}

/* Build the dimAnnotation for a single dimension on the ALREADY-DRIVEN geo. */
function buildAnnotation(geo, dim, style, conflict) {
  if (conflict) style = { ...style, conflict: true };
  const { color, textSize, arrowSize, decimals, units } = style;
  const lines = [];
  const arrows = [];
  let label = null;

  if (dim.kind === 'relation') {
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

  // linear
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
  return finishAnnotation({ ...dim, labelPos: undefined }, lines, arrows, label, null, style);
}

/* ---- public API ---- */

export function getDimensionLabelPoint(geo, dim, style) {
  const ann = buildAnnotation(geo, dim, style || { color: '#000', textSize: 14, arrowSize: 8, decimals: 1, units: '' });
  return ann && ann.label ? { x: ann.label.x, y: ann.label.y, text: ann.label.text } : null;
}

export function measureDimension(geo, dim) {
  if (dim.kind === 'relation') {
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

export function dimensionRuntime(params, inputs) {
  const inputGeo = inputs.geometry_in;
  if (!inputGeo) return null;

  const dims = parseDimensions(params.dimensions);
  const showDims = params.show_dimensions !== false;
  const showStatus = params.show_status !== false;
  const style = {
    color: params.dim_color ?? UNDER_COLOR,
    textSize: params.text_size ?? 14,
    arrowSize: params.arrow_size ?? 8,
    decimals: params.decimals ?? 1,
    units: params.units ?? '',
  };

  ensurePaper();

  const solved = solveDimensions(inputGeo, dims);
  let driven = solved ? solved.geo : inputGeo;
  const skeleton = solved ? solved.skeleton : inputGeo;
  const conflicts = solved ? solved.conflicts : new Set();
  const status = solved ? solved.status : 'under';

  // SolidWorks-style status coloring of the geometry itself (blue/black/red).
  if (showStatus && driven) {
    const statusStroke = status === 'over' ? CONFLICT_DIM_COLOR : status === 'fully' ? FULLY_COLOR : UNDER_COLOR;
    driven = { ...driven, stroke: statusStroke };
  }

  if (!showDims || dims.length === 0) return driven;

  // Annotations anchor/measure against the un-filleted skeleton so corner
  // fillets don't shift vertex indices and detach dimensions.
  const annotations = [];
  for (const dim of dims) {
    const ann = buildAnnotation(skeleton, dim, style, conflicts.has(dim.id));
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

