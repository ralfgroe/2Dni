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

function getBounds(geo) {
  if (geo.bounds) return geo.bounds;
  if (geo.type === 'rect' || geo.type === 'roundedRect') {
    return { x: geo.x, y: geo.y, width: geo.width, height: geo.height };
  }
  if (geo.type === 'line') {
    const minX = Math.min(geo.x1, geo.x2);
    const minY = Math.min(geo.y1, geo.y2);
    return { x: minX, y: minY, width: Math.abs(geo.x2 - geo.x1), height: Math.abs(geo.y2 - geo.y1) };
  }
  return null;
}

export function alignRuntime(params, inputs) {
  const { align_x = 'None', align_y = 'None' } = params;
  const geoA = inputs.geometry_a;
  const geoB = inputs.geometry_b;

  if (!geoA && !geoB) return null;
  if (!geoA) return geoB;
  if (!geoB) return geoA;

  if (align_x === 'None' && align_y === 'None') {
    return mergeGeo(geoA, geoB, 0, 0);
  }

  const boundsA = getBounds(geoA);
  const boundsB = getBounds(geoB);
  if (!boundsA || !boundsB) return mergeGeo(geoA, geoB, 0, 0);

  let dx = 0;
  let dy = 0;

  if (align_x === 'Left') {
    dx = boundsA.x - boundsB.x;
  } else if (align_x === 'Center') {
    const centerA = boundsA.x + boundsA.width / 2;
    const centerB = boundsB.x + boundsB.width / 2;
    dx = centerA - centerB;
  } else if (align_x === 'Right') {
    dx = (boundsA.x + boundsA.width) - (boundsB.x + boundsB.width);
  }

  if (align_y === 'Top') {
    dy = boundsA.y - boundsB.y;
  } else if (align_y === 'Center') {
    const centerA = boundsA.y + boundsA.height / 2;
    const centerB = boundsB.y + boundsB.height / 2;
    dy = centerA - centerB;
  } else if (align_y === 'Bottom') {
    dy = (boundsA.y + boundsA.height) - (boundsB.y + boundsB.height);
  }

  return mergeGeo(geoA, geoB, dx, dy);
}

function mergeGeo(geoA, geoB, dx, dy) {
  if (dx === 0 && dy === 0) {
    const bA = getBounds(geoA) || { x: 0, y: 0, width: 0, height: 0 };
    const bB = getBounds(geoB) || { x: 0, y: 0, width: 0, height: 0 };
    const minX = Math.min(bA.x, bB.x);
    const minY = Math.min(bA.y, bB.y);
    const maxX = Math.max(bA.x + bA.width, bB.x + bB.width);
    const maxY = Math.max(bA.y + bA.height, bB.y + bB.height);
    return {
      type: 'group',
      children: [geoA, geoB],
      bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    };
  }

  ensurePaper();

  const pathA = geoToPaperPath(geoA);
  const pathB = geoToPaperPath(geoB);
  if (!pathA || !pathB) {
    return { type: 'group', children: [geoA, geoB], bounds: getBounds(geoA) };
  }

  pathB.translate(new paper.Point(dx, dy));

  const compound = new paper.CompoundPath({ children: [pathA.clone(), pathB.clone()] });
  const pathData = compound.pathData;
  const bounds = compound.bounds;
  compound.remove();
  pathA.remove();
  pathB.remove();

  return {
    type: 'booleanResult',
    pathData,
    fill: geoA.fill && geoA.fill !== 'none' ? geoA.fill : (geoB.fill && geoB.fill !== 'none' ? geoB.fill : 'none'),
    stroke: geoA.stroke || geoB.stroke || '#000000',
    strokeWidth: geoA.strokeWidth ?? geoB.strokeWidth ?? 1,
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
  };
}
