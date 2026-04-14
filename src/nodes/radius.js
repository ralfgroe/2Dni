import paper from 'paper';
import { flattenGeoToPathData } from '../utils/geoPathUtils';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

function ensurePaper() {
  if (!paperInitialized && canvas) {
    paper.setup(canvas);
    paperInitialized = true;
  }
}

export function radiusRuntime(params, inputs) {
  const { radius = 10, point_selection = '*' } = params;
  const inputGeo = inputs.geometry_in;

  if (!inputGeo) return null;

  if (inputGeo.type === 'rect' || inputGeo.type === 'roundedRect') {
    const selected = parsePointSelection(point_selection, 4);
    const existing = inputGeo.corners || [0, 0, 0, 0];
    const corners = [
      selected.has(0) ? radius : existing[0],
      selected.has(1) ? radius : existing[1],
      selected.has(2) ? radius : existing[2],
      selected.has(3) ? radius : existing[3],
    ];

    return {
      ...inputGeo,
      type: 'roundedRect',
      corners,
      rx: radius,
      ry: radius,
    };
  }

  let workGeo = inputGeo;
  if (workGeo.type !== 'booleanResult') {
    const flattened = flattenGeoToPathData(workGeo);
    if (flattened) {
      workGeo = flattened;
    }
  }

  if (workGeo.type === 'booleanResult' && workGeo.pathData) {
    if (radius <= 0) return inputGeo;

    try {
      ensurePaper();

      let sourcePath;
      let children;
      sourcePath = new paper.Path(inputGeo.pathData);
      if (sourcePath.isEmpty()) {
        sourcePath.remove();
        sourcePath = new paper.CompoundPath(inputGeo.pathData);
        children = sourcePath.children && sourcePath.children.length > 0
          ? sourcePath.children
          : [sourcePath];
      } else {
        const compound = new paper.CompoundPath(inputGeo.pathData);
        if (compound.children && compound.children.length > 1) {
          sourcePath.remove();
          sourcePath = compound;
          children = compound.children;
        } else {
          compound.remove();
          children = [sourcePath];
        }
      }

      let totalPoints = 0;
      for (const child of children) {
        if (child.segments) totalPoints += child.segments.length;
      }

      const selected = parsePointSelection(point_selection, totalPoints);
      if (selected.size === 0) {
        sourcePath.remove();
        return inputGeo;
      }

      const newPaths = [];
      let globalIdx = 0;

      for (const child of children) {
        if (!child.segments) continue;
        const n = child.segments.length;
        const filletedPath = buildFilletedPath(child, radius, selected, globalIdx);
        newPaths.push(filletedPath);
        globalIdx += n;
      }

      sourcePath.remove();

      const compound = new paper.CompoundPath({ children: newPaths });
      const pathData = compound.pathData;
      const bounds = compound.bounds;
      compound.remove();

      return {
        type: 'booleanResult',
        pathData,
        fill: workGeo.fill || inputGeo.fill || '#ffffff',
        stroke: workGeo.stroke || inputGeo.stroke || '#000000',
        strokeWidth: workGeo.strokeWidth ?? inputGeo.strokeWidth ?? 1,
        opacity: inputGeo.opacity,
        bounds: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        },
      };
    } catch (e) {
      console.error('[Radius] fillet error:', e);
      return inputGeo;
    }
  }

  return {
    ...inputGeo,
    radius,
    pointSelection: point_selection,
  };
}

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

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function subdivideCubic(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, t) {
  const q0x = lerp(p0x, p1x, t), q0y = lerp(p0y, p1y, t);
  const q1x = lerp(p1x, p2x, t), q1y = lerp(p1y, p2y, t);
  const q2x = lerp(p2x, p3x, t), q2y = lerp(p2y, p3y, t);

  const r0x = lerp(q0x, q1x, t), r0y = lerp(q0y, q1y, t);
  const r1x = lerp(q1x, q2x, t), r1y = lerp(q1y, q2y, t);

  const sx = lerp(r0x, r1x, t), sy = lerp(r0y, r1y, t);

  return {
    first: {
      p1: { x: p0x, y: p0y },
      h1: { x: q0x - p0x, y: q0y - p0y },
      h2: { x: r0x - sx, y: r0y - sy },
      p2: { x: sx, y: sy },
    },
    second: {
      p1: { x: sx, y: sy },
      h1: { x: r1x - sx, y: r1y - sy },
      h2: { x: q2x - p3x, y: q2y - p3y },
      p2: { x: p3x, y: p3y },
    },
  };
}

function splitPaperCurve(curve, t) {
  const s1 = curve.segment1;
  const s2 = curve.segment2;

  const p0x = s1.point.x, p0y = s1.point.y;
  const p1x = p0x + (s1.handleOut ? s1.handleOut.x : 0);
  const p1y = p0y + (s1.handleOut ? s1.handleOut.y : 0);
  const p2x = s2.point.x + (s2.handleIn ? s2.handleIn.x : 0);
  const p2y = s2.point.y + (s2.handleIn ? s2.handleIn.y : 0);
  const p3x = s2.point.x, p3y = s2.point.y;

  return subdivideCubic(p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y, t);
}

function safeTangent(curve, time) {
  if (time == null || isNaN(time)) return null;
  try {
    const t = curve.getTangentAtTime(time);
    if (!t || t.length < 0.0001) return null;
    return t.normalize();
  } catch {
    return null;
  }
}

function buildFilletedPath(childPath, radius, selected, globalOffset) {
  const segs = childPath.segments;
  const curves = childPath.curves;
  const n = segs.length;
  const isClosed = childPath.closed;

  const filletData = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const gIdx = globalOffset + i;
    if (!selected.has(gIdx)) continue;

    if (!isClosed && (i === 0 || i === n - 1)) continue;

    const cornerAngle = getCornerAngle(childPath, i);
    if (cornerAngle <= SMOOTH_ANGLE_DEG) continue;

    const curveInIdx = (i - 1 + n) % n;
    const curveOutIdx = i % n;
    const curveIn = curves[curveInIdx];
    const curveOut = curves[curveOutIdx];

    if (!curveIn || !curveOut) continue;

    const curveInLen = curveIn.length;
    const curveOutLen = curveOut.length;
    if (curveInLen < 0.1 || curveOutLen < 0.1) continue;

    const maxOffset = Math.min(curveInLen * 0.95, curveOutLen * 0.95);
    const cornerRad = cornerAngle * Math.PI / 180;
    const halfAngle = cornerRad / 2;
    const tanHalf = Math.tan(halfAngle);
    if (tanHalf < 0.001) continue;

    const offset = Math.min(radius, maxOffset);
    if (offset < 0.01) continue;
    const effectiveR = offset / tanHalf;

    const tIn = curveIn.getTimeAt(curveInLen - offset);
    const tOut = curveOut.getTimeAt(offset);
    if (tIn == null || tOut == null || isNaN(tIn) || isNaN(tOut)) continue;
    if (tIn <= 0.001 || tIn >= 0.999 || tOut <= 0.001 || tOut >= 0.999) continue;

    const tanInDir = safeTangent(curveIn, tIn);
    const tanOutDir = safeTangent(curveOut, tOut);
    if (!tanInDir || !tanOutDir) continue;

    const splitIn = splitPaperCurve(curveIn, tIn);
    const splitOut = splitPaperCurve(curveOut, tOut);

    const handleLen = (4 / 3) * effectiveR * Math.tan(cornerRad / 4);

    filletData[i] = {
      cornerAngle, cornerRad, offset, effectiveR, handleLen,
      splitIn, splitOut, tanInDir, tanOutDir,
    };
  }

  const result = new paper.Path();

  for (let i = 0; i < n; i++) {
    const seg = segs[i];
    const fd = filletData[i];
    const prevFd = filletData[(i - 1 + n) % n];
    const nextFd = filletData[(i + 1) % n];

    if (fd) {
      const { splitIn, splitOut, handleLen, tanInDir, tanOutDir } = fd;

      const pStart = splitIn.first.p2;
      const pEnd = splitOut.second.p1;

      const startHandleIn = splitIn.first.h2;
      const endHandleOut = splitOut.second.h1;

      result.add(new paper.Segment(
        new paper.Point(pStart.x, pStart.y),
        new paper.Point(startHandleIn.x, startHandleIn.y),
        new paper.Point(tanInDir.x * handleLen, tanInDir.y * handleLen)
      ));

      result.add(new paper.Segment(
        new paper.Point(pEnd.x, pEnd.y),
        new paper.Point(-tanOutDir.x * handleLen, -tanOutDir.y * handleLen),
        new paper.Point(endHandleOut.x, endHandleOut.y)
      ));
    } else {
      let hIn = seg.handleIn
        ? { x: seg.handleIn.x, y: seg.handleIn.y }
        : { x: 0, y: 0 };
      let hOut = seg.handleOut
        ? { x: seg.handleOut.x, y: seg.handleOut.y }
        : { x: 0, y: 0 };

      if (prevFd) {
        hIn = prevFd.splitOut.second.h2;
      }
      if (nextFd) {
        hOut = nextFd.splitIn.first.h1;
      }

      result.add(new paper.Segment(
        new paper.Point(seg.point.x, seg.point.y),
        new paper.Point(hIn.x, hIn.y),
        new paper.Point(hOut.x, hOut.y)
      ));
    }
  }

  if (isClosed) {
    result.closePath();
  }
  return result;
}

function parsePointSelection(sel, total) {
  if (sel === '*') {
    const s = new Set();
    for (let i = 0; i < total; i++) s.add(i);
    return s;
  }

  const result = new Set();
  const parts = sel.split(',').map((p) => p.trim()).filter(Boolean);
  for (const p of parts) {
    const idx = parseInt(p, 10);
    if (!isNaN(idx) && idx >= 0 && idx < total) result.add(idx);
  }
  return result;
}
