import paper from 'paper';
import { geoToPaperPath } from '../utils/geoPathUtils';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

function seededRandom(seed) {
  let s = ((seed | 0) + 1) || 1;
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
}

function poissonDisk(w, h, radius, rand) {
  const cellSize = radius / Math.sqrt(2);
  const cols = Math.ceil(w / cellSize), rows = Math.ceil(h / cellSize);
  const grid = new Array(cols * rows).fill(-1);
  const points = [];
  const active = [];
  const halfW = w / 2, halfH = h / 2;

  function gridIdx(x, y) {
    return Math.floor((x + halfW) / cellSize) + Math.floor((y + halfH) / cellSize) * cols;
  }

  const first = { x: (rand() - 0.5) * w, y: (rand() - 0.5) * h };
  points.push(first);
  active.push(0);
  grid[gridIdx(first.x, first.y)] = 0;

  while (active.length > 0 && points.length < 2000) {
    const idx = Math.floor(rand() * active.length);
    const pt = points[active[idx]];
    let found = false;

    for (let attempt = 0; attempt < 30; attempt++) {
      const angle = rand() * 2 * Math.PI;
      const dist = radius + rand() * radius;
      const nx = pt.x + dist * Math.cos(angle);
      const ny = pt.y + dist * Math.sin(angle);
      if (nx < -halfW || nx > halfW || ny < -halfH || ny > halfH) continue;

      const gc = Math.floor((nx + halfW) / cellSize);
      const gr = Math.floor((ny + halfH) / cellSize);
      let ok = true;
      for (let dr = -2; dr <= 2 && ok; dr++) {
        for (let dc = -2; dc <= 2 && ok; dc++) {
          const c2 = gc + dc, r2 = gr + dr;
          if (c2 < 0 || c2 >= cols || r2 < 0 || r2 >= rows) continue;
          const pi = grid[c2 + r2 * cols];
          if (pi >= 0) {
            const dx = points[pi].x - nx, dy = points[pi].y - ny;
            if (dx * dx + dy * dy < radius * radius) ok = false;
          }
        }
      }
      if (ok) {
        points.push({ x: nx, y: ny });
        active.push(points.length - 1);
        grid[gridIdx(nx, ny)] = points.length - 1;
        found = true;
        break;
      }
    }
    if (!found) active.splice(idx, 1);
  }
  return points;
}

function voronoiRelax(count, w, h, rand, iterations = 8) {
  const halfW = w / 2, halfH = h / 2;
  let pts = [];
  for (let i = 0; i < count; i++) {
    pts.push({ x: (rand() - 0.5) * w, y: (rand() - 0.5) * h });
  }

  const sampleRes = Math.min(200, Math.max(60, Math.ceil(Math.sqrt(count) * 4)));
  const stepX = w / sampleRes;
  const stepY = h / sampleRes;

  for (let iter = 0; iter < iterations; iter++) {
    const sumX = new Float64Array(count);
    const sumY = new Float64Array(count);
    const cellCount = new Uint32Array(count);

    for (let sy = 0; sy < sampleRes; sy++) {
      const py = -halfH + (sy + 0.5) * stepY;
      for (let sx = 0; sx < sampleRes; sx++) {
        const px = -halfW + (sx + 0.5) * stepX;

        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < count; i++) {
          const dx = pts[i].x - px;
          const dy = pts[i].y - py;
          const d = dx * dx + dy * dy;
          if (d < bestDist) { bestDist = d; bestIdx = i; }
        }

        sumX[bestIdx] += px;
        sumY[bestIdx] += py;
        cellCount[bestIdx]++;
      }
    }

    for (let i = 0; i < count; i++) {
      if (cellCount[i] > 0) {
        pts[i] = {
          x: Math.max(-halfW, Math.min(halfW, sumX[i] / cellCount[i])),
          y: Math.max(-halfH, Math.min(halfH, sumY[i] / cellCount[i])),
        };
      }
    }
  }

  return pts;
}

function getGeoBoundsSize(geo) {
  if (!geo) return { w: 0, h: 0 };
  if (geo.bounds && geo.bounds.width > 0 && geo.bounds.height > 0) {
    return { w: geo.bounds.width, h: geo.bounds.height };
  }
  ensurePaper();
  const path = geoToPaperPath(geo);
  if (!path) return { w: 0, h: 0 };
  const b = path.bounds;
  path.remove();
  return { w: b.width, h: b.height };
}

function generatePositions(pattern, count, w, h, rand, geoSize, spacing) {
  const halfW = w / 2, halfH = h / 2;

  switch (pattern) {
    case 'Grid': {
      const cols = Math.ceil(Math.sqrt(count * w / h));
      const rows = Math.ceil(count / cols);
      const dx = w / cols, dy = h / rows;
      const pts = [];
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          pts.push({ x: -halfW + dx * (c + 0.5), y: -halfH + dy * (r + 0.5) });
      return pts;
    }

    case 'Hex': {
      const cols = Math.ceil(Math.sqrt(count * w / h));
      const rows = Math.ceil(count / cols);
      const dx = w / cols;
      const dy = h / rows;
      const pts = [];
      for (let r = 0; r < rows; r++) {
        const offsetX = (r % 2) * dx * 0.5;
        for (let c = 0; c < cols; c++) {
          pts.push({ x: -halfW + dx * (c + 0.5) + offsetX, y: -halfH + dy * (r + 0.5) });
        }
      }
      return pts;
    }

    case 'Radial': {
      const rings = Math.ceil(Math.sqrt(count));
      const pts = [];
      let placed = 0;
      for (let ring = 0; ring < rings && placed < count; ring++) {
        const r = (ring + 1) / rings * Math.min(halfW, halfH);
        const circumference = 2 * Math.PI * r;
        const n = Math.max(1, Math.round(circumference / (Math.min(halfW, halfH) / rings)));
        for (let i = 0; i < n && placed < count; i++) {
          const a = (2 * Math.PI * i) / n;
          pts.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
          placed++;
        }
      }
      return pts;
    }

    case 'Sunflower': {
      const golden = Math.PI * (3 - Math.sqrt(5));
      const maxR = Math.min(halfW, halfH);
      const pts = [];
      for (let i = 0; i < count; i++) {
        const r = maxR * Math.sqrt((i + 0.5) / count);
        const theta = i * golden;
        pts.push({ x: r * Math.cos(theta), y: r * Math.sin(theta) });
      }
      return pts;
    }

    case 'Poisson Disk': {
      const geoDiag = geoSize ? Math.max(geoSize.w, geoSize.h) : 0;
      const minRadius = geoDiag > 0
        ? (geoDiag + spacing)
        : Math.sqrt(w * h / count) * 0.7;
      const radius = Math.max(minRadius, 2);
      return poissonDisk(w, h, radius, rand);
    }

    case 'Voronoi': {
      return voronoiRelax(count, w, h, rand);
    }

    default: {
      const pts = [];
      for (let i = 0; i < count; i++)
        pts.push({ x: (rand() - 0.5) * w, y: (rand() - 0.5) * h });
      return pts;
    }
  }
}

function buildFieldPath(fieldGeo) {
  ensurePaper();
  const path = geoToPaperPath(fieldGeo);
  if (!path) return null;
  if (!path.closed) path.closePath();
  return path;
}

function generateFieldPositions(pattern, count, fieldPath, rand, geoSize, spacing) {
  const fb = fieldPath.bounds;
  const w = fb.width;
  const h = fb.height;
  const cx = fb.center.x;
  const cy = fb.center.y;

  const raw = generatePositions(pattern, count, w, h, rand, geoSize, spacing);

  const shifted = raw.map(p => ({ x: p.x + cx, y: p.y + cy }));

  return shifted.filter(p => fieldPath.contains(new paper.Point(p.x, p.y)));
}

function generateFieldRandom(count, fieldPath, rand, maxAttempts) {
  const fb = fieldPath.bounds;
  const pts = [];
  let attempts = 0;
  while (pts.length < count && attempts < maxAttempts) {
    const x = fb.x + rand() * fb.width;
    const y = fb.y + rand() * fb.height;
    attempts++;
    if (fieldPath.contains(new paper.Point(x, y))) {
      pts.push({ x, y });
    }
  }
  return pts;
}

function deepCloneGeo(geo) {
  if (!geo) return null;
  if ((geo.type === 'group' || geo.type === 'boolean') && geo.children) {
    return { ...geo, children: geo.children.map(deepCloneGeo), bounds: geo.bounds ? { ...geo.bounds } : undefined };
  }
  return { ...geo, bounds: geo.bounds ? { ...geo.bounds } : undefined };
}

function transformLeafGeo(geo, fn) {
  ensurePaper();
  const path = geoToPaperPath(geo);
  if (!path) return geo;
  fn(path);
  const pathData = path.pathData;
  const b = path.bounds;
  path.remove();
  return {
    type: 'booleanResult',
    pathData,
    fill: geo.fill || 'none',
    stroke: geo.stroke || '#000000',
    strokeWidth: geo.strokeWidth ?? 1,
    opacity: geo.opacity,
    bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
  };
}

function applyTransformToGeo(geo, fn) {
  if (!geo) return null;
  if ((geo.type === 'group' || geo.type === 'boolean') && geo.children) {
    const transformed = geo.children.map((child) => applyTransformToGeo(child, fn));
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const child of transformed) {
      if (child && child.bounds) {
        minX = Math.min(minX, child.bounds.x);
        minY = Math.min(minY, child.bounds.y);
        maxX = Math.max(maxX, child.bounds.x + child.bounds.width);
        maxY = Math.max(maxY, child.bounds.y + child.bounds.height);
      }
    }
    return {
      ...geo,
      children: transformed,
      bounds: {
        x: isFinite(minX) ? minX : 0, y: isFinite(minY) ? minY : 0,
        width: isFinite(maxX - minX) ? maxX - minX : 0, height: isFinite(maxY - minY) ? maxY - minY : 0,
      },
    };
  }
  return transformLeafGeo(geo, fn);
}

export function scatterRuntime(params, inputs) {
  ensurePaper();

  const geo = inputs?.geometry_in;
  if (!geo) return null;

  const fieldGeo = inputs?.scatter_field || null;

  const pattern = params.pattern ?? 'Random';
  const count = Math.max(1, Math.min(1000, params.count ?? 25));
  const w = params.width ?? 400;
  const h = params.height ?? 400;
  const centerX = params.center_x ?? 0;
  const centerY = params.center_y ?? 0;
  const seed = params.seed ?? 42;
  const randomScale = params.random_scale ?? 0;
  const randomRotate = params.random_rotate ?? 0;
  const scaleByDist = params.scale_by_distance ?? 0;
  const spacing = params.spacing ?? 0;

  const geoSize = getGeoBoundsSize(geo);
  const rand = seededRandom(seed);

  let fieldPath = null;
  let positions;

  if (fieldGeo) {
    fieldPath = buildFieldPath(fieldGeo);
  }

  if (fieldPath) {
    if (pattern === 'Random') {
      positions = generateFieldRandom(count, fieldPath, rand, count * 20);
    } else {
      positions = generateFieldPositions(pattern, count, fieldPath, rand, geoSize, spacing);
    }
  } else {
    positions = generatePositions(pattern, count, w, h, rand, geoSize, spacing);
  }

  const scatterW = fieldPath ? fieldPath.bounds.width : w;
  const scatterH = fieldPath ? fieldPath.bounds.height : h;
  const maxDist = Math.sqrt(scatterW * scatterW + scatterH * scatterH) / 2;

  const fieldCx = fieldPath ? fieldPath.bounds.center.x : 0;
  const fieldCy = fieldPath ? fieldPath.bounds.center.y : 0;

  const children = [];

  for (const pos of positions) {
    const px = fieldPath ? pos.x + centerX : pos.x + centerX;
    const py = fieldPath ? pos.y + centerY : pos.y + centerY;

    const copy = applyTransformToGeo(deepCloneGeo(geo), (path) => {
      path.translate(new paper.Point(px, py));

      if (randomRotate > 0) {
        path.rotate((rand() - 0.5) * randomRotate * 2, new paper.Point(px, py));
      }

      let s = 1;
      if (randomScale > 0) s *= Math.max(0.1, 1 + (rand() - 0.5) * randomScale * 2);
      if (scaleByDist !== 0) {
        const dx = (fieldPath ? pos.x - fieldCx : pos.x);
        const dy = (fieldPath ? pos.y - fieldCy : pos.y);
        const dist = Math.sqrt(dx * dx + dy * dy);
        const t = maxDist > 0 ? dist / maxDist : 0;
        s *= Math.max(0.05, 1 - scaleByDist * t);
      }
      if (s !== 1) path.scale(s, new paper.Point(px, py));
    });

    if (copy) children.push(copy);
  }

  if (fieldPath) fieldPath.remove();

  if (children.length === 0) return null;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const child of children) {
    if (child && child.bounds) {
      minX = Math.min(minX, child.bounds.x);
      minY = Math.min(minY, child.bounds.y);
      maxX = Math.max(maxX, child.bounds.x + child.bounds.width);
      maxY = Math.max(maxY, child.bounds.y + child.bounds.height);
    }
  }

  return {
    type: 'group',
    children,
    transform: {},
    bounds: {
      x: isFinite(minX) ? minX : 0, y: isFinite(minY) ? minY : 0,
      width: isFinite(maxX - minX) ? maxX - minX : 0, height: isFinite(maxY - minY) ? maxY - minY : 0,
    },
  };
}
