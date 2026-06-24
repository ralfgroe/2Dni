import paper from 'paper';
import { ensurePaper as __ensureMainPaper } from '../utils/geoPathUtils';

function ensurePaper() {
  __ensureMainPaper();
}

const PRESETS = {
  'Classic':      { outer_radius: 120, inner_radius: 75,  pen_offset: 50 },
  'Astroid':      { outer_radius: 120, inner_radius: 30,  pen_offset: 30 },
  'Deltoid':      { outer_radius: 120, inner_radius: 40,  pen_offset: 40 },
  'Rose 5-petal': { outer_radius: 120, inner_radius: 48,  pen_offset: 48 },
  'Rose 8-petal': { outer_radius: 120, inner_radius: 45,  pen_offset: 45 },
  'Tight Loops':  { outer_radius: 120, inner_radius: 100, pen_offset: 80 },
};

function gcd(a, b) { a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b)); while (b) { [a, b] = [b, a % b]; } return a; }

export function spirographRuntime(params) {
  ensurePaper();

  const R = params.outer_radius ?? 120;
  const r = params.inner_radius ?? 75;
  const d = params.pen_offset ?? 50;
  const mode = params.mode ?? 'Hypotrochoid';
  const revolutions = params.revolutions ?? 10;
  const cx = params.x ?? 0;
  const cy = params.y ?? 0;
  const strokeColor = params.stroke_color ?? '#000000';
  const strokeWidth = params.stroke_width ?? 1;

  const lobes = r / gcd(R, r);
  const fullRevs = Math.min(revolutions, lobes > 0 ? lobes : revolutions);
  const totalAngle = fullRevs * 2 * Math.PI;
  const steps = Math.max(500, Math.round(fullRevs * 200));

  const path = new paper.Path();
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * totalAngle;
    let x, y;
    if (mode === 'Epitrochoid') {
      x = (R + r) * Math.cos(t) - d * Math.cos(((R + r) / r) * t);
      y = (R + r) * Math.sin(t) - d * Math.sin(((R + r) / r) * t);
    } else {
      x = (R - r) * Math.cos(t) + d * Math.cos(((R - r) / r) * t);
      y = (R - r) * Math.sin(t) - d * Math.sin(((R - r) / r) * t);
    }
    path.add(new paper.Point(cx + x, cy + y));
  }

  // The sampled points trace a mathematically smooth curve, so fit a
  // continuous Catmull-Rom spline through them to remove the faceting.
  const closesOnItself =
    path.firstSegment &&
    path.lastSegment &&
    path.firstSegment.point.getDistance(path.lastSegment.point) < 0.5;
  if (closesOnItself) {
    path.lastSegment.remove();
    path.closed = true;
  }
  path.smooth({ type: 'catmull-rom', factor: 0.5 });

  const pathData = path.pathData;
  const bounds = path.bounds;
  path.remove();

  return {
    type: 'booleanResult',
    pathData,
    fill: 'none',
    stroke: strokeColor,
    strokeWidth,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}
