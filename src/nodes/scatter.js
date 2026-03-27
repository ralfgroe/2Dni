import paper from 'paper';
import { geoToPaperPath } from '../utils/geoPathUtils';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

function seededRandom(seed) {
  let s = seed | 0 || 1;
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

export function scatterRuntime(params, inputs) {
  ensurePaper();

  const geo = inputs?.geometry_in;
  if (!geo) return null;

  const pattern = params.pattern || 'Random';
  const count = Math.max(1, Math.min(500, params.count || 25));
  const w = params.width || 400;
  const h = params.height || 400;
  const seed = params.seed || 42;
  const randomScale = params.random_scale || 0;
  const randomRotate = params.random_rotate || 0;

  const rand = seededRandom(seed);
  const halfW = w / 2, halfH = h / 2;
  let positions = [];

  switch (pattern) {
    case 'Grid': {
      const cols = Math.ceil(Math.sqrt(count * w / h));
      const rows = Math.ceil(count / cols);
      const dx = w / cols, dy = h / rows;
      for (let r = 0; r < rows; r++)
        for (let c = 0; c < cols; c++)
          positions.push({ x: -halfW + dx * (c + 0.5), y: -halfH + dy * (r + 0.5) });
      break;
    }
    case 'Radial': {
      const rings = Math.ceil(Math.sqrt(count));
      let placed = 0;
      for (let ring = 0; ring < rings && placed < count; ring++) {
        const r = (ring + 1) / rings * Math.min(halfW, halfH);
        const circumference = 2 * Math.PI * r;
        const n = Math.max(1, Math.round(circumference / (Math.min(halfW, halfH) / rings)));
        for (let i = 0; i < n && placed < count; i++) {
          const a = (2 * Math.PI * i) / n;
          positions.push({ x: r * Math.cos(a), y: r * Math.sin(a) });
          placed++;
        }
      }
      break;
    }
    case 'Poisson Disk': {
      const radius = Math.sqrt(w * h / count) * 0.7;
      positions = poissonDisk(w, h, radius, rand);
      break;
    }
    default:
      for (let i = 0; i < count; i++)
        positions.push({ x: (rand() - 0.5) * w, y: (rand() - 0.5) * h });
  }

  const srcPath = geoToPaperPath(geo);
  if (!srcPath) return geo;

  const copies = [];
  for (const pos of positions) {
    const copy = srcPath.clone();
    copy.translate(new paper.Point(pos.x, pos.y));
    if (randomRotate > 0) copy.rotate((rand() - 0.5) * randomRotate * 2);
    if (randomScale > 0) {
      const s = 1 + (rand() - 0.5) * randomScale * 2;
      copy.scale(Math.max(0.1, s));
    }
    copies.push(copy);
  }
  srcPath.remove();

  if (copies.length === 0) return null;

  const compound = new paper.CompoundPath({ children: copies });
  const pathData = compound.pathData;
  const bounds = compound.bounds;
  compound.remove();

  return {
    type: 'booleanResult',
    pathData,
    fill: geo.fill || 'none',
    stroke: geo.stroke || '#000000',
    strokeWidth: geo.strokeWidth ?? 1,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}
