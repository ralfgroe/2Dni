import paper from 'paper';
import { geoToPaperPath } from '../utils/geoPathUtils';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

function clonePath(src) { return src.clone(); }
function mirrorX(src, cx) { const c = clonePath(src); c.scale(-1, 1, new paper.Point(cx, 0)); return c; }
function mirrorY(src, cy) { const c = clonePath(src); c.scale(1, -1, new paper.Point(0, cy)); return c; }
function rotateCopy(src, angle, pivot) { const c = clonePath(src); c.rotate(angle, pivot); return c; }
function glide(src, dx, dy) { const c = clonePath(src); c.scale(1, -1, c.bounds.center); c.translate(new paper.Point(dx, dy)); return c; }

function generateCell(src, group, cellSize) {
  const half = cellSize / 2;
  const center = new paper.Point(0, 0);
  const paths = [clonePath(src)];

  switch (group) {
    case 'p1':
      break;
    case 'p2':
      paths.push(rotateCopy(src, 180, center));
      break;
    case 'pm':
      paths.push(mirrorX(src, 0));
      break;
    case 'pg':
      paths.push(glide(src, half, 0));
      break;
    case 'pmm':
      paths.push(mirrorX(src, 0));
      paths.push(mirrorY(src, 0));
      paths.push(rotateCopy(src, 180, center));
      break;
    case 'p4':
      paths.push(rotateCopy(src, 90, center));
      paths.push(rotateCopy(src, 180, center));
      paths.push(rotateCopy(src, 270, center));
      break;
    case 'p4m':
      for (let a = 0; a < 360; a += 90) {
        if (a > 0) paths.push(rotateCopy(src, a, center));
        const m = mirrorX(src, 0);
        m.rotate(a, center);
        paths.push(m);
      }
      break;
    case 'p3':
      paths.push(rotateCopy(src, 120, center));
      paths.push(rotateCopy(src, 240, center));
      break;
    case 'p6':
      for (let a = 60; a < 360; a += 60)
        paths.push(rotateCopy(src, a, center));
      break;
    case 'p6m':
      for (let a = 0; a < 360; a += 60) {
        if (a > 0) paths.push(rotateCopy(src, a, center));
        const m = mirrorX(src, 0);
        m.rotate(a, center);
        paths.push(m);
      }
      break;
  }

  return paths;
}

export function symmetryRuntime(params, inputs) {
  ensurePaper();

  const geo = inputs?.geometry_in;
  if (!geo) return null;

  const group = params.group ?? 'p4m';
  const cellSize = params.cell_size ?? 100;
  const repeats = Math.max(1, Math.min(8, Math.round(params.repeats ?? 3)));

  const srcPath = geoToPaperPath(geo);
  if (!srcPath) return geo;

  const cellPaths = generateCell(srcPath, group, cellSize);
  srcPath.remove();

  const isHex = ['p3', 'p6', 'p6m'].includes(group);
  const allPaths = [];

  for (let row = -repeats; row <= repeats; row++) {
    for (let col = -repeats; col <= repeats; col++) {
      let dx, dy;
      if (isHex) {
        dx = col * cellSize + (Math.abs(row) % 2 !== 0 ? cellSize / 2 : 0);
        dy = row * cellSize * Math.sqrt(3) / 2;
      } else {
        dx = col * cellSize;
        dy = row * cellSize;
      }
      for (const p of cellPaths) {
        const copy = p.clone();
        copy.translate(new paper.Point(dx, dy));
        allPaths.push(copy);
      }
    }
  }

  cellPaths.forEach(p => p.remove());

  if (allPaths.length === 0) return null;

  const compound = new paper.CompoundPath({ children: allPaths });
  const pathData = compound.pathData;
  const bounds = compound.bounds;
  compound.remove();

  return {
    type: 'booleanResult',
    pathData,
    fill: geo.fill || 'none',
    stroke: geo.stroke || '#000000',
    strokeWidth: geo.strokeWidth ?? 1,
    opacity: geo.opacity,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}
