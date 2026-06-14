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

export function splitselectRuntime(params, inputs) {
  const geo = inputs?.geometry_in;
  if (!geo) {
    return { __multiOutput: true, geo_out_unselected: null, geo_out_selected: null };
  }

  const parts = extractParts(geo);
  const selected = new Set(parseJSON(params.selected || '[]', []));

  const rest = [];
  const picked = [];
  for (const part of parts) {
    if (selected.has(part.idx)) picked.push(part.geo);
    else rest.push(part.geo);
  }

  return {
    __multiOutput: true,
    geo_out_unselected: groupFrom(rest),
    geo_out_selected: groupFrom(picked),
  };
}
