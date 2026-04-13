import paper from 'paper';
import { geoToPaperPath } from '../utils/geoPathUtils';

const canvas = typeof document !== 'undefined'
  ? document.createElement('canvas')
  : null;

let paperInitialized = false;

function ensurePaper() {
  if (!paperInitialized && canvas) {
    paper.setup(canvas);
    paperInitialized = true;
  }
}

const OP_MAP = {
  union: 'unite',
  subtract: 'subtract',
  intersect: 'intersect',
  exclude: 'exclude',
};

export function booleanRuntime(params, inputs) {
  const { operation = 'union' } = params;
  const geoA = inputs.geometry_a;
  const geoB = inputs.geometry_b;

  if (!geoA && !geoB) return null;
  if (!geoA) return geoB;
  if (!geoB) return geoA;

  try {
    ensurePaper();

    const pathA = geoToPaperPath(geoA);
    const pathB = geoToPaperPath(geoB);

    if (!pathA || !pathB) {
      return { type: 'boolean', operation, children: [geoA, geoB], bounds: combinedBounds(geoA, geoB) };
    }

    const method = OP_MAP[operation] || 'unite';
    const result = pathA[method](pathB);
    const pathData = result.pathData;
    const bounds = result.bounds;

    pathA.remove();
    pathB.remove();
    result.remove();

    return {
      type: 'booleanResult',
      pathData,
      fill: geoA.fill || '#ffffff',
      stroke: geoA.stroke || '#000000',
      strokeWidth: geoA.strokeWidth ?? 1,
      opacity: geoA.opacity,
      bounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
    };
  } catch (e) {
    return { type: 'boolean', operation, children: [geoA, geoB], bounds: combinedBounds(geoA, geoB) };
  }
}

function combinedBounds(geoA, geoB) {
  const ax = geoA.bounds?.x || 0;
  const ay = geoA.bounds?.y || 0;
  const bx = geoB.bounds?.x || 0;
  const by = geoB.bounds?.y || 0;
  return {
    x: Math.min(ax, bx),
    y: Math.min(ay, by),
    width: Math.max(ax + (geoA.bounds?.width || 0), bx + (geoB.bounds?.width || 0)),
    height: Math.max(ay + (geoA.bounds?.height || 0), by + (geoB.bounds?.height || 0)),
  };
}
