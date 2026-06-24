// Furniture node: place standard-sized furniture symbols into the drawing.
//
// items_data is a JSON array of placed items, each { id, type, x, y, rot,
// scale } where (x,y) is the WORLD-unit center, rot is degrees, scale a user
// multiplier (default 1). Symbols are authored in meters and scaled by
// world_per_meter so they match the Floorplan node's real-world sizing.
//
// Any connected geometry_in is passed through underneath the furniture so a
// Furniture node can sit on top of a Floorplan in the same network.

import { resolveFurniture } from '../utils/furnitureSymbols';

function parseItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function furnitureRuntime(params, inputs) {
  const {
    items_data = '[]',
    line_color = '#333333',
    line_width = 1.5,
    fill_color = '#ffffff',
    filled = true,
    world_per_meter = 100,
  } = params || {};

  const passthrough = inputs?.geometry_in ?? null;
  const items = parseItems(items_data);

  const children = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const accumulate = (b) => {
    if (!b) return;
    minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
  };

  if (passthrough) {
    children.push(passthrough);
    accumulate(passthrough.bounds);
  }

  const sw = Math.max(0.1, Number(line_width) || 1.5);
  for (const item of items) {
    const r = resolveFurniture(item, world_per_meter);
    if (!r) continue;
    accumulate(r.bounds);
    for (const stroke of r.strokes) {
      children.push({
        type: 'booleanResult',
        pathData: stroke.d,
        fill: stroke.fill && filled ? fill_color : 'none',
        fillRule: 'nonzero',
        stroke: line_color,
        strokeWidth: sw,
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
        bounds: r.bounds,
      });
    }
  }

  if (children.length === 0) return passthrough ?? null;
  if (children.length === 1 && !passthrough) return children[0];

  return {
    type: 'group',
    children,
    bounds: isFinite(minX)
      ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
      : { x: 0, y: 0, width: 0, height: 0 },
  };
}
