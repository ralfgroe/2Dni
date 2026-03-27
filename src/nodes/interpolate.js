import paper from 'paper';
import { geoToPaperPath } from '../utils/geoPathUtils';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

function resamplePath(paperPath, count) {
  const len = paperPath.length;
  const points = [];
  for (let i = 0; i <= count; i++) {
    const pt = paperPath.getPointAt((i / count) * len);
    if (pt) points.push({ x: pt.x, y: pt.y });
  }
  return points;
}

function lerpPt(a, b, t) {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function interpolateRuntime(params, inputs) {
  ensurePaper();

  const geoA = inputs?.geometry_a;
  const geoB = inputs?.geometry_b;
  if (!geoA || !geoB) return geoA || geoB || null;

  const blend = Math.max(0, Math.min(1, params.blend ?? 0.5));
  const steps = Math.max(1, Math.min(20, Math.round(params.steps || 1)));

  const pathA = geoToPaperPath(geoA);
  const pathB = geoToPaperPath(geoB);
  if (!pathA || !pathB) return geoA;

  const sampleCount = Math.max(pathA.segments.length, pathB.segments.length, 50);
  const ptsA = resamplePath(pathA, sampleCount);
  const ptsB = resamplePath(pathB, sampleCount);
  const closedA = pathA.closed;
  pathA.remove();
  pathB.remove();

  const minLen = Math.min(ptsA.length, ptsB.length);
  const allPaths = [];

  for (let s = 0; s < steps; s++) {
    const t = steps === 1 ? blend : s / (steps - 1);
    const path = new paper.Path();
    for (let i = 0; i < minLen; i++) {
      const pt = lerpPt(ptsA[i], ptsB[i], t);
      path.add(new paper.Point(pt.x, pt.y));
    }
    if (closedA) path.closePath();
    allPaths.push(path);
  }

  const compound = new paper.CompoundPath({ children: allPaths });
  const pathData = compound.pathData;
  const bounds = compound.bounds;
  compound.remove();

  return {
    type: 'booleanResult',
    pathData,
    fill: blend < 0.5 ? (geoA.fill || 'none') : (geoB.fill || 'none'),
    stroke: geoA.stroke || '#000000',
    strokeWidth: geoA.strokeWidth ?? 1,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}
