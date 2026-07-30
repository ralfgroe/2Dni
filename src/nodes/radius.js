import paper from 'paper';
import { ensurePaper as __ensureMainPaper } from '../utils/geoPathUtils';
import { flattenGeoToPathData } from '../utils/geoPathUtils';


function ensurePaper() {
  __ensureMainPaper();
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
      // Curve-preserving fillet (Paper-based): only rounds genuine sharp
      // corners and leaves smooth Bézier curve runs (letter bowls, etc.)
      // untouched. Falls back to the legacy polyline fillet only if that fails.
      let result = filletPathDataPaper(workGeo.pathData, radius, point_selection);
      if (!result) result = filletPathData(workGeo.pathData, radius, point_selection);
      if (!result) return inputGeo;

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

// Curve-preserving corner fillet built on Paper.js. Unlike the legacy polyline
// filletPathData (which discards Bézier handles and treats every anchor as a
// polygon vertex — shattering smooth glyph curves into facets), this walks each
// contour's SEGMENTS, rounds only the genuinely sharp corners, and leaves the
// smooth curve runs (letter bowls, arcs) completely intact. Corners are indexed
// with a single global counter across all contours so the indices line up with
// extractPoints() and the Point Selection UI.
function filletPathDataPaper(pathData, radius, pointSel) {
  ensurePaper();
  let compound;
  try {
    compound = new paper.CompoundPath(pathData);
  } catch {
    return null;
  }
  const children = (compound.children && compound.children.length)
    ? compound.children
    : [compound];
  if (!children.length || !children[0].segments) { compound.remove(); return null; }

  // Total segment count for '*' selection parsing (matches extractPoints).
  let totalSegs = 0;
  for (const ch of children) totalSegs += (ch.segments ? ch.segments.length : 0);
  const selected = parsePointSelection(pointSel, totalSegs);

  const out = new paper.CompoundPath({ insert: false });
  let globalIdx = 0;

  for (const child of children) {
    const n = child.segments ? child.segments.length : 0;
    if (n < 2) { globalIdx += n; continue; }

    // Work on a clone so we can freely divide curves without disturbing others.
    const work = child.clone({ insert: false });
    const closed = work.closed;

    // Decide which corners to round (by original segment index), and how far
    // back along each adjacent curve the tangency points sit. We compute this
    // on the ORIGINAL geometry, then apply via curve splitting so handles on the
    // untouched parts of neighboring curves stay correct.
    const rounds = []; // { i, off }
    for (let i = 0; i < n; i++) {
      const idx = globalIdx + i;
      const cornerAngle = paperCornerAngle(work, i);
      if (!(cornerAngle > SMOOTH_ANGLE_DEG)) continue;
      if (!selected.has(idx)) continue;
      if (!closed && (i === 0 || i === n - 1)) continue;

      const curves = work.curves;
      const cIn = curves[(i - 1 + curves.length) % curves.length];
      const cOut = curves[i % curves.length];
      if (!cIn || !cOut) continue;

      const tanHalf = Math.tan((cornerAngle * Math.PI / 180) / 2) || 0.001;
      const wanted = radius / tanHalf;
      const off = Math.min(wanted, cIn.length * 0.45, cOut.length * 0.45);
      if (off > 0.01) rounds.push({ i, off });
    }

    if (rounds.length === 0) {
      out.addChild(work);
      globalIdx += n;
      continue;
    }

    // For each rounded corner, split the incoming curve at (len - off) and the
    // outgoing curve at (off). Track the corner segment (to remove) and its two
    // new neighbor tangency segments (to bridge with a rounding arc). We resolve
    // everything by segment IDENTITY (the corner's Segment object) so divides in
    // one place don't invalidate the others.
    const cornerSegs = rounds.map((r) => ({ seg: work.segments[r.i], off: r.off }));

    for (const c of cornerSegs) {
      const seg = c.seg;
      const path = seg.path;
      if (!path) continue;
      const curves = path.curves;
      const si = seg.index;
      const cIn = curves[(si - 1 + curves.length) % curves.length];
      const cOut = curves[si % curves.length];
      if (!cIn || !cOut) continue;

      // Tangency point locations (as CurveLocation) before we mutate.
      const locA = cIn.getLocationAt(Math.max(0, cIn.length - c.off));
      const locB = cOut.getLocationAt(Math.min(cOut.length, c.off));
      if (!locA || !locB) continue;

      // Divide creates real segments at those points with correct handles on the
      // preserved sub-curves. Divide the later one first isn't needed since they
      // live on different curves around the same corner.
      const segA = cIn.divideAtTime ? divideAtLocation(cIn, locA) : null;
      // cOut may have shifted index after the previous divide; re-fetch via seg.
      const cOut2 = seg.path.curves[seg.index % seg.path.curves.length];
      const locB2 = cOut2 ? cOut2.getLocationAt(Math.min(cOut2.length, c.off)) : null;
      const segB = (cOut2 && locB2) ? divideAtLocation(cOut2, locB2) : null;
      if (!segA || !segB) continue;

      // Remove the original corner anchor and connect segA -> segB with a
      // circular-arc-like cubic. The KEY to getting both convex AND concave
      // corners right is to aim both bridge handles at the ORIGINAL corner apex
      // (the point we're about to remove): the arc then always bulges toward the
      // corner, tucking in on convex corners and out on concave ones — exactly
      // like a real fillet. (Reading the trimmed tangents instead flips the arc
      // the wrong way on concave junctions, which produced the pinched notch.)
      const apex = seg.point.clone();
      const dA = apex.subtract(segA.point);   // segA -> corner
      const dB = apex.subtract(segB.point);    // segB -> corner
      const lenA = dA.length, lenB = dB.length;
      seg.remove();
      if (lenA > 1e-6 && lenB > 1e-6) {
        // Kappa for a quarter-circle-ish arc; scale by each side's distance to
        // the apex so the handles stay tangent to the trimmed curves.
        const k = 0.5522847498;
        segA.handleOut = dA.multiply(k);
        segB.handleIn = dB.multiply(k);
      }
    }

    out.addChild(work);
    globalIdx += n;
  }

  const pathDataOut = out.pathData;
  const b = out.bounds;
  const bounds = { x: b.x, y: b.y, width: b.width, height: b.height };
  out.remove();
  compound.remove();
  if (!pathDataOut) return null;
  return { pathData: pathDataOut, bounds };
}

// Divide a curve at a CurveLocation and return the newly created Segment (the
// shared anchor between the two resulting curves), or the nearest existing one.
function divideAtLocation(curve, loc) {
  const newCurve = curve.divideAt(loc);
  // divideAt returns the curve after the split; its segment1 is the new anchor.
  if (newCurve && newCurve.segment1) return newCurve.segment1;
  // If no split happened (loc at an endpoint), return the closest endpoint seg.
  return curve.segment2 || curve.segment1;
}


// Angle (degrees) between the incoming and outgoing curve tangents at segment i.
// 180 = perfectly smooth/straight-through; small = a sharp corner. Mirrors
// geometryPoints.getCornerAngle so sharp detection is identical.
function paperCornerAngle(childPath, segIndex) {
  const curves = childPath.curves;
  if (!curves) return 180;
  const n = curves.length;
  if (n < 2) return 180;
  const curveIn = curves[(segIndex - 1 + n) % n];
  const curveOut = curves[segIndex % n];
  if (!curveIn || !curveOut) return 180;
  const tanIn = curveIn.getTangentAtTime(1);
  const tanOut = curveOut.getTangentAtTime(0);
  if (tanIn.length < 1e-4 || tanOut.length < 1e-4) return 180;
  const dot = tanIn.dot(tanOut) / (tanIn.length * tanOut.length);
  return Math.acos(Math.max(-1, Math.min(1, dot))) * 180 / Math.PI;
}

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
  const angles = new Array(n).fill(0);
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
    const maxOffset = Math.min(segIn, segOut) * 0.45;
    const wantedOffset = radius / tanHalf;
    offsets[i] = Math.min(wantedOffset, maxOffset);
    angles[i] = angle;
  }

  for (let pass = 0; pass < 3; pass++) {
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

/* Fillet one or more corners of a polygonal path in a SINGLE pass, each with
   its own radius. Corners are identified by coordinate (matched to the nearest
   vertex). Applying every fillet in one pass from the original geometry avoids
   re-parsing already-rounded arcs as polylines (which would turn an existing
   fillet into a chamfer). `corners` = [{ x, y, radius }]. */
export function filletCornersAt(pathData, corners) {
  if (!pathData || !Array.isArray(corners) || corners.length === 0) return null;
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

  // Map each requested corner to the nearest vertex; keep the largest radius if
  // two requests resolve to the same vertex.
  const radiusByIdx = new Array(n).fill(0);
  for (const c of corners) {
    if (!(c.radius > 0)) continue;
    let best = -1, bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const d = dist(pts[i], { x: c.x, y: c.y });
      if (d < bestD) { bestD = d; best = i; }
    }
    if (best >= 0) radiusByIdx[best] = Math.max(radiusByIdx[best], c.radius);
  }

  const segLens = [];
  for (let i = 0; i < n - 1; i++) segLens.push(dist(pts[i], pts[i + 1]));
  if (closed) segLens.push(dist(pts[n - 1], pts[0]));

  const offsets = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (!(radiusByIdx[i] > 0)) continue;
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
    const maxOffset = Math.min(segIn, segOut) * 0.45;
    const wantedOffset = radiusByIdx[i] / tanHalf;
    offsets[i] = Math.min(wantedOffset, maxOffset);
  }

  // Share edge length between two adjacent rounded corners so they don't overrun.
  for (let pass = 0; pass < 3; pass++) {
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
  }

  let d = '';
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const trackBounds = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

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
    const cp1x = pA.x - dA.x * hLen, cp1y = pA.y - dA.y * hLen;
    const cp2x = pB.x - dB.x * hLen, cp2y = pB.y - dB.y * hLen;
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


