import paper from 'paper';
import { geoToPaperPath } from '../utils/geoPathUtils';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

function extractPoints(pathData) {
  const points = [];
  const commands = pathData.match(/[MLHVCSQTAZmlhvcsqtaz][^MLHVCSQTAZmlhvcsqtaz]*/g);
  if (!commands) return points;

  let cx = 0, cy = 0;
  for (const cmd of commands) {
    const type = cmd[0];
    const nums = cmd.slice(1).trim().match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/gi);
    const vals = nums ? nums.map(Number) : [];

    switch (type) {
      case 'M':
        for (let i = 0; i < vals.length; i += 2) {
          cx = vals[i]; cy = vals[i + 1];
          points.push({ x: cx, y: cy });
        }
        break;
      case 'm':
        for (let i = 0; i < vals.length; i += 2) {
          cx += vals[i]; cy += vals[i + 1];
          points.push({ x: cx, y: cy });
        }
        break;
      case 'L':
        for (let i = 0; i < vals.length; i += 2) {
          cx = vals[i]; cy = vals[i + 1];
          points.push({ x: cx, y: cy });
        }
        break;
      case 'l':
        for (let i = 0; i < vals.length; i += 2) {
          cx += vals[i]; cy += vals[i + 1];
          points.push({ x: cx, y: cy });
        }
        break;
      case 'H':
        for (const v of vals) { cx = v; points.push({ x: cx, y: cy }); }
        break;
      case 'h':
        for (const v of vals) { cx += v; points.push({ x: cx, y: cy }); }
        break;
      case 'V':
        for (const v of vals) { cy = v; points.push({ x: cx, y: cy }); }
        break;
      case 'v':
        for (const v of vals) { cy += v; points.push({ x: cx, y: cy }); }
        break;
      case 'C':
        for (let i = 0; i < vals.length; i += 6) {
          cx = vals[i + 4]; cy = vals[i + 5];
          points.push({ x: cx, y: cy });
        }
        break;
      case 'c':
        for (let i = 0; i < vals.length; i += 6) {
          cx += vals[i + 4]; cy += vals[i + 5];
          points.push({ x: cx, y: cy });
        }
        break;
      case 'S':
      case 'Q':
        for (let i = 0; i < vals.length; i += 4) {
          cx = vals[i + 2]; cy = vals[i + 3];
          points.push({ x: cx, y: cy });
        }
        break;
      case 's':
      case 'q':
        for (let i = 0; i < vals.length; i += 4) {
          cx += vals[i + 2]; cy += vals[i + 3];
          points.push({ x: cx, y: cy });
        }
        break;
      case 'A':
        for (let i = 0; i < vals.length; i += 7) {
          cx = vals[i + 5]; cy = vals[i + 6];
          points.push({ x: cx, y: cy });
        }
        break;
      case 'a':
        for (let i = 0; i < vals.length; i += 7) {
          cx += vals[i + 5]; cy += vals[i + 6];
          points.push({ x: cx, y: cy });
        }
        break;
      case 'Z':
      case 'z':
        break;
    }
  }
  return points;
}

function removeDuplicatePoints(pts, epsilon = 0.5) {
  if (pts.length < 2) return pts;
  const result = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - result[result.length - 1].x;
    const dy = pts[i].y - result[result.length - 1].y;
    if (Math.sqrt(dx * dx + dy * dy) > epsilon) {
      result.push(pts[i]);
    }
  }
  return result;
}

export function convertRuntime(params, inputs) {
  const { close_path = false } = params;
  const inputGeo = inputs.geometry_in;

  if (!inputGeo) return null;

  ensurePaper();

  let pathData = null;
  if (inputGeo.type === 'booleanResult' && inputGeo.pathData) {
    pathData = inputGeo.pathData;
  } else {
    const paperPath = geoToPaperPath(inputGeo);
    if (!paperPath) return inputGeo;
    pathData = paperPath.pathData;
    paperPath.remove();
  }

  if (!pathData) return inputGeo;

  let pts = extractPoints(pathData);
  pts = removeDuplicatePoints(pts);

  if (pts.length < 2) return inputGeo;

  const first = pts[0];
  const last = pts[pts.length - 1];
  const dx = first.x - last.x;
  const dy = first.y - last.y;
  const isClosed = close_path || Math.sqrt(dx * dx + dy * dy) < 1;

  if (isClosed && pts.length > 2) {
    const ldx = pts[pts.length - 1].x - pts[0].x;
    const ldy = pts[pts.length - 1].y - pts[0].y;
    if (Math.sqrt(ldx * ldx + ldy * ldy) < 1) {
      pts.pop();
    }
  }

  const path = new paper.Path();
  for (const pt of pts) {
    path.add(new paper.Point(pt.x, pt.y));
  }
  if (isClosed) path.closePath();

  const outPathData = path.pathData;
  const bounds = path.bounds;
  path.remove();

  return {
    type: 'booleanResult',
    pathData: outPathData,
    fill: inputGeo.fill || 'none',
    stroke: inputGeo.stroke || '#000000',
    strokeWidth: inputGeo.strokeWidth ?? 1,
    opacity: inputGeo.opacity,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}
