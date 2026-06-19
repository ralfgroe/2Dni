// Floorplan node: draws multiple disconnected wall runs as one geometry and
// dimensions them in-node using the CAD constraint solver.
//
// The drawn data is a set of centerline chains (chains_data). Dimensions
// (dimensions param, stored in WORLD units) parametrically drive those chains
// via solveDimensions — we never destructively rewrite chains_data; the solved
// skeleton is what we render. The Wall Style is applied to the SOLVED skeleton:
//   - "Centerline": one multi-subpath booleanResult of thin strokes. This is the
//     dimensionable form — each wall run is a clean 2-endpoint chain.
//   - "Double-line": each wall run is converted into a closed filled band giving
//     the classic architectural double-line wall.
//
// Scale: world_per_meter screen units == 1 meter at 1:1. Dimensions are typed
// and displayed in meters but stored/solved in world units. scale_ratio is a
// cosmetic label only and never rescales geometry.

import {
  parseChains,
  validChains,
  chainsToCenterlinePathData,
  pathDataToChains,
  chainsBounds,
  bandPathForChain,
} from '../utils/floorplanGeo';
import { solveDimensions, buildAnnotation } from './dimension';
import {
  resolveElement,
  cutOpeningsFromChains,
  elementSymbolPaths,
} from '../utils/floorplanElements';

const CONFLICT_DIM_COLOR = '#e03131';
const UNDER_COLOR = '#1366d6';

function parseDims(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function num(n) {
  return Math.round(n * 1000) / 1000;
}

// Coarse bounds from the numeric coordinates in a path string. Good enough for
// the group's overall bbox (arc endpoints bound the quarter-circle reasonably).
function pathDataBounds(d) {
  const nums = (d || '').match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!nums || nums.length < 2) return undefined;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  // Coordinates come in x,y pairs in our generated symbol paths; arc radius
  // params also appear but stay within the endpoint bbox we expand below.
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = parseFloat(nums[i]);
    const y = parseFloat(nums[i + 1]);
    if (!isFinite(x) || !isFinite(y)) continue;
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (!isFinite(minX)) return undefined;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Build the wall geometry (booleanResult) from a set of centerline chains.
function buildWalls(chains, wall_style, sw, wall_color) {
  const { minX, minY, maxX, maxY } = chainsBounds(chains);

  if (wall_style === 'Double-line') {
    const half = sw / 2;
    const runs = [];
    for (const chain of chains) {
      const band = bandPathForChain(chain, half);
      if (band) runs.push(band);
    }
    if (runs.length === 0) return null;
    return {
      type: 'booleanResult',
      pathData: runs.join(' '),
      fill: wall_color,
      fillRule: 'nonzero',
      stroke: wall_color,
      strokeWidth: 1,
      strokeLinejoin: 'miter',
      bounds: {
        x: minX - half,
        y: minY - half,
        width: maxX - minX + sw,
        height: maxY - minY + sw,
      },
    };
  }

  // Centerline (default): thin dimensionable strokes, square ends/corners.
  const runs = [];
  for (const chain of chains) {
    if (chain.length < 2) continue;
    const cmds = [`M${num(chain[0].x)},${num(chain[0].y)}`];
    for (let i = 1; i < chain.length; i++) {
      cmds.push(`L${num(chain[i].x)},${num(chain[i].y)}`);
    }
    runs.push(cmds.join(' '));
  }
  if (runs.length === 0) return null;
  const pad = sw / 2;
  return {
    type: 'booleanResult',
    pathData: runs.join(' '),
    fill: 'none',
    stroke: wall_color,
    strokeWidth: sw,
    strokeLinecap: 'square',
    strokeLinejoin: 'miter',
    bounds: {
      x: minX - pad,
      y: minY - pad,
      width: maxX - minX + sw,
      height: maxY - minY + sw,
    },
  };
}

export function floorplanRuntime(params) {
  const {
    chains_data = '[]',
    elements_data = '[]',
    dimensions = '[]',
    wall_style = 'Centerline',
    wall_thickness = 12,
    wall_color = '#333333',
    element_color = '#333333',
    show_elements = true,
    world_per_meter = 100,
    decimals = 2,
    units = 'm',
    dim_color = UNDER_COLOR,
    text_size = 14,
    arrow_size = 8,
    show_dimensions = true,
    show_status = true,
  } = params;

  const chains = validChains(parseChains(chains_data));
  if (chains.length === 0) return null;

  const sw = Math.max(0.5, wall_thickness);
  const dims = parseDims(dimensions);

  // The dimensionable centerline geometry, fed to the solver.
  const centerlinePath = chainsToCenterlinePathData(chains);
  const { minX, minY, maxX, maxY } = chainsBounds(chains);
  const centerlineGeo = {
    type: 'booleanResult',
    pathData: centerlinePath,
    fill: 'none',
    stroke: wall_color,
    strokeWidth: 1,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };

  // Solve dimensions to drive the walls. The skeleton is the solved (driven)
  // centerline; we rebuild wall chains from it so the rendered walls resize.
  const solved = dims.length > 0 ? solveDimensions(centerlineGeo, dims) : null;
  const skeleton = solved ? solved.skeleton : centerlineGeo;
  const conflicts = solved ? solved.conflicts : new Set();
  const status = solved ? solved.status : 'under';

  const drivenChains = solved
    ? pathDataToChains(skeleton.pathData)
    : chains;
  const renderChains = drivenChains.length > 0 ? validChains(drivenChains) : chains;

  // Resolve wall-hosted elements against the SOLVED chains so they slide/rotate
  // with the wall. Each resolved element carries its host wall index for cutting.
  const elements = parseDims(elements_data);
  const half = sw / 2;
  const resolved = [];
  if (elements.length > 0) {
    for (const el of elements) {
      const r = resolveElement(el, renderChains);
      if (r) {
        r._el = el;
        resolved.push(r);
      }
    }
  }

  // Cut openings out of the walls (gap in the centerline / break the band).
  const wallChains = resolved.length > 0
    ? cutOpeningsFromChains(renderChains, resolved)
    : renderChains;

  let walls = buildWalls(wallChains, wall_style, sw, wall_color);
  if (!walls) return null;

  // Build element symbols (door leaf + swing arc, window glass, opening jambs).
  const elementSymbols = [];
  if (show_elements && resolved.length > 0) {
    for (const r of resolved) {
      const paths = elementSymbolPaths(r._el, r, half);
      for (const p of paths) {
        const geo = {
          type: 'booleanResult',
          pathData: p.d,
          fill: 'none',
          stroke: r.clamped ? CONFLICT_DIM_COLOR : element_color,
          strokeWidth: 1.5,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          bounds: pathDataBounds(p.d),
        };
        if (p.dashed) geo.strokeDasharray = '4 4';
        elementSymbols.push(geo);
      }
    }
  }

  // Walls keep the user's Wall Color. The only status we surface on the walls
  // themselves is a genuine over-constrained conflict (red), which is an error
  // worth flagging; normal under/fully-constrained states keep the wall color
  // (the dimension annotations already convey constraint status).
  if (show_status && dims.length > 0 && status === 'over') {
    walls = { ...walls, stroke: CONFLICT_DIM_COLOR };
    if (wall_style === 'Double-line') walls.fill = CONFLICT_DIM_COLOR;
  }

  // If there are neither dimensions to annotate nor element symbols, the walls
  // alone are the result.
  if ((!show_dimensions || dims.length === 0) && elementSymbols.length === 0) {
    return walls;
  }

  // Annotations measure/anchor against the solved skeleton. Their value labels
  // are scaled from world units into meters via valueScale = world_per_meter.
  const annotations = [];
  if (show_dimensions && dims.length > 0) {
    const style = {
      color: dim_color,
      textSize: text_size,
      arrowSize: arrow_size,
      decimals,
      units,
      valueScale: world_per_meter,
    };
    for (const dim of dims) {
      const ann = buildAnnotation(skeleton, dim, style, conflicts.has(dim.id));
      if (ann) annotations.push(ann);
    }
  }

  const children = [walls, ...elementSymbols, ...annotations];
  let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
  for (const c of children) {
    if (c && c.bounds) {
      bMinX = Math.min(bMinX, c.bounds.x);
      bMinY = Math.min(bMinY, c.bounds.y);
      bMaxX = Math.max(bMaxX, c.bounds.x + c.bounds.width);
      bMaxY = Math.max(bMaxY, c.bounds.y + c.bounds.height);
    }
  }

  return {
    type: 'group',
    children,
    bounds: {
      x: isFinite(bMinX) ? bMinX : 0,
      y: isFinite(bMinY) ? bMinY : 0,
      width: isFinite(bMaxX - bMinX) ? bMaxX - bMinX : 0,
      height: isFinite(bMaxY - bMinY) ? bMaxY - bMinY : 0,
    },
  };
}
