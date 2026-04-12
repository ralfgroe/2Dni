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

function transformPoint(x, y, finalScaleX, finalScaleY, rotate, translate_x, translate_y, pivot_x, pivot_y) {
  let px = x - pivot_x;
  let py = y - pivot_y;

  px *= finalScaleX;
  py *= finalScaleY;

  if (rotate !== 0) {
    const rad = (rotate * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const rx = px * cos - py * sin;
    const ry = px * sin + py * cos;
    px = rx;
    py = ry;
  }

  px += pivot_x + translate_x;
  py += pivot_y + translate_y;

  return { x: px, y: py };
}

function transformSingleGeo(geo, finalScaleX, finalScaleY, rotate, translate_x, translate_y, pivot_x, pivot_y) {
  ensurePaper();
  const path = geoToPaperPath(geo);
  if (!path) return geo;

  const pivot = new paper.Point(pivot_x, pivot_y);
  if (finalScaleX !== 1 || finalScaleY !== 1) {
    path.scale(finalScaleX, finalScaleY, pivot);
  }
  if (rotate !== 0) {
    path.rotate(rotate, pivot);
  }
  if (translate_x !== 0 || translate_y !== 0) {
    path.translate(new paper.Point(translate_x, translate_y));
  }

  const pathData = path.pathData;
  const bounds = path.bounds;
  path.remove();

  const hasFill = geo.fill && geo.fill !== 'none';
  return {
    type: 'booleanResult',
    pathData,
    fill: hasFill ? geo.fill : 'none',
    stroke: geo.stroke || '#000000',
    strokeWidth: geo.strokeWidth ?? 1,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}

function transformGeoRecursive(geo, finalScaleX, finalScaleY, rotate, translate_x, translate_y, pivot_x, pivot_y) {
  if (!geo) return null;

  if ((geo.type === 'group' || geo.type === 'boolean') && geo.children) {
    const transformedChildren = geo.children.map((child) =>
      transformGeoRecursive(child, finalScaleX, finalScaleY, rotate, translate_x, translate_y, pivot_x, pivot_y)
    ).filter(Boolean);

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const child of transformedChildren) {
      if (child && child.bounds) {
        minX = Math.min(minX, child.bounds.x);
        minY = Math.min(minY, child.bounds.y);
        maxX = Math.max(maxX, child.bounds.x + child.bounds.width);
        maxY = Math.max(maxY, child.bounds.y + child.bounds.height);
      }
    }
    return {
      ...geo,
      transform: {},
      children: transformedChildren,
      bounds: {
        x: isFinite(minX) ? minX : 0,
        y: isFinite(minY) ? minY : 0,
        width: isFinite(maxX - minX) ? maxX - minX : 0,
        height: isFinite(maxY - minY) ? maxY - minY : 0,
      },
    };
  }

  return transformSingleGeo(geo, finalScaleX, finalScaleY, rotate, translate_x, translate_y, pivot_x, pivot_y);
}

export function transformRuntime(params, inputs) {
  const {
    translate_x = 0,
    translate_y = 0,
    rotate = 0,
    scale = 1,
    scale_x = 1,
    scale_y = 1,
    pivot_x = 0,
    pivot_y = 0,
  } = params;

  const inputGeo = inputs.geometry_in;
  if (!inputGeo) return null;

  const finalScaleX = scale * scale_x;
  const finalScaleY = scale * scale_y;

  const isIdentity = translate_x === 0 && translate_y === 0 &&
    rotate === 0 && finalScaleX === 1 && finalScaleY === 1;
  if (isIdentity) return inputGeo;

  if (inputGeo.type === 'line') {
    const p1 = transformPoint(inputGeo.x1, inputGeo.y1, finalScaleX, finalScaleY, rotate, translate_x, translate_y, pivot_x, pivot_y);
    const p2 = transformPoint(inputGeo.x2, inputGeo.y2, finalScaleX, finalScaleY, rotate, translate_x, translate_y, pivot_x, pivot_y);
    const sw = inputGeo.strokeWidth || 2;
    return {
      type: 'line',
      x1: p1.x,
      y1: p1.y,
      x2: p2.x,
      y2: p2.y,
      stroke: inputGeo.stroke || '#000000',
      strokeWidth: sw,
      bounds: {
        x: Math.min(p1.x, p2.x) - sw / 2,
        y: Math.min(p1.y, p2.y) - sw / 2,
        width: Math.max(Math.abs(p2.x - p1.x), sw) + sw,
        height: Math.max(Math.abs(p2.y - p1.y), sw) + sw,
      },
    };
  }

  return transformGeoRecursive(inputGeo, finalScaleX, finalScaleY, rotate, translate_x, translate_y, pivot_x, pivot_y);
}
