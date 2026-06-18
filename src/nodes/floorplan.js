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

const CONFLICT_DIM_COLOR = '#e03131';
const UNDER_COLOR = '#1366d6';
const FULLY_COLOR = '#1a1a1a';

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
    dimensions = '[]',
    wall_style = 'Centerline',
    wall_thickness = 12,
    wall_color = '#333333',
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

  let walls = buildWalls(renderChains, wall_style, sw, wall_color);
  if (!walls) return null;

  // SolidWorks-style status coloring of the walls themselves (blue/black/red).
  if (show_status && dims.length > 0) {
    const statusStroke = status === 'over' ? CONFLICT_DIM_COLOR : status === 'fully' ? FULLY_COLOR : UNDER_COLOR;
    walls = { ...walls, stroke: statusStroke };
    if (wall_style === 'Double-line') walls.fill = statusStroke;
  }

  if (!show_dimensions || dims.length === 0) return walls;

  // Annotations measure/anchor against the solved skeleton. Their value labels
  // are scaled from world units into meters via valueScale = world_per_meter.
  const style = {
    color: dim_color,
    textSize: text_size,
    arrowSize: arrow_size,
    decimals,
    units,
    valueScale: world_per_meter,
  };
  const annotations = [];
  for (const dim of dims) {
    const ann = buildAnnotation(skeleton, dim, style, conflicts.has(dim.id));
    if (ann) annotations.push(ann);
  }

  const children = [walls, ...annotations];
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
