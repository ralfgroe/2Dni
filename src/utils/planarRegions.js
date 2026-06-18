import paper from 'paper';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) {
    paper.setup(canvas);
    paperInitialized = true;
  }
}

// Splits a self-intersecting path into the distinct enclosed regions (faces)
// its crossings create — like the cells you'd get from a planar arrangement of
// the curve. Returns an array of pathData strings (one closed polygon per
// region) or null when the input has no meaningful subdivision.
//
// Strategy: flatten every subpath to a polyline, collect all segment
// endpoints + self-intersection points, build a planar graph of undirected
// edges, then trace minimal cycles (faces) by always turning the sharpest
// way at each vertex. The unbounded outer face is dropped.
export function splitIntoRegions(pathData, opts = {}) {
  if (!pathData) return null;
  ensurePaper();

  const flatness = opts.flatness ?? 1.5;
  const minArea = opts.minArea ?? 1;

  let source;
  try {
    source = new paper.CompoundPath(pathData);
  } catch {
    return null;
  }

  // Flatten to polylines so intersection math is simple and robust.
  const polylines = [];
  const subpaths = source.children && source.children.length ? source.children : [source];
  for (const child of subpaths) {
    const clone = child.clone({ insert: false });
    clone.flatten(flatness);
    const pts = clone.segments.map((s) => ({ x: s.point.x, y: s.point.y }));
    const closeDist = opts.closeDist ?? 5;
    const first = pts[0];
    const last = pts[pts.length - 1];
    const nearlyClosed =
      first && last && Math.hypot(first.x - last.x, first.y - last.y) <= closeDist;
    if ((clone.closed || nearlyClosed) && pts.length > 1) {
      pts.push({ x: pts[0].x, y: pts[0].y });
    }
    clone.remove();
    if (pts.length >= 2) polylines.push(pts);
  }
  source.remove();
  if (polylines.length === 0) return null;

  return regionsFromPolylines(polylines, opts);
}

// Core planar-subdivision over already-flattened polylines (arrays of {x,y}).
// Exposed separately so it can be unit-tested without paper.js. Returns an
// array of pathData strings (one closed polygon per interior region) or null.
export function regionsFromPolylines(polylines, opts = {}) {
  const minArea = opts.minArea ?? 5;
  if (!polylines || polylines.length === 0) return null;

  // Build a flat list of line segments.
  const segs = [];
  for (const pl of polylines) {
    for (let i = 0; i < pl.length - 1; i++) {
      segs.push([pl[i], pl[i + 1]]);
    }
  }
  if (segs.length < 3) return null;

  // Snap-merge near-identical points so the graph connects cleanly. Flattened
  // curve points that meet at a junction (e.g. a rose curve's center) are never
  // bit-identical, so the tolerance must be a real distance, not epsilon.
  const eps = opts.eps ?? 1.5;
  const verts = [];
  const keyToIndex = new Map();
  const quant = (v) => Math.round(v / eps);
  function vertexId(p) {
    const k = `${quant(p.x)},${quant(p.y)}`;
    let id = keyToIndex.get(k);
    if (id === undefined) {
      id = verts.length;
      verts.push({ x: p.x, y: p.y });
      keyToIndex.set(k, id);
    }
    return id;
  }

  // For each segment, find intersections with every other segment, then split
  // the segment at those points (sorted along the segment).
  const edgeSet = new Set();
  const edges = [];
  function addEdge(a, b) {
    if (a === b) return;
    const key = a < b ? `${a}_${b}` : `${b}_${a}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push([a, b]);
  }

  for (let i = 0; i < segs.length; i++) {
    const [p1, p2] = segs[i];
    const cuts = [{ t: 0, p: p1 }, { t: 1, p: p2 }];
    for (let j = 0; j < segs.length; j++) {
      if (i === j) continue;
      const hit = segIntersect(p1, p2, segs[j][0], segs[j][1]);
      if (hit) cuts.push(hit);
    }
    cuts.sort((a, b) => a.t - b.t);
    let prevId = vertexId(cuts[0].p);
    for (let k = 1; k < cuts.length; k++) {
      const id = vertexId(cuts[k].p);
      if (id !== prevId) {
        addEdge(prevId, id);
        prevId = id;
      }
    }
  }

  if (edges.length < 3) return null;

  // Build adjacency with directed half-edges. Each undirected edge yields two
  // half-edges. We trace faces by, at each vertex, choosing the next half-edge
  // that is the most clockwise turn from the reverse of the incoming edge.
  const adj = verts.map(() => []);
  for (const [a, b] of edges) {
    adj[a].push(b);
    adj[b].push(a);
  }

  const angleOf = (from, to) => Math.atan2(verts[to].y - verts[from].y, verts[to].x - verts[from].x);

  // half-edge key: `${from}->${to}`
  const visited = new Set();
  const faces = [];

  for (const [a, b] of edges) {
    for (const [u0, v0] of [[a, b], [b, a]]) {
      if (visited.has(`${u0}->${v0}`)) continue;
      const face = [];
      let u = u0;
      let v = v0;
      let guard = 0;
      const maxSteps = edges.length * 4 + 10;
      while (guard++ < maxSteps) {
        visited.add(`${u}->${v}`);
        face.push(u);
        // At v, pick the next vertex: most clockwise turn relative to incoming.
        const incoming = angleOf(v, u); // direction pointing back to u
        const neighbors = adj[v];
        let best = null;
        let bestTurn = Infinity;
        for (const w of neighbors) {
          if (w === u && neighbors.length > 1) continue; // avoid immediate backtrack unless dead end
          const out = angleOf(v, w);
          // clockwise angle from incoming to out, in (0, 2pi]
          let turn = incoming - out;
          while (turn <= 0) turn += Math.PI * 2;
          while (turn > Math.PI * 2) turn -= Math.PI * 2;
          if (turn < bestTurn) {
            bestTurn = turn;
            best = w;
          }
        }
        if (best === null) {
          // dead end; allow backtrack
          best = u;
        }
        u = v;
        v = best;
        if (u === u0 && v === v0) break;
      }
      if (face.length >= 3) faces.push(face);
    }
  }

  // Convert vertex-index faces to polygons, drop degenerate / outer face.
  const polys = [];
  for (const face of faces) {
    const pts = face.map((id) => verts[id]);
    const area = signedArea(pts);
    if (Math.abs(area) < minArea) continue;
    // The outer boundary traces clockwise with our CW-turn rule and has the
    // largest area with negative orientation; keep only interior faces.
    if (area < 0) continue; // interior faces come out positively oriented
    polys.push(pts);
  }

  if (polys.length === 0) return null;

  // Build pathData for each polygon.
  const result = polys.map((pts) => {
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`;
    return d + ' Z';
  });

  return result;
}

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

// Segment-segment intersection (proper crossings only). Returns { t, p } where
// t is the parameter along segment (p1,p2), or null. Endpoint-only touches are
// reported too (so shared vertices register), but collinear overlaps are not.
function segIntersect(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-12) return null; // parallel / collinear
  const tx = p3.x - p1.x, ty = p3.y - p1.y;
  const t = (tx * d2y - ty * d2x) / denom;
  const s = (tx * d1y - ty * d1x) / denom;
  const e = 1e-9;
  if (t < -e || t > 1 + e || s < -e || s > 1 + e) return null;
  return { t, p: { x: p1.x + t * d1x, y: p1.y + t * d1y } };
}
