import paper from 'paper';
import { flattenGeoToPathData } from '../utils/geoPathUtils';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

function seededRandom(seed) {
  let s = seed;
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
}

function delaunay(points) {
  const n = points.length;
  if (n < 3) return [];

  const sorted = points.map((p, i) => ({ ...p, idx: i })).sort((a, b) => a.x - b.x || a.y - b.y);
  const triangles = [];

  const superA = { x: -1e6, y: -1e6, idx: n };
  const superB = { x: 1e6, y: -1e6, idx: n + 1 };
  const superC = { x: 0, y: 1e6, idx: n + 2 };
  triangles.push([superA, superB, superC]);

  for (const p of sorted) {
    const bad = [];
    for (let i = triangles.length - 1; i >= 0; i--) {
      const [a, b, c] = triangles[i];
      if (inCircumcircle(p, a, b, c)) bad.push(i);
    }

    const edges = [];
    for (const i of bad) {
      const [a, b, c] = triangles[i];
      edges.push([a, b], [b, c], [c, a]);
    }

    bad.sort((a, b) => b - a);
    for (const i of bad) triangles.splice(i, 1);

    const unique = [];
    for (const e of edges) {
      const dup = edges.filter(e2 =>
        (e2[0].idx === e[0].idx && e2[1].idx === e[1].idx) ||
        (e2[0].idx === e[1].idx && e2[1].idx === e[0].idx)
      );
      if (dup.length === 1) unique.push(e);
    }

    for (const [a, b] of unique) triangles.push([a, b, p]);
  }

  return triangles.filter(t =>
    t.every(p => p.idx < n)
  ).map(t => t.map(p => ({ x: p.x, y: p.y })));
}

function inCircumcircle(p, a, b, c) {
  const ax = a.x - p.x, ay = a.y - p.y;
  const bx = b.x - p.x, by = b.y - p.y;
  const cx2 = c.x - p.x, cy2 = c.y - p.y;
  const det = (ax * ax + ay * ay) * (bx * cy2 - cx2 * by) -
              (bx * bx + by * by) * (ax * cy2 - cx2 * ay) +
              (cx2 * cx2 + cy2 * cy2) * (ax * by - bx * ay);
  return det > 0;
}

function voronoiFromDelaunay(triangles, points, w, h) {
  const halfW = w / 2, halfH = h / 2;
  const edgeMap = new Map();

  for (const tri of triangles) {
    const cc = circumcenter(tri[0], tri[1], tri[2]);
    if (!cc) continue;
    for (let i = 0; i < 3; i++) {
      const a = tri[i], b = tri[(i + 1) % 3];
      const key = a.x < b.x || (a.x === b.x && a.y < b.y)
        ? `${a.x},${a.y}-${b.x},${b.y}` : `${b.x},${b.y}-${a.x},${a.y}`;
      if (!edgeMap.has(key)) edgeMap.set(key, []);
      edgeMap.get(key).push(cc);
    }
  }

  const segments = [];
  for (const [, centers] of edgeMap) {
    if (centers.length === 2) {
      const [a, b] = centers;
      if (Math.abs(a.x) < halfW * 2 && Math.abs(a.y) < halfH * 2 &&
          Math.abs(b.x) < halfW * 2 && Math.abs(b.y) < halfH * 2) {
        segments.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
      }
    }
  }
  return segments;
}

function circumcenter(a, b, c) {
  const D = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(D) < 1e-10) return null;
  const ux = ((a.x * a.x + a.y * a.y) * (b.y - c.y) + (b.x * b.x + b.y * b.y) * (c.y - a.y) + (c.x * c.x + c.y * c.y) * (a.y - b.y)) / D;
  const uy = ((a.x * a.x + a.y * a.y) * (c.x - b.x) + (b.x * b.x + b.y * b.y) * (a.x - c.x) + (c.x * c.x + c.y * c.y) * (b.x - a.x)) / D;
  return { x: ux, y: uy };
}

function generatePoints(source, count, w, h, seed, jitter) {
  const rand = seededRandom(seed);
  const halfW = w / 2, halfH = h / 2;
  const pts = [];

  if (source === 'Grid') {
    const cols = Math.ceil(Math.sqrt(count * w / h));
    const rows = Math.ceil(count / cols);
    const dx = w / cols, dy = h / rows;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        pts.push({
          x: -halfW + dx * (c + 0.5) + (rand() - 0.5) * jitter,
          y: -halfH + dy * (r + 0.5) + (rand() - 0.5) * jitter,
        });
      }
    }
  } else {
    for (let i = 0; i < count; i++) {
      pts.push({ x: (rand() - 0.5) * w, y: (rand() - 0.5) * h });
    }
  }
  return pts;
}

function lloydRelax(points, w, h, steps) {
  let pts = points;
  for (let s = 0; s < steps; s++) {
    const tris = delaunay(pts);
    const segs = voronoiFromDelaunay(tris, pts, w, h);
    const cellPts = new Map();
    pts.forEach((p, i) => cellPts.set(i, []));
    for (const seg of segs) {
      for (let i = 0; i < pts.length; i++) {
        const dx = pts[i].x - (seg.x1 + seg.x2) / 2;
        const dy = pts[i].y - (seg.y1 + seg.y2) / 2;
        if (dx * dx + dy * dy < w * w) {
          cellPts.get(i).push({ x: seg.x1, y: seg.y1 }, { x: seg.x2, y: seg.y2 });
        }
      }
    }
    pts = pts.map((p, i) => {
      const cp = cellPts.get(i);
      if (!cp || cp.length < 2) return p;
      const cx = cp.reduce((s, pt) => s + pt.x, 0) / cp.length;
      const cy = cp.reduce((s, pt) => s + pt.y, 0) / cp.length;
      return { x: cx, y: cy };
    });
  }
  return pts;
}

export function voronoiRuntime(params, inputs) {
  ensurePaper();

  const mode = params.mode || 'Voronoi';
  const source = params.source || 'Random';
  const count = Math.max(3, Math.min(200, params.count || 30));
  const seed = params.seed || 42;
  const w = params.width || 400;
  const h = params.height || 400;
  const jitter = params.jitter || 0;
  const relax = Math.max(0, Math.min(5, Math.round(params.relax || 0)));
  const strokeColor = params.stroke_color || '#000000';
  const strokeWidth = params.stroke_width ?? 1;

  let points;
  if (source === 'Input Points' && inputs?.geometry_in) {
    points = extractPointsFromGeo(inputs.geometry_in);
    if (points.length < 3) points = generatePoints('Random', count, w, h, seed, jitter);
  } else {
    points = generatePoints(source, count, w, h, seed, jitter);
  }

  if (relax > 0) points = lloydRelax(points, w, h, relax);

  const tris = delaunay(points);

  const paths = [];
  if (mode === 'Delaunay') {
    for (const tri of tris) {
      const p = new paper.Path();
      p.add(new paper.Point(tri[0].x, tri[0].y));
      p.add(new paper.Point(tri[1].x, tri[1].y));
      p.add(new paper.Point(tri[2].x, tri[2].y));
      p.closePath();
      paths.push(p);
    }
  } else {
    const segs = voronoiFromDelaunay(tris, points, w, h);
    for (const seg of segs) {
      const p = new paper.Path();
      p.add(new paper.Point(seg.x1, seg.y1));
      p.add(new paper.Point(seg.x2, seg.y2));
      paths.push(p);
    }
  }

  if (paths.length === 0) return null;

  const compound = new paper.CompoundPath({ children: paths });
  const pathData = compound.pathData;
  const bounds = compound.bounds;
  compound.remove();

  return {
    type: 'booleanResult',
    pathData,
    fill: 'none',
    stroke: strokeColor,
    strokeWidth,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}

function extractPointsFromGeo(geo) {
  if (!geo) return [];
  if (geo.type === 'group' && geo.children) {
    return geo.children.flatMap(extractPointsFromGeo);
  }
  const b = geo.bounds;
  if (b) return [{ x: b.x + b.width / 2, y: b.y + b.height / 2 }];
  return [];
}
