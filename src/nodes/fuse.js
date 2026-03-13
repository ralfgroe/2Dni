import paper from 'paper';
import { geoToPaperPath, flattenGeoToPathData } from '../utils/geoPathUtils';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

function ensurePaper() {
  if (!paperInitialized && canvas) {
    paper.setup(canvas);
    paperInitialized = true;
  }
}

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function extractOpenPaths(geo) {
  ensurePaper();

  if (geo.type === 'group' && geo.children) {
    const paths = [];
    for (const child of geo.children) {
      paths.push(...extractOpenPaths(child));
    }
    return paths;
  }

  const paperPath = geoToPaperPath(geo);
  if (!paperPath) return [];

  const children = paperPath.children ? [...paperPath.children] : [paperPath];
  const result = [];

  for (const child of children) {
    if (!child.segments || child.segments.length < 2) continue;

    const segs = child.segments.map(s => ({
      point: { x: s.point.x, y: s.point.y },
      handleIn: { x: s.handleIn ? s.handleIn.x : 0, y: s.handleIn ? s.handleIn.y : 0 },
      handleOut: { x: s.handleOut ? s.handleOut.x : 0, y: s.handleOut ? s.handleOut.y : 0 },
    }));

    result.push({ segments: segs, closed: child.closed });
  }

  paperPath.remove();
  return result;
}

function fuseAndJoin(paths, threshold) {
  if (paths.length === 0) return [];
  if (threshold <= 0) return paths;

  const open = paths.filter(p => !p.closed);
  const closed = paths.filter(p => p.closed);

  if (open.length <= 1) return paths;

  const used = new Set();
  const chains = [];

  for (let startIdx = 0; startIdx < open.length; startIdx++) {
    if (used.has(startIdx)) continue;
    used.add(startIdx);

    let chain = open[startIdx].segments.map(s => ({
      point: { ...s.point },
      handleIn: { ...s.handleIn },
      handleOut: { ...s.handleOut },
    }));
    let changed = true;

    while (changed) {
      changed = false;
      const chainStart = chain[0].point;
      const chainEnd = chain[chain.length - 1].point;

      for (let i = 0; i < open.length; i++) {
        if (used.has(i)) continue;
        const otherSegs = open[i].segments.map(s => ({
          point: { ...s.point },
          handleIn: { ...s.handleIn },
          handleOut: { ...s.handleOut },
        }));
        const otherStart = otherSegs[0].point;
        const otherEnd = otherSegs[otherSegs.length - 1].point;

        if (dist(chainEnd, otherStart) <= threshold) {
          const midX = (chainEnd.x + otherStart.x) / 2;
          const midY = (chainEnd.y + otherStart.y) / 2;
          chain[chain.length - 1].point = { x: midX, y: midY };
          chain[chain.length - 1].handleOut = { x: 0, y: 0 };
          const remaining = otherSegs.slice(1);
          if (remaining.length > 0) {
            remaining[0].handleIn = { x: 0, y: 0 };
          }
          chain.push(...remaining);
          used.add(i);
          changed = true;
          continue;
        }

        if (dist(chainEnd, otherEnd) <= threshold) {
          const midX = (chainEnd.x + otherEnd.x) / 2;
          const midY = (chainEnd.y + otherEnd.y) / 2;
          chain[chain.length - 1].point = { x: midX, y: midY };
          chain[chain.length - 1].handleOut = { x: 0, y: 0 };
          const reversed = [...otherSegs].reverse().map(s => ({
            point: { ...s.point },
            handleIn: { x: s.handleOut.x, y: s.handleOut.y },
            handleOut: { x: s.handleIn.x, y: s.handleIn.y },
          }));
          const remaining = reversed.slice(1);
          if (remaining.length > 0) {
            remaining[0].handleIn = { x: 0, y: 0 };
          }
          chain.push(...remaining);
          used.add(i);
          changed = true;
          continue;
        }

        if (dist(chainStart, otherEnd) <= threshold) {
          const midX = (chainStart.x + otherEnd.x) / 2;
          const midY = (chainStart.y + otherEnd.y) / 2;
          chain[0].point = { x: midX, y: midY };
          chain[0].handleIn = { x: 0, y: 0 };
          const prepend = otherSegs.slice(0, -1);
          if (prepend.length > 0) {
            prepend[prepend.length - 1].handleOut = { x: 0, y: 0 };
          }
          chain = [...prepend, ...chain];
          used.add(i);
          changed = true;
          continue;
        }

        if (dist(chainStart, otherStart) <= threshold) {
          const midX = (chainStart.x + otherStart.x) / 2;
          const midY = (chainStart.y + otherStart.y) / 2;
          chain[0].point = { x: midX, y: midY };
          chain[0].handleIn = { x: 0, y: 0 };
          const reversed = [...otherSegs].reverse().map(s => ({
            point: { ...s.point },
            handleIn: { x: s.handleOut.x, y: s.handleOut.y },
            handleOut: { x: s.handleIn.x, y: s.handleIn.y },
          }));
          const prepend = reversed.slice(0, -1);
          if (prepend.length > 0) {
            prepend[prepend.length - 1].handleOut = { x: 0, y: 0 };
          }
          chain = [...prepend, ...chain];
          used.add(i);
          changed = true;
          continue;
        }
      }
    }

    const first = chain[0].point;
    const last = chain[chain.length - 1].point;
    const isClosed = chain.length >= 3 && dist(first, last) <= threshold;

    if (isClosed) {
      const midX = (first.x + last.x) / 2;
      const midY = (first.y + last.y) / 2;
      chain[0].point = { x: midX, y: midY };
      chain.pop();
    }

    chains.push({ segments: chain, closed: isClosed });
  }

  return [...closed, ...chains];
}

export function fuseRuntime(params, inputs) {
  const { distance = 5 } = params;
  const inputGeo = inputs.geometry_in;

  if (!inputGeo) return null;

  ensurePaper();

  const paths = extractOpenPaths(inputGeo);
  if (paths.length === 0) return inputGeo;

  const fused = fuseAndJoin(paths, distance);

  const paperPaths = [];
  for (const chain of fused) {
    const p = new paper.Path();
    for (const seg of chain.segments) {
      p.add(new paper.Segment(
        new paper.Point(seg.point.x, seg.point.y),
        new paper.Point(seg.handleIn.x, seg.handleIn.y),
        new paper.Point(seg.handleOut.x, seg.handleOut.y),
      ));
    }
    if (chain.closed) p.closePath();
    paperPaths.push(p);
  }

  let compound;
  if (paperPaths.length === 1) {
    compound = paperPaths[0];
  } else {
    compound = new paper.CompoundPath({ children: paperPaths });
  }

  const pathData = compound.pathData;
  const bounds = compound.bounds;
  compound.remove();

  const stroke = inputGeo.stroke || inputGeo.children?.[0]?.stroke || '#000000';
  const strokeWidth = inputGeo.strokeWidth ?? inputGeo.children?.[0]?.strokeWidth ?? 1;

  return {
    type: 'booleanResult',
    pathData,
    fill: 'none',
    stroke,
    strokeWidth,
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
  };
}
