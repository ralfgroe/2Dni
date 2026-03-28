import paper from 'paper';
import { geoToPaperPath } from '../utils/geoPathUtils';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

function ensurePaper() {
  if (!paperInitialized && canvas) {
    paper.setup(canvas);
    paperInitialized = true;
  }
}

export function pointtransformRuntime(params, inputs) {
  const inputGeo = inputs.geometry_in;
  if (!inputGeo) return null;

  const storedOffsets = (() => {
    try { return JSON.parse(params.point_offsets || '{}'); }
    catch { return {}; }
  })();

  const scale = params.scale ?? 1;
  const offsetX = params.offset_x ?? 0;
  const offsetY = params.offset_y ?? 0;
  const selectedStr = params.scale_points || '';
  const scaleIndices = selectedStr
    .split(',')
    .map(x => parseInt(x, 10))
    .filter(x => !isNaN(x));

  const selectedSet = new Set(scaleIndices.map(String));

  const offsets = {};
  for (const [k, v] of Object.entries(storedOffsets)) {
    if (!selectedSet.has(k)) {
      offsets[k] = v;
    }
  }
  if (scaleIndices.length > 0 && (offsetX !== 0 || offsetY !== 0)) {
    for (const idx of scaleIndices) {
      offsets[String(idx)] = [offsetX, offsetY];
    }
  }

  const hasOffsets = Object.keys(offsets).length > 0;
  const hasScale = scale !== 1 && scaleIndices.length > 0;

  if (!hasOffsets && !hasScale) return inputGeo;

  ensurePaper();

  const path = geoToPaperPath(inputGeo);
  if (!path) return inputGeo;

  const allSegments = [];
  if (path instanceof paper.CompoundPath) {
    path.children.forEach(child => {
      child.segments.forEach(seg => allSegments.push(seg));
    });
  } else {
    path.segments.forEach(seg => allSegments.push(seg));
  }

  for (const [idxStr, delta] of Object.entries(offsets)) {
    const idx = parseInt(idxStr, 10);
    if (idx >= 0 && idx < allSegments.length && Array.isArray(delta)) {
      allSegments[idx].point.x += delta[0];
      allSegments[idx].point.y += delta[1];
    }
  }

  if (hasScale) {
    const validIndices = scaleIndices.filter(i => i >= 0 && i < allSegments.length);
    if (validIndices.length > 0) {
      let cx = 0, cy = 0;
      for (const i of validIndices) {
        cx += allSegments[i].point.x;
        cy += allSegments[i].point.y;
      }
      cx /= validIndices.length;
      cy /= validIndices.length;

      for (const i of validIndices) {
        const seg = allSegments[i];
        seg.point.x = cx + (seg.point.x - cx) * scale;
        seg.point.y = cy + (seg.point.y - cy) * scale;
      }
    }
  }

  const pathData = path.pathData;
  const bounds = path.bounds;
  path.remove();

  const hasFill = inputGeo.fill && inputGeo.fill !== 'none';

  return {
    type: 'booleanResult',
    pathData,
    fill: hasFill ? inputGeo.fill : 'none',
    stroke: inputGeo.stroke || '#000000',
    strokeWidth: inputGeo.strokeWidth ?? 1,
    opacity: inputGeo.opacity,
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
  };
}
