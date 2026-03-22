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

function deepCloneGeo(geo) {
  if (!geo) return null;
  if (geo.type === 'group' || geo.type === 'boolean') {
    return {
      ...geo,
      children: geo.children ? geo.children.map(deepCloneGeo) : [],
      bounds: geo.bounds ? { ...geo.bounds } : undefined,
    };
  }
  return { ...geo, bounds: geo.bounds ? { ...geo.bounds } : undefined };
}

function transformGeoWithPaper(geo, fn) {
  ensurePaper();
  const path = geoToPaperPath(geo);
  if (!path) return geo;
  fn(path);
  const pathData = path.pathData;
  const b = path.bounds;
  path.remove();
  return {
    type: 'booleanResult',
    pathData,
    fill: geo.fill || 'none',
    stroke: geo.stroke || '#000000',
    strokeWidth: geo.strokeWidth ?? 1,
    bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
  };
}

function applyTransformToGeo(geo, fn) {
  if (!geo) return null;
  if ((geo.type === 'group' || geo.type === 'boolean') && geo.children) {
    const transformedChildren = geo.children.map((child) => applyTransformToGeo(child, fn));
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
      children: transformedChildren,
      bounds: {
        x: isFinite(minX) ? minX : 0,
        y: isFinite(minY) ? minY : 0,
        width: isFinite(maxX - minX) ? maxX - minX : 0,
        height: isFinite(maxY - minY) ? maxY - minY : 0,
      },
    };
  }
  return transformGeoWithPaper(geo, fn);
}

export function copymoveRuntime(params, inputs) {
  const { copies = 1, offset_x = 50, offset_y = 0, scale_step = 0 } = params;
  const inputGeo = inputs.geometry_in;
  if (!inputGeo) return null;

  const count = Math.round(Math.max(0, copies));
  if (count === 0) return inputGeo;

  ensurePaper();

  const children = [deepCloneGeo(inputGeo)];

  for (let i = 1; i <= count; i++) {
    const dx = offset_x * i;
    const dy = offset_y * i;
    const scaleFactor = 1 + (scale_step * i);
    const copy = applyTransformToGeo(deepCloneGeo(inputGeo), (path) => {
      path.translate(new paper.Point(dx, dy));
      if (scaleFactor > 0.01) {
        path.scale(scaleFactor);
      }
    });
    children.push(copy);
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const child of children) {
    if (child && child.bounds) {
      minX = Math.min(minX, child.bounds.x);
      minY = Math.min(minY, child.bounds.y);
      maxX = Math.max(maxX, child.bounds.x + child.bounds.width);
      maxY = Math.max(maxY, child.bounds.y + child.bounds.height);
    }
  }

  return {
    type: 'group',
    children,
    transform: {},
    bounds: {
      x: isFinite(minX) ? minX : 0,
      y: isFinite(minY) ? minY : 0,
      width: isFinite(maxX - minX) ? maxX - minX : 0,
      height: isFinite(maxY - minY) ? maxY - minY : 0,
    },
  };
}
