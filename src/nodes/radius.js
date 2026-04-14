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

      let resultPath;
      if (newPaths.length === 1) {
        resultPath = newPaths[0];
      } else {
        resultPath = new paper.CompoundPath({ children: newPaths });
      }
      const pathData = resultPath.pathData;
      const bounds = resultPath.bounds;
      resultPath.remove();

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

function vec(ax, ay, bx, by) {
  return { x: bx - ax, y: by - ay };
}
function vecLen(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}
function vecNorm(v) {
  const l = vecLen(v);
  return l < 1e-9 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
}
function dotVec(a, b) {
  return a.x * b.x + a.y * b.y;
}

function buildFilletedPath(childPath, radius, selected, globalOffset) {
  const segs = childPath.segments;
  const n = segs.length;
  const isClosed = childPath.closed;

  const pts = segs.map(s => ({ x: s.point.x, y: s.point.y }));

  const isLinear = segs.every(s => {
    const hi = s.handleIn;
    const ho = s.handleOut;
    const hiZero = !hi || (Math.abs(hi.x) < 0.01 && Math.abs(hi.y) < 0.01);
    const hoZero = !ho || (Math.abs(ho.x) < 0.01 && Math.abs(ho.y) < 0.01);
    return hiZero && hoZero;
  });

  if (!isLinear) {
    return buildFilletedPathCurves(childPath, radius, selected, globalOffset);
  }

  const segLens = [];
  for (let i = 0; i < n - 1; i++) {
    segLens.push(vecLen(vec(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y)));
  }
  if (isClosed) {
    segLens.push(vecLen(vec(pts[n - 1].x, pts[n - 1].y, pts[0].x, pts[0].y)));
  }

  const wantedOffset = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const gIdx = globalOffset + i;
    if (!selected.has(gIdx)) continue;
    if (!isClosed && (i === 0 || i === n - 1)) continue;

    const prevIdx = (i - 1 + n) % n;
    const nextIdx = (i + 1) % n;
    const dIn = vecNorm(vec(pts[i].x, pts[i].y, pts[prevIdx].x, pts[prevIdx].y));
    const dOut = vecNorm(vec(pts[i].x, pts[i].y, pts[nextIdx].x, pts[nextIdx].y));
    const dot = dotVec(dIn, dOut);
    const clamped = Math.max(-1, Math.min(1, dot));
    const angle = Math.acos(clamped);
    if (angle < SMOOTH_ANGLE_DEG * Math.PI / 180) continue;

    const sinHalf = Math.sin(angle / 2);
    if (sinHalf < 0.001) continue;
    const maxR = Math.min(
      isClosed ? segLens[prevIdx] : (i > 0 ? segLens[i - 1] : Infinity),
      isClosed ? segLens[i] : (i < n - 1 ? segLens[i] : Infinity)
    ) * 0.45;
    const effR = Math.min(radius, maxR);
    const offset = effR / Math.tan(angle / 2);

    wantedOffset[i] = offset;
  }

  const numSegs = isClosed ? n : n - 1;
  for (let ci = 0; ci < numSegs; ci++) {
    const cornerA = ci;
    const cornerB = (ci + 1) % n;
    const oA = wantedOffset[cornerA];
    const oB = wantedOffset[cornerB];
    if (oA <= 0 && oB <= 0) continue;
    const total = oA + oB;
    const available = segLens[ci] * 0.95;
    if (total > available) {
      const scale = available / total;
      if (oA > 0) wantedOffset[cornerA] = oA * scale;
      if (oB > 0) wantedOffset[cornerB] = oB * scale;
    }
  }

  const result = new paper.Path();

  for (let i = 0; i < n; i++) {
    const offset = wantedOffset[i];
    if (offset < 0.01) {
      result.add(new paper.Point(pts[i].x, pts[i].y));
      continue;
    }

    const prevIdx = (i - 1 + n) % n;
    const nextIdx = (i + 1) % n;
    const dIn = vecNorm(vec(pts[i].x, pts[i].y, pts[prevIdx].x, pts[prevIdx].y));
    const dOut = vecNorm(vec(pts[i].x, pts[i].y, pts[nextIdx].x, pts[nextIdx].y));

    const pA = { x: pts[i].x + dIn.x * offset, y: pts[i].y + dIn.y * offset };
    const pB = { x: pts[i].x + dOut.x * offset, y: pts[i].y + dOut.y * offset };

    const dot = dotVec(dIn, dOut);
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));
    const effR = offset * Math.tan(angle / 2);
    const k = (4 / 3) * Math.tan(angle / 4);
    const hA = k * effR;

    result.add(new paper.Segment(
      new paper.Point(pA.x, pA.y),
      null,
      new paper.Point(-dIn.x * hA, -dIn.y * hA)
    ));
    result.add(new paper.Segment(
      new paper.Point(pB.x, pB.y),
      new paper.Point(-dOut.x * hA, -dOut.y * hA),
      null
    ));
  }

  if (isClosed) result.closePath();
  return result;
}

function buildFilletedPathCurves(childPath, radius, selected, globalOffset) {
  const segs = childPath.segments;
  const n = segs.length;
  const isClosed = childPath.closed;

  const result = new paper.Path();
  for (let i = 0; i < n; i++) {
    const seg = segs[i];
    result.add(new paper.Segment(
      new paper.Point(seg.point.x, seg.point.y),
      seg.handleIn ? new paper.Point(seg.handleIn.x, seg.handleIn.y) : null,
      seg.handleOut ? new paper.Point(seg.handleOut.x, seg.handleOut.y) : null
    ));
  }
  if (isClosed) result.closePath();
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
