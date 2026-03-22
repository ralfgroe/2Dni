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

  if (!geoA && !geoB) return { __multiOutput: true, geometry_out_a: null, geometry_out_b: null };
  if (!geoA) return { __multiOutput: true, geometry_out_a: null, geometry_out_b: geoB };
  if (!geoB) return { __multiOutput: true, geometry_out_a: geoA, geometry_out_b: null };

  if (align_x === 'None' && align_y === 'None') {
    return { __multiOutput: true, geometry_out_a: geoA, geometry_out_b: geoB };
  }

  const boundsA = getBounds(geoA);
  const boundsB = getBounds(geoB);
  if (!boundsA || !boundsB) {
    return { __multiOutput: true, geometry_out_a: geoA, geometry_out_b: geoB };
  }

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

  const alignedB = translateGeo(geoB, dx, dy);
  return { __multiOutput: true, geometry_out_a: geoA, geometry_out_b: alignedB };
}

function translateGeo(geo, dx, dy) {
  if (dx === 0 && dy === 0) return geo;

  ensurePaper();

  const path = geoToPaperPath(geo);
  if (!path) return geo;

  path.translate(new paper.Point(dx, dy));

  const pathData = path.pathData;
  const bounds = path.bounds;
  path.remove();

  return {
    type: 'booleanResult',
    pathData,
    fill: geo.fill && geo.fill !== 'none' ? geo.fill : 'none',
    stroke: geo.stroke || '#000000',
    strokeWidth: geo.strokeWidth ?? 1,
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
  };
}
