import paper from 'paper';
import { ensurePaper as __ensureMainPaper, geoToPaperPath } from '../utils/geoPathUtils';

function ensurePaper() {
  __ensureMainPaper();
}

// Centroid (bounding-box center) of a geometry value in world space. This is the
// "target" position the spring chases. Returns null if it can't be measured.
function geoCenter(geo) {
  if (!geo) return null;
  const p = geoToPaperPath(geo);
  if (!p) {
    // Groups/compound: fall back to reported bounds if present.
    if (geo.bounds && isFinite(geo.bounds.width)) {
      return { x: geo.bounds.x + geo.bounds.width / 2, y: geo.bounds.y + geo.bounds.height / 2 };
    }
    return null;
  }
  const b = p.bounds;
  p.remove();
  if (!isFinite(b.width) || !isFinite(b.height)) return null;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

// Integrate one damped mass-spring step for a single 1-D channel.
//   force = k*(target - pos) - c*vel ; accel = force/m
// Semi-implicit Euler (update velocity first, then position) is stable and is
// what game/physics springs use. `dt` is the per-substep timestep.
function stepSpring(pos, vel, target, k, c, m, dt) {
  const accel = (k * (target - pos) - c * vel) / m;
  const nv = vel + accel * dt;
  const np = pos + nv * dt;
  return { pos: np, vel: nv };
}

// Translate a geometry (recursively) by (dx, dy). Reuses Paper for real paths so
// arcs/curves survive; primitives (line) are shifted by their coordinates.
function translateGeo(geo, dx, dy, rotDeg, cx, cy) {
  if (!geo) return null;
  const noMove = Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6 && Math.abs(rotDeg) < 1e-4;
  if (noMove) return geo;

  if ((geo.type === 'group' || geo.type === 'boolean') && Array.isArray(geo.children)) {
    const children = geo.children.map((c) => translateGeo(c, dx, dy, rotDeg, cx, cy)).filter(Boolean);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of children) {
      if (c && c.bounds) {
        minX = Math.min(minX, c.bounds.x);
        minY = Math.min(minY, c.bounds.y);
        maxX = Math.max(maxX, c.bounds.x + c.bounds.width);
        maxY = Math.max(maxY, c.bounds.y + c.bounds.height);
      }
    }
    return {
      ...geo, children,
      bounds: {
        x: isFinite(minX) ? minX : 0, y: isFinite(minY) ? minY : 0,
        width: isFinite(maxX - minX) ? maxX - minX : 0,
        height: isFinite(maxY - minY) ? maxY - minY : 0,
      },
    };
  }

  if (geo.type === 'line') {
    return {
      ...geo,
      x1: geo.x1 + dx, y1: geo.y1 + dy,
      x2: geo.x2 + dx, y2: geo.y2 + dy,
      bounds: geo.bounds
        ? { ...geo.bounds, x: geo.bounds.x + dx, y: geo.bounds.y + dy }
        : geo.bounds,
    };
  }

  ensurePaper();
  const path = geoToPaperPath(geo);
  if (!path) return geo;
  if (Math.abs(rotDeg) > 1e-4) path.rotate(rotDeg, new paper.Point(cx, cy));
  if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6) path.translate(new paper.Point(dx, dy));
  const pathData = path.pathData;
  const b = path.bounds;
  path.remove();
  const hasFill = geo.fill && geo.fill !== 'none';
  return {
    type: 'booleanResult',
    pathData,
    fill: hasFill ? geo.fill : 'none',
    stroke: geo.stroke || '#000000',
    strokeWidth: geo.strokeWidth ?? 1,
    strokeLinecap: geo.strokeLinecap,
    strokeDasharray: geo.strokeDasharray,
    opacity: geo.opacity,
    bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
  };
}

export function springRuntime(params, inputs, context) {
  const geo = inputs?.geometry_in;
  if (!geo) return null;

  const k = Math.max(0.01, params.spring_constant ?? 40);
  const m = Math.max(0.01, params.mass ?? 1);
  const c = Math.max(0, params.damping ?? 4);
  const amount = Math.max(0, params.amount ?? 1);
  const affectX = params.affect_x !== false;
  const affectY = params.affect_y !== false;
  const affectRot = params.affect_rotation === true;
  const substeps = Math.max(1, Math.min(32, Math.round(params.substeps ?? 8)));

  const frame = Math.max(0, Math.round(context?.frame ?? 0));
  const fps = context?.fps || 30;

  // No overshoot with zero amount, or when not animating (frame 0) -> pass thru.
  if (amount === 0 || frame === 0) return geo;

  // Per-frame track of the INPUT's animated centre, pre-sampled by the graph
  // evaluator (index = integer frame). Without it we can't run the frame-by-
  // frame spring (the graph is otherwise a pure per-frame function), so the
  // node passes the geometry straight through.
  const track = context?.springTrackInput;
  if (!Array.isArray(track) || track.length === 0) return geo;

  // Resolve each track frame's target centre once.
  const targets = track.map((g) => geoCenter(g));
  // Current (this-frame) centre — the reference we offset from.
  const curCenter = geoCenter(geo) || targets[Math.min(frame, targets.length - 1)];
  if (!curCenter) return geo;

  // Seed the spring at the frame-0 target so it starts perfectly at rest.
  const t0 = targets[0] || curCenter;
  let px = t0.x, py = t0.y, vx = 0, vy = 0;

  const dt = 1 / (fps * substeps);
  const N = Math.min(frame, targets.length - 1);

  // Integrate from frame 0 up to the current frame. Within each frame we hold
  // the target at that frame's sampled position and take `substeps` sub-steps.
  for (let f = 1; f <= N; f++) {
    const tgt = targets[f] || t0;
    for (let s = 0; s < substeps; s++) {
      if (affectX) { const r = stepSpring(px, vx, tgt.x, k, c, m, dt); px = r.pos; vx = r.vel; }
      if (affectY) { const r = stepSpring(py, vy, tgt.y, k, c, m, dt); py = r.pos; vy = r.vel; }
    }
  }

  const tgtNow = targets[N] || curCenter;
  // Offset = how far the springy mass sits from where the input actually is.
  let dx = affectX ? (px - tgtNow.x) * amount : 0;
  let dy = affectY ? (py - tgtNow.y) * amount : 0;

  // Optional lean: rotate the piece proportional to its lateral spring offset,
  // like a pendulum leaning into its swing. Small-angle, capped, scaled by
  // amount. Purely cosmetic secondary motion.
  let rotDeg = 0;
  if (affectRot) {
    const lean = Math.max(-35, Math.min(35, dx * 0.25));
    rotDeg = lean;
  }

  return translateGeo(geo, dx, dy, rotDeg, curCenter.x, curCenter.y);
}
