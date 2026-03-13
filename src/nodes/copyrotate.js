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

export function copyrotateRuntime(params, inputs) {
  const { copies = 3, pivot_x = 0, pivot_y = 0 } = params;
  const inputGeo = inputs.geometry_in;
  if (!inputGeo) return null;

  const count = Math.round(Math.max(1, copies));
  if (count === 1) return inputGeo;

  ensurePaper();

  const sourcePath = geoToPaperPath(inputGeo);
  if (!sourcePath) return inputGeo;

  const pivot = new paper.Point(pivot_x, pivot_y);
  const angleStep = 360 / count;

  const allPaths = [sourcePath.clone()];

  for (let i = 1; i < count; i++) {
    const copy = sourcePath.clone();
    copy.rotate(angleStep * i, pivot);
    allPaths.push(copy);
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
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
  };
}
