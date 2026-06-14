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
    opacity: geo.opacity,
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
  const {
    copies = 1,
    offset_x = 50,
    offset_y = 0,
    scale_step = 0,
    dir2_enabled = false,
    dir2_copies = 1,
    dir2_offset_x = 0,
    dir2_offset_y = 50,
  } = params;
  const inputGeo = inputs.geometry_in;
  if (!inputGeo) return null;

  const count1 = Math.round(Math.max(0, copies));
  const count2 = dir2_enabled ? Math.round(Math.max(0, dir2_copies)) : 0;
  if (count1 === 0 && count2 === 0) return inputGeo;

  ensurePaper();

  // Build a grid: index i runs along Direction 1, index j along Direction 2.
  // (i, j) = (0, 0) is the original, untransformed instance.
  const children = [];
  for (let j = 0; j <= count2; j++) {
    for (let i = 0; i <= count1; i++) {
      if (i === 0 && j === 0) {
        children.push(deepCloneGeo(inputGeo));
        continue;
      }
      const dx = offset_x * i + dir2_offset_x * j;
      const dy = offset_y * i + dir2_offset_y * j;
      // Scale grows progressively across the whole grid so it reads naturally
      // in both directions.
      const scaleFactor = 1 + scale_step * (i + j);
      const copy = applyTransformToGeo(deepCloneGeo(inputGeo), (path) => {
        path.translate(new paper.Point(dx, dy));
        if (scaleFactor > 0.01) {
          path.scale(scaleFactor);
        }
      });
      children.push(copy);
    }
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
