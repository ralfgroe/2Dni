import paper from 'paper';
import { geoToPaperPath } from '../utils/geoPathUtils';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

// Returns the selectable "parts" of an input geometry as a stable, indexed
// list. Each part is a renderable geometry object plus its index. For a group
// (e.g. a traced image), each top-level child is one part. For a single
// compound path, its disconnected subpaths become parts so the node is still
// useful on non-group inputs. Anything else is treated as a single part.
export function extractParts(geo) {
  if (!geo) return [];

  if (geo.type === 'group' || geo.type === 'boolean') {
    const children = geo.children || [];
    return children.map((child, idx) => ({ idx, geo: child }));
  }

  if (geo.type === 'booleanResult' && geo.pathData) {
    ensurePaper();
    try {
      const compound = new paper.CompoundPath(geo.pathData);
      const kids = compound.children || [];
      if (kids.length > 1) {
        const parts = kids.map((child, idx) => {
          const pathData = child.pathData;
          const b = child.bounds;
          return {
            idx,
            geo: {
              type: 'booleanResult',
              pathData,
              fill: geo.fill || '#000000',
              stroke: geo.stroke || 'none',
              strokeWidth: geo.strokeWidth ?? 0,
              strokeLinecap: geo.strokeLinecap,
              strokeDasharray: geo.strokeDasharray,
              opacity: geo.opacity,
              bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
            },
          };
        });
        compound.remove();
        return parts;
      }
      compound.remove();
    } catch {
      // fall through to single-part
    }
  }

  return [{ idx: 0, geo }];
}

function parseJSON(str, fallback) {
  try {
    const v = JSON.parse(str);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

// Applies an [dx, dy] translation offset to a part geometry, returning a new
// geometry object. Uses paper.js for path-based parts so the moved geometry is
// real (not just a render transform).
function offsetGeo(geo, dx, dy) {
  if (!dx && !dy) return geo;
  if (!geo) return geo;

  ensurePaper();
  const path = geoToPaperPath(geo);
  if (!path) {
    // Fallback: shift simple primitives by their coordinate fields.
    const g = { ...geo };
    if (g.bounds) g.bounds = { ...g.bounds, x: g.bounds.x + dx, y: g.bounds.y + dy };
    if (typeof g.x === 'number') g.x += dx;
    if (typeof g.y === 'number') g.y += dy;
    if (typeof g.cx === 'number') g.cx += dx;
    if (typeof g.cy === 'number') g.cy += dy;
    return g;
  }

  path.translate(new paper.Point(dx, dy));
  const pathData = path.pathData;
  const b = path.bounds;
  path.remove();

  return {
    type: 'booleanResult',
    pathData,
    fill: geo.fill ?? '#000000',
    stroke: geo.stroke ?? 'none',
    strokeWidth: geo.strokeWidth ?? 0,
    strokeLinecap: geo.strokeLinecap,
    strokeDasharray: geo.strokeDasharray,
    opacity: geo.opacity,
    bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
  };
}

export function selectRuntime(params, inputs) {
  const geo = inputs?.geometry_in;
  if (!geo) return null;

  const parts = extractParts(geo);
  if (parts.length === 0) return geo;

  const selected = new Set(parseJSON(params.selected || '[]', []));
  const offsets = parseJSON(params.offsets || '{}', {});
  const mode = params.mode || 'Delete Selected';

  const kept = [];
  for (const part of parts) {
    const isSelected = selected.has(part.idx);

    if (mode === 'Keep Only Selected') {
      if (!isSelected) continue;
    } else {
      // Delete Selected
      if (isSelected) continue;
    }

    const off = offsets[String(part.idx)];
    const dx = off ? off[0] : 0;
    const dy = off ? off[1] : 0;
    kept.push(offsetGeo(part.geo, dx, dy));
  }

  if (kept.length === 0) {
    return { type: 'group', children: [], bounds: { x: 0, y: 0, width: 0, height: 0 } };
  }

  const bs = kept.map((c) => c.bounds).filter(Boolean);
  const minX = bs.length ? Math.min(...bs.map((b) => b.x)) : 0;
  const minY = bs.length ? Math.min(...bs.map((b) => b.y)) : 0;
  const maxX = bs.length ? Math.max(...bs.map((b) => b.x + b.width)) : 0;
  const maxY = bs.length ? Math.max(...bs.map((b) => b.y + b.height)) : 0;

  return {
    type: 'group',
    children: kept,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}
