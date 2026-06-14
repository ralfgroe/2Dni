import { extractParts } from './select';

function parseJSON(str, fallback) {
  try {
    const v = JSON.parse(str);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function groupFrom(children) {
  if (children.length === 0) return null;
  const bs = children.map((c) => c.bounds).filter(Boolean);
  const minX = bs.length ? Math.min(...bs.map((b) => b.x)) : 0;
  const minY = bs.length ? Math.min(...bs.map((b) => b.y)) : 0;
  const maxX = bs.length ? Math.max(...bs.map((b) => b.x + b.width)) : 0;
  const maxY = bs.length ? Math.max(...bs.map((b) => b.y + b.height)) : 0;
  return {
    type: 'group',
    children,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}

export function deleteRuntime(params, inputs) {
  const geo = inputs?.geometry_in;
  if (!geo) return null;

  const parts = extractParts(geo);
  const selected = new Set(parseJSON(params.selected || '[]', []));

  const kept = [];
  for (const part of parts) {
    if (!selected.has(part.idx)) kept.push(part.geo);
  }

  // Nothing marked yet: pass the input straight through unchanged.
  if (selected.size === 0) return geo;

  return groupFrom(kept);
}
