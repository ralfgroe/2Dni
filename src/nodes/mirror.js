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

export function mirrorRuntime(params, inputs) {
  const {
    mirror_x = true,
    mirror_y = false,
    axis_x = 0,
    axis_y = 0,
    keep_original = true,
  } = params;
  const inputGeo = inputs.geometry_in;
  if (!inputGeo) return null;
  if (!mirror_x && !mirror_y) return inputGeo;

  ensurePaper();

  const sourcePath = geoToPaperPath(inputGeo);
  if (!sourcePath) return inputGeo;

  const mirrored = sourcePath.clone();

  if (mirror_x) {
    mirrored.scale(-1, 1, new paper.Point(axis_x, axis_y));
  }
  if (mirror_y) {
    mirrored.scale(1, -1, new paper.Point(axis_x, axis_y));
  }

  let allPaths;
  if (keep_original) {
    allPaths = [sourcePath.clone(), mirrored];
  } else {
    allPaths = [mirrored];
  }

  const compound = new paper.CompoundPath({ children: allPaths });
  const pathData = compound.pathData;
  const bounds = compound.bounds;
  compound.remove();
  sourcePath.remove();

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
