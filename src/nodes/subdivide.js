import paper from 'paper';
import { geoToPaperPath } from '../utils/geoPathUtils';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

function chaikinSmooth(points, closed, tension) {
  const t = tension;
  const result = [];
  const n = points.length;
  const limit = closed ? n : n - 1;

  for (let i = 0; i < limit; i++) {
    const p0 = points[i];
    const p1 = points[(i + 1) % n];
    result.push({ x: (1 - t) * p0.x + t * p1.x, y: (1 - t) * p0.y + t * p1.y });
    result.push({ x: t * p0.x + (1 - t) * p1.x, y: t * p0.y + (1 - t) * p1.y });
  }

  if (!closed && points.length > 0) {
    result.unshift(points[0]);
    result.push(points[n - 1]);
  }

  return result;
}

function extractPoints(paperPath) {
  return paperPath.segments.map(s => ({ x: s.point.x, y: s.point.y }));
}

export function subdivideRuntime(params, inputs) {
  ensurePaper();

  const geo = inputs?.geometry_in;
  if (!geo) return null;

  const iterations = Math.max(1, Math.min(6, Math.round(params.iterations ?? 3)));
  const tension = Math.max(0.05, Math.min(0.45, params.tension ?? 0.25));

  const paperPath = geoToPaperPath(geo);
  if (!paperPath) return geo;

  let points = extractPoints(paperPath);
  const closed = paperPath.closed;
  paperPath.remove();

  for (let i = 0; i < iterations; i++) {
    points = chaikinSmooth(points, closed, tension);
  }

  const result = new paper.Path();
  points.forEach(p => result.add(new paper.Point(p.x, p.y)));
  if (closed) result.closePath();

  const pathData = result.pathData;
  const bounds = result.bounds;
  result.remove();

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
