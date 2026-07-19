import paper from 'paper';
import { flattenGeoToPathData, ensurePaper } from './geoPathUtils';

const SMOOTH_ANGLE_DEG = 20;

function getCornerAngle(childPath, segIndex) {
  const curves = childPath.curves;
  if (!curves) return 180;
  const n = curves.length;
  if (n < 2) return 180;

  const curveIn = curves[(segIndex - 1 + n) % n];
  const curveOut = curves[segIndex % n];

  const tanIn = curveIn.getTangentAtTime(1);
  const tanOut = curveOut.getTangentAtTime(0);

  if (tanIn.length < 0.0001 || tanOut.length < 0.0001) return 180;

  const dot = tanIn.dot(tanOut) / (tanIn.length * tanOut.length);
  const clamped = Math.max(-1, Math.min(1, dot));
  return Math.acos(clamped) * 180 / Math.PI;
}

function parsePath(pathData) {
  const compound = new paper.CompoundPath(pathData);
  if (compound.children && compound.children.length > 0) {
    return { item: compound, children: compound.children };
  }
  compound.remove();

  const single = new paper.Path(pathData);
  if (single.segments && single.segments.length > 0) {
    return { item: single, children: [single] };
  }
  single.remove();
  return null;
}

function extractFromPathData(pathData) {
  // Ensure our shared main project is active — a Furniture/Floorplan scratch
  // project may have been the last one activated, and parsing against it yields
  // no segments (dimension points would silently vanish).
  ensurePaper();
  const parsed = parsePath(pathData);
  if (!parsed) return [];

  const points = [];
  let globalIdx = 0;
  for (const child of parsed.children) {
    if (!child.segments) continue;
    const segs = child.segments;
    const n = segs.length;
    for (let i = 0; i < n; i++) {
      const seg = segs[i];
      const cornerAngle = getCornerAngle(child, i);
      const sharp = cornerAngle > SMOOTH_ANGLE_DEG;

      points.push({
        x: seg.point.x,
        y: seg.point.y,
        sharp,
        idx: globalIdx,
      });
      globalIdx++;
    }
  }
  parsed.item.remove();
  return points;
}

export function extractPoints(geo) {
  if (!geo) return [];

  // A rotated rect/roundedRect can't use its axis-aligned corners directly —
  // flatten through paper (which applies the rotation) to get true corners.
  if ((geo.type === 'rect' || geo.type === 'roundedRect') && geo.rotation && geo.rotation % 360 !== 0) {
    try {
      const flattened = flattenGeoToPathData(geo);
      if (flattened && flattened.pathData) return extractFromPathData(flattened.pathData);
    } catch (e) {
      console.error('[extractPoints] rotated rect flatten error:', e);
    }
  }

  switch (geo.type) {
    case 'rect':
      return [
        { x: geo.x || 0, y: geo.y || 0, sharp: true, idx: 0 },
        { x: (geo.x || 0) + geo.width, y: geo.y || 0, sharp: true, idx: 1 },
        { x: (geo.x || 0) + geo.width, y: (geo.y || 0) + geo.height, sharp: true, idx: 2 },
        { x: geo.x || 0, y: (geo.y || 0) + geo.height, sharp: true, idx: 3 },
      ];

    case 'roundedRect':
      return [
        { x: geo.x || 0, y: geo.y || 0, sharp: true, idx: 0 },
        { x: (geo.x || 0) + geo.width, y: geo.y || 0, sharp: true, idx: 1 },
        { x: (geo.x || 0) + geo.width, y: (geo.y || 0) + geo.height, sharp: true, idx: 2 },
        { x: geo.x || 0, y: (geo.y || 0) + geo.height, sharp: true, idx: 3 },
      ];

    case 'booleanResult': {
      if (!geo.pathData) return [];
      try {
        ensurePaper();
        return extractFromPathData(geo.pathData);
      } catch (e) {
        console.error('[extractPoints] error:', e);
        return [];
      }
    }

    case 'group':
    case 'ellipse':
    case 'arc':
    case 'text': {
      try {
        const flattened = flattenGeoToPathData(geo);
        if (!flattened || !flattened.pathData) return [];
        return extractFromPathData(flattened.pathData);
      } catch (e) {
        console.error('[extractPoints] flatten error:', e);
        return [];
      }
    }

    default:
      return [];
  }
}
