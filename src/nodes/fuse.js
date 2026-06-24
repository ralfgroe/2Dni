import paper from 'paper';
import { ensurePaper as __ensureMainPaper } from '../utils/geoPathUtils';
import { geoToPaperPath } from '../utils/geoPathUtils';


function ensurePaper() {
  __ensureMainPaper();
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Global vertex weld: collapse every vertex across all paths that lies within
// `threshold` of another into a shared, averaged location. Uses a spatial hash
// grid so it stays fast even with many copies, and union-find to merge points
// transitively. This is what actually fuses coincident points where separate
// copies / subpaths overlap (the consecutive-only pass missed those).
function weldVertices(paths, threshold) {
  if (threshold <= 0) return paths;

  // Flatten all vertices into one list, remembering where each came from.
  const verts = [];
  paths.forEach((path, pi) => {
    path.segments.forEach((seg, si) => {
      verts.push({ x: seg.point.x, y: seg.point.y, pi, si });
    });
  });
  const n = verts.length;
  if (n === 0) return paths;

  // Union-find.
  const parent = new Array(n);
  for (let i = 0; i < n; i++) parent[i] = i;
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };

  // Spatial hash: bucket by cell of size = threshold, only compare neighbors.
  const cell = Math.max(threshold, 1e-6);
  const buckets = new Map();
  const key = (cx, cy) => cx + ',' + cy;
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(verts[i].x / cell);
    const cy = Math.floor(verts[i].y / cell);
    const k = key(cx, cy);
    let arr = buckets.get(k);
    if (!arr) { arr = []; buckets.set(k, arr); }
    arr.push(i);
  }

  const thr2 = threshold * threshold;
  for (let i = 0; i < n; i++) {
    const cx = Math.floor(verts[i].x / cell);
    const cy = Math.floor(verts[i].y / cell);
    for (let ox = -1; ox <= 1; ox++) {
      for (let oy = -1; oy <= 1; oy++) {
        const arr = buckets.get(key(cx + ox, cy + oy));
        if (!arr) continue;
        for (const j of arr) {
          if (j <= i) continue;
          const dx = verts[i].x - verts[j].x;
          const dy = verts[i].y - verts[j].y;
          if (dx * dx + dy * dy <= thr2) union(i, j);
        }
      }
    }
  }

  // Compute cluster centroids.
  const sums = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    let s = sums.get(r);
    if (!s) { s = { x: 0, y: 0, c: 0 }; sums.set(r, s); }
    s.x += verts[i].x; s.y += verts[i].y; s.c += 1;
  }

  // Write the centroid back to every vertex's source segment.
  const out = paths.map((path) => ({
    closed: path.closed,
    segments: path.segments.map((seg) => ({
      point: { ...seg.point },
      handleIn: { ...seg.handleIn },
      handleOut: { ...seg.handleOut },
    })),
  }));
  for (let i = 0; i < n; i++) {
    const s = sums.get(find(i));
    const v = verts[i];
    out[v.pi].segments[v.si].point = { x: s.x / s.c, y: s.y / s.c };
  }

  // Remove consecutive duplicate vertices created by welding (within each path),
  // preserving the outer handles of the run.
  return out.map((path) => {
    const segs = path.segments;
    if (segs.length === 0) return path;
    const merged = [segs[0]];
    for (let i = 1; i < segs.length; i++) {
      const prev = merged[merged.length - 1];
      const cur = segs[i];
      if (Math.abs(prev.point.x - cur.point.x) < 1e-6 && Math.abs(prev.point.y - cur.point.y) < 1e-6) {
        prev.handleOut = { ...cur.handleOut };
      } else {
        merged.push(cur);
      }
    }
    // For closed paths, also drop a trailing duplicate of the first point.
    if (path.closed && merged.length >= 2) {
      const first = merged[0];
      const last = merged[merged.length - 1];
      if (Math.abs(first.point.x - last.point.x) < 1e-6 && Math.abs(first.point.y - last.point.y) < 1e-6) {
        first.handleIn = { ...last.handleIn };
        merged.pop();
      }
    }
    return { segments: merged, closed: path.closed };
  });
}

function extractOpenPaths(geo) {
  ensurePaper();

  if ((geo.type === 'group' || geo.type === 'boolean') && geo.children) {
    const paths = [];
    for (const child of geo.children) {
      paths.push(...extractOpenPaths(child));
    }
    return paths;
  }

  const paperPath = geoToPaperPath(geo);
  if (!paperPath) return [];

  const children = paperPath.children ? [...paperPath.children] : [paperPath];
  const result = [];

  for (const child of children) {
    if (!child.segments || child.segments.length < 2) continue;

    const segs = child.segments.map(s => ({
      point: { x: s.point.x, y: s.point.y },
      handleIn: { x: s.handleIn ? s.handleIn.x : 0, y: s.handleIn ? s.handleIn.y : 0 },
      handleOut: { x: s.handleOut ? s.handleOut.x : 0, y: s.handleOut ? s.handleOut.y : 0 },
    }));

    result.push({ segments: segs, closed: child.closed });
  }

  paperPath.remove();
  return result;
}

function fuseClosedPath(path, threshold) {
  const segs = path.segments;
  if (segs.length < 3) return path;

  const merged = [segs[0]];
  for (let i = 1; i < segs.length; i++) {
    const prev = merged[merged.length - 1];
    const cur = segs[i];
    if (dist(prev.point, cur.point) <= threshold) {
      const midX = (prev.point.x + cur.point.x) / 2;
      const midY = (prev.point.y + cur.point.y) / 2;
      merged[merged.length - 1] = {
        point: { x: midX, y: midY },
        handleIn: { ...prev.handleIn },
        handleOut: { ...cur.handleOut },
      };
    } else {
      merged.push({
        point: { ...cur.point },
        handleIn: { ...cur.handleIn },
        handleOut: { ...cur.handleOut },
      });
    }
  }

  if (merged.length >= 2) {
    const first = merged[0];
    const last = merged[merged.length - 1];
    if (dist(first.point, last.point) <= threshold) {
      const midX = (first.point.x + last.point.x) / 2;
      const midY = (first.point.y + last.point.y) / 2;
      merged[0] = {
        point: { x: midX, y: midY },
        handleIn: { ...last.handleIn },
        handleOut: { ...first.handleOut },
      };
      merged.pop();
    }
  }

  return { segments: merged, closed: true };
}

// If an open path's start and end coincide (within threshold), close it by
// dropping the duplicate endpoint. This is what lets a spirograph (an open
// polyline whose pen returns to the start) become a proper closed loop that
// the Radius node can fillet all the way around.
function selfClose(path, threshold) {
  if (path.closed) return path;
  const segs = path.segments;
  if (segs.length < 3) return path;
  const first = segs[0].point;
  const last = segs[segs.length - 1].point;
  if (dist(first, last) <= threshold) {
    const merged = segs.slice(0, -1).map(s => ({
      point: { ...s.point },
      handleIn: { ...s.handleIn },
      handleOut: { ...s.handleOut },
    }));
    // Average the coincident endpoints into the first segment.
    merged[0] = {
      point: { x: (first.x + last.x) / 2, y: (first.y + last.y) / 2 },
      handleIn: { ...segs[segs.length - 1].handleIn },
      handleOut: { ...segs[0].handleOut },
    };
    return { segments: merged, closed: true };
  }
  return path;
}

function fuseAndJoin(paths, threshold) {
  if (paths.length === 0) return [];
  if (threshold <= 0) return paths;

  const open = paths.filter(p => !p.closed);
  const closed = paths.filter(p => p.closed);

  const fusedClosed = closed.map(p => fuseClosedPath(p, threshold));

  if (open.length <= 1) {
    return [...fusedClosed, ...open.map(p => selfClose(p, threshold))];
  }

  const used = new Set();
  const chains = [];

  for (let startIdx = 0; startIdx < open.length; startIdx++) {
    if (used.has(startIdx)) continue;
    used.add(startIdx);

    let chain = open[startIdx].segments.map(s => ({
      point: { ...s.point },
      handleIn: { ...s.handleIn },
      handleOut: { ...s.handleOut },
    }));
    let changed = true;

    while (changed) {
      changed = false;
      const chainStart = chain[0].point;
      const chainEnd = chain[chain.length - 1].point;

      for (let i = 0; i < open.length; i++) {
        if (used.has(i)) continue;
        const otherSegs = open[i].segments.map(s => ({
          point: { ...s.point },
          handleIn: { ...s.handleIn },
          handleOut: { ...s.handleOut },
        }));
        const otherStart = otherSegs[0].point;
        const otherEnd = otherSegs[otherSegs.length - 1].point;

        if (dist(chainEnd, otherStart) <= threshold) {
          const midX = (chainEnd.x + otherStart.x) / 2;
          const midY = (chainEnd.y + otherStart.y) / 2;
          chain[chain.length - 1].point = { x: midX, y: midY };
          chain[chain.length - 1].handleOut = { x: 0, y: 0 };
          const remaining = otherSegs.slice(1);
          if (remaining.length > 0) {
            remaining[0].handleIn = { x: 0, y: 0 };
          }
          chain.push(...remaining);
          used.add(i);
          changed = true;
          continue;
        }

        if (dist(chainEnd, otherEnd) <= threshold) {
          const midX = (chainEnd.x + otherEnd.x) / 2;
          const midY = (chainEnd.y + otherEnd.y) / 2;
          chain[chain.length - 1].point = { x: midX, y: midY };
          chain[chain.length - 1].handleOut = { x: 0, y: 0 };
          const reversed = [...otherSegs].reverse().map(s => ({
            point: { ...s.point },
            handleIn: { x: s.handleOut.x, y: s.handleOut.y },
            handleOut: { x: s.handleIn.x, y: s.handleIn.y },
          }));
          const remaining = reversed.slice(1);
          if (remaining.length > 0) {
            remaining[0].handleIn = { x: 0, y: 0 };
          }
          chain.push(...remaining);
          used.add(i);
          changed = true;
          continue;
        }

        if (dist(chainStart, otherEnd) <= threshold) {
          const midX = (chainStart.x + otherEnd.x) / 2;
          const midY = (chainStart.y + otherEnd.y) / 2;
          chain[0].point = { x: midX, y: midY };
          chain[0].handleIn = { x: 0, y: 0 };
          const prepend = otherSegs.slice(0, -1);
          if (prepend.length > 0) {
            prepend[prepend.length - 1].handleOut = { x: 0, y: 0 };
          }
          chain = [...prepend, ...chain];
          used.add(i);
          changed = true;
          continue;
        }

        if (dist(chainStart, otherStart) <= threshold) {
          const midX = (chainStart.x + otherStart.x) / 2;
          const midY = (chainStart.y + otherStart.y) / 2;
          chain[0].point = { x: midX, y: midY };
          chain[0].handleIn = { x: 0, y: 0 };
          const reversed = [...otherSegs].reverse().map(s => ({
            point: { ...s.point },
            handleIn: { x: s.handleOut.x, y: s.handleOut.y },
            handleOut: { x: s.handleIn.x, y: s.handleIn.y },
          }));
          const prepend = reversed.slice(0, -1);
          if (prepend.length > 0) {
            prepend[prepend.length - 1].handleOut = { x: 0, y: 0 };
          }
          chain = [...prepend, ...chain];
          used.add(i);
          changed = true;
          continue;
        }
      }
    }

    const first = chain[0].point;
    const last = chain[chain.length - 1].point;
    const isClosed = chain.length >= 3 && dist(first, last) <= threshold;

    if (isClosed) {
      const midX = (first.x + last.x) / 2;
      const midY = (first.y + last.y) / 2;
      chain[0].point = { x: midX, y: midY };
      chain.pop();
    }

    chains.push({ segments: chain, closed: isClosed });
  }

  return [...fusedClosed, ...chains];
}

export function fuseRuntime(params, inputs) {
  const { distance = 5 } = params;
  const inputGeo = inputs.geometry_in;

  if (!inputGeo) return null;

  ensurePaper();

  const paths = extractOpenPaths(inputGeo);
  if (paths.length === 0) return inputGeo;

  // First weld coincident/near-coincident vertices everywhere (across all
  // copies and subpaths), then join open paths end-to-end.
  const welded = weldVertices(paths, distance);
  const fused = fuseAndJoin(welded, distance);

  const paperPaths = [];
  for (const chain of fused) {
    const p = new paper.Path();
    for (const seg of chain.segments) {
      p.add(new paper.Segment(
        new paper.Point(seg.point.x, seg.point.y),
        new paper.Point(seg.handleIn.x, seg.handleIn.y),
        new paper.Point(seg.handleOut.x, seg.handleOut.y),
      ));
    }
    if (chain.closed) p.closePath();
    paperPaths.push(p);
  }

  let compound;
  if (paperPaths.length === 1) {
    compound = paperPaths[0];
  } else {
    compound = new paper.CompoundPath({ children: paperPaths });
  }

  const pathData = compound.pathData;
  const bounds = compound.bounds;
  compound.remove();

  const stroke = inputGeo.stroke || inputGeo.children?.[0]?.stroke || '#000000';
  const strokeWidth = inputGeo.strokeWidth ?? inputGeo.children?.[0]?.strokeWidth ?? 1;

  return {
    type: 'booleanResult',
    pathData,
    fill: 'none',
    stroke,
    strokeWidth,
    opacity: inputGeo.opacity,
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
  };
}
