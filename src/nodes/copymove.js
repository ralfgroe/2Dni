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

export function copymoveRuntime(params, inputs) {
  const { copies = 1, offset_x = 50, offset_y = 0 } = params;
  const inputGeo = inputs.geometry_in;
  if (!inputGeo) return null;

  const count = Math.round(Math.max(0, copies));
  if (count === 0) return inputGeo;

  ensurePaper();

  const sourcePath = geoToPaperPath(inputGeo);
  if (!sourcePath) return inputGeo;

  const allPaths = [sourcePath.clone()];

  for (let i = 1; i <= count; i++) {
    const copy = sourcePath.clone();
    copy.translate(new paper.Point(offset_x * i, offset_y * i));
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
