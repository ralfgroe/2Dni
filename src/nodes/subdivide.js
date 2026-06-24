import paper from 'paper';
import { ensurePaper as __ensureMainPaper } from '../utils/geoPathUtils';
import { geoToPaperPath } from '../utils/geoPathUtils';

function ensurePaper() {
  __ensureMainPaper();
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

// Chaikin-smooths a single (non-compound) paper.Path in place-equivalent
// fashion, returning a fresh smoothed paper.Path. The caller owns removal.
function smoothPaperPath(srcPath, iterations, tension) {
  let points = extractPoints(srcPath);
  const closed = srcPath.closed;
  if (points.length < 2) {
    // Nothing meaningful to smooth; hand back a clone so caller logic is uniform.
    return srcPath.clone({ insert: true });
  }
  for (let i = 0; i < iterations; i++) {
    points = chaikinSmooth(points, closed, tension);
  }
  const result = new paper.Path();
  points.forEach(p => result.add(new paper.Point(p.x, p.y)));
  if (closed) result.closePath();
  return result;
}

// Recursively smooths a geometry node so that multi-part inputs (groups from
// Trace/Select, or compound paths with many subpaths) keep all their pieces
// instead of collapsing into a single united blob (which previously produced
// an empty path because CompoundPath.segments is empty).
function smoothGeo(geo, iterations, tension) {
  if (!geo) return null;

  // A group keeps its structure: smooth each child independently.
  if ((geo.type === 'group' || geo.type === 'boolean') && Array.isArray(geo.children)) {
    const children = geo.children
      .map((child) => smoothGeo(child, iterations, tension))
      .filter(Boolean);
    if (children.length === 0) return null;
    const bs = children.map((c) => c.bounds).filter(Boolean);
    const minX = bs.length ? Math.min(...bs.map((b) => b.x)) : 0;
    const minY = bs.length ? Math.min(...bs.map((b) => b.y)) : 0;
    const maxX = bs.length ? Math.max(...bs.map((b) => b.x + b.width)) : 0;
    const maxY = bs.length ? Math.max(...bs.map((b) => b.y + b.height)) : 0;
    return {
      type: 'group',
      children,
      bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    };
  }

  const paperPath = geoToPaperPath(geo);
  if (!paperPath) return geo;

  // CompoundPath (e.g. a traced color region with holes / multiple subpaths):
  // smooth every subpath and recombine into a new compound so the shape and
  // its holes survive.
  if (paperPath instanceof paper.CompoundPath) {
    const smoothedChildren = paperPath.children.map((child) =>
      smoothPaperPath(child, iterations, tension)
    );
    const compound = new paper.CompoundPath({ children: smoothedChildren });
    const pathData = compound.pathData;
    const bounds = compound.bounds;
    compound.remove();
    paperPath.remove();
    return {
      type: 'booleanResult',
      pathData,
      fill: geo.fill || 'none',
      stroke: geo.stroke || '#000000',
      strokeWidth: geo.strokeWidth ?? 1,
      strokeLinecap: geo.strokeLinecap,
      strokeDasharray: geo.strokeDasharray,
      opacity: geo.opacity,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    };
  }

  const smoothed = smoothPaperPath(paperPath, iterations, tension);
  const pathData = smoothed.pathData;
  const bounds = smoothed.bounds;
  smoothed.remove();
  paperPath.remove();

  return {
    type: 'booleanResult',
    pathData,
    fill: geo.fill || 'none',
    stroke: geo.stroke || '#000000',
    strokeWidth: geo.strokeWidth ?? 1,
    strokeLinecap: geo.strokeLinecap,
    strokeDasharray: geo.strokeDasharray,
    opacity: geo.opacity,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}

export function subdivideRuntime(params, inputs) {
  ensurePaper();

  const geo = inputs?.geometry_in;
  if (!geo) return null;

  const iterations = Math.max(1, Math.min(6, Math.round(params.iterations ?? 3)));
  const tension = Math.max(0.05, Math.min(0.45, params.tension ?? 0.25));

  return smoothGeo(geo, iterations, tension) || geo;
}
