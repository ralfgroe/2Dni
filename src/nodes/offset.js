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

function offsetSinglePath(sourcePath, distance) {
  const pathLen = sourcePath.length;
  if (pathLen < 0.1) return null;

  const isClosed = sourcePath.closed;
  const sampleSpacing = 2;
  const numSamples = Math.max(Math.ceil(pathLen / sampleSpacing), 20);

  const offsetPoints = [];
  for (let i = 0; i <= numSamples; i++) {
    const t = isClosed
      ? (i / (numSamples + 1)) * pathLen
      : (i / numSamples) * pathLen;

    const point = sourcePath.getPointAt(t);
    const normal = sourcePath.getNormalAt(t);
    if (!point || !normal) continue;

    offsetPoints.push(new paper.Point(
      point.x + normal.x * distance,
      point.y + normal.y * distance
    ));
  }

  if (offsetPoints.length < 2) return null;

  const result = new paper.Path(offsetPoints);
  result.smooth({ type: 'catmull-rom', factor: 0.5 });

  if (isClosed) {
    result.closePath();
  }

  return result;
}

export function offsetRuntime(params, inputs) {
  const { distance = 10 } = params;
  const inputGeo = inputs.geometry_in;

  if (!inputGeo) return null;
  if (distance === 0) return inputGeo;

  ensurePaper();

  if (inputGeo.type === 'line') {
    const dx = inputGeo.x2 - inputGeo.x1;
    const dy = inputGeo.y2 - inputGeo.y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 0.001) return inputGeo;

    const nx = -dy / len;
    const ny = dx / len;

    const ox = nx * distance;
    const oy = ny * distance;
    const sw = inputGeo.strokeWidth || 2;

    return {
      type: 'line',
      x1: inputGeo.x1 + ox,
      y1: inputGeo.y1 + oy,
      x2: inputGeo.x2 + ox,
      y2: inputGeo.y2 + oy,
      stroke: inputGeo.stroke || '#000000',
      strokeWidth: sw,
      bounds: {
        x: Math.min(inputGeo.x1 + ox, inputGeo.x2 + ox) - sw / 2,
        y: Math.min(inputGeo.y1 + oy, inputGeo.y2 + oy) - sw / 2,
        width: Math.max(Math.abs(dx), sw) + sw,
        height: Math.max(Math.abs(dy), sw) + sw,
      },
    };
  }

  let workGeo = inputGeo;
  if (workGeo.type !== 'booleanResult') {
    const flattened = flattenGeoToPathData(workGeo);
    if (flattened) workGeo = flattened;
  }

  if (workGeo.type === 'booleanResult' && workGeo.pathData) {
    try {
      let sourcePath;
      let children;
      sourcePath = new paper.CompoundPath(workGeo.pathData);
      if (sourcePath.children && sourcePath.children.length > 0) {
        children = [...sourcePath.children];
      } else {
        sourcePath.remove();
        sourcePath = new paper.Path(workGeo.pathData);
        children = [sourcePath];
      }

      const offsetPaths = [];
      for (const child of children) {
        if (!child.segments || child.segments.length < 2) continue;
        const offsetPath = offsetSinglePath(child, distance);
        if (offsetPath) offsetPaths.push(offsetPath);
      }

      sourcePath.remove();

      if (offsetPaths.length === 0) return inputGeo;

      let compound;
      if (offsetPaths.length === 1) {
        compound = offsetPaths[0];
      } else {
        compound = new paper.CompoundPath({ children: offsetPaths });
      }

      const pathData = compound.pathData;
      const bounds = compound.bounds;
      compound.remove();

      const hasFill = inputGeo.fill && inputGeo.fill !== 'none';

      return {
        type: 'booleanResult',
        pathData,
        fill: hasFill ? inputGeo.fill : 'none',
        stroke: inputGeo.stroke || workGeo.stroke || '#000000',
        strokeWidth: inputGeo.strokeWidth ?? workGeo.strokeWidth ?? 1,
        opacity: inputGeo.opacity,
        bounds: {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
        },
      };
    } catch (e) {
      console.error('[Offset] error:', e);
      return inputGeo;
    }
  }

  return inputGeo;
}
