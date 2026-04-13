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

function generatePositions(pattern, count, w, h, rand) {
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
      const radius = Math.sqrt(w * h / count) * 0.7;
      return poissonDisk(w, h, radius, rand);
    }

    default: {
      const pts = [];
      for (let i = 0; i < count; i++)
        pts.push({ x: (rand() - 0.5) * w, y: (rand() - 0.5) * h });
      return pts;
    }
  }
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

  const pattern = params.pattern ?? 'Random';
  const count = Math.max(1, Math.min(500, params.count ?? 25));
  const w = params.width ?? 400;
  const h = params.height ?? 400;
  const centerX = params.center_x ?? 0;
  const centerY = params.center_y ?? 0;
  const seed = params.seed ?? 42;
  const randomScale = params.random_scale ?? 0;
  const randomRotate = params.random_rotate ?? 0;
  const scaleByDist = params.scale_by_distance ?? 0;

  const rand = seededRandom(seed);
  const positions = generatePositions(pattern, count, w, h, rand);

  const maxDist = Math.sqrt(w * w + h * h) / 2;
  const children = [];

  for (const pos of positions) {
    const px = pos.x + centerX;
    const py = pos.y + centerY;

    const copy = applyTransformToGeo(deepCloneGeo(geo), (path) => {
      path.translate(new paper.Point(px, py));

      if (randomRotate > 0) {
        path.rotate((rand() - 0.5) * randomRotate * 2, new paper.Point(px, py));
      }

      let s = 1;
      if (randomScale > 0) s *= Math.max(0.1, 1 + (rand() - 0.5) * randomScale * 2);
      if (scaleByDist !== 0) {
        const dist = Math.sqrt(pos.x * pos.x + pos.y * pos.y);
        const t = maxDist > 0 ? dist / maxDist : 0;
        s *= Math.max(0.05, 1 - scaleByDist * t);
      }
      if (s !== 1) path.scale(s, new paper.Point(px, py));
    });

    if (copy) children.push(copy);
  }

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
