import paper from 'paper';
import { geoToPaperPath } from '../utils/geoPathUtils';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

// Walks a single paper path by arc length and returns evenly spaced points,
// at most `maxPoints` of them. When `keepCorners` is set, the path's existing
// segment anchors (e.g. polygon corners) are preserved and the even samples
// are inserted between them so sharp features survive resampling.
function resampleSinglePath(path, segmentLength, keepCorners, maxPoints) {
  const totalLen = path.length;
  if (totalLen <= 0) return [];

  const segLen = Math.max(0.5, segmentLength);

  // Hard cap on how many points we'll emit so tiny segment lengths on huge
  // shapes can't lock up the UI.
  const allowed = Math.max(2, Math.floor(maxPoints));

  if (keepCorners) {
    // Cumulative arc-length offset of each existing anchor (curve endpoint),
    // then subdivide each span between consecutive anchors.
    const anchorOffsets = [0];
    let acc = 0;
    for (let i = 0; i < path.curves.length; i++) {
      acc += path.curves[i].length;
      anchorOffsets.push(acc);
    }

    const spanCount = path.curves.length;
    const points = [];
    for (let i = 0; i < spanCount; i++) {
      const start = anchorOffsets[i];
      const end = anchorOffsets[i + 1];
      const spanLen = end - start;
      if (spanLen <= 0) {
        const p = path.getPointAt(start);
        if (p) points.push({ x: p.x, y: p.y, original: true });
        continue;
      }
      const divisions = Math.max(1, Math.round(spanLen / segLen));
      for (let d = 0; d < divisions; d++) {
        const offset = start + (spanLen * d) / divisions;
        const p = path.getPointAt(Math.min(offset, totalLen));
        if (p) points.push({ x: p.x, y: p.y, original: d === 0 });
        if (points.length >= allowed) break;
      }
      if (points.length >= allowed) break;
    }
    if (!path.closed) {
      const last = path.getPointAt(totalLen);
      if (last) points.push({ x: last.x, y: last.y, original: true });
    }
    return points;
  }

  // Even spacing ignoring original anchors.
  let count = Math.round(totalLen / segLen);
  count = Math.max(2, Math.min(allowed, count));
  const points = [];
  const steps = path.closed ? count : count - 1;
  for (let i = 0; i <= steps; i++) {
    if (path.closed && i === steps) break;
    const offset = (i / steps) * totalLen;
    const p = path.getPointAt(Math.min(offset, totalLen));
    if (p) points.push({ x: p.x, y: p.y, original: false });
  }
  return points;
}

// Returns an array of { points, closed } subpaths for the input geometry.
export function computeResampledSubpaths(geo, params) {
  ensurePaper();
  if (!geo) return [];

  const segmentLength = params?.segment_length ?? 20;
  const keepCorners = params?.keep_corners ?? true;
  const maxPoints = params?.max_points ?? 2000;

  const paperPath = geoToPaperPath(geo);
  if (!paperPath) return [];

  const children = paperPath instanceof paper.CompoundPath
    ? paperPath.children
    : [paperPath];

  const subpaths = [];
  for (const child of children) {
    if (!child || !child.segments || child.segments.length === 0) continue;
    const pts = resampleSinglePath(child, segmentLength, keepCorners, maxPoints);
    if (pts.length > 0) {
      subpaths.push({ points: pts, closed: child.closed });
    }
  }

  paperPath.remove();
  return subpaths;
}

// Flat list of points for overlay display.
export function computeResampledPoints(geo, params) {
  const subpaths = computeResampledSubpaths(geo, params);
  const flat = [];
  for (const sp of subpaths) {
    for (const p of sp.points) flat.push(p);
  }
  return flat;
}

export function resampleRuntime(params, inputs) {
  ensurePaper();

  const geo = inputs?.geometry_in;
  if (!geo) return null;

  const subpaths = computeResampledSubpaths(geo, params);
  if (subpaths.length === 0) return geo;

  const compound = new paper.CompoundPath({ children: [] });
  for (const sp of subpaths) {
    const p = new paper.Path();
    sp.points.forEach((pt) => p.add(new paper.Point(pt.x, pt.y)));
    if (sp.closed) p.closePath();
    compound.addChild(p);
  }

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
