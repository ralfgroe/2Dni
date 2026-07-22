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

// Least-squares circle fit (Kåsa method) to a set of points. Returns the fitted
// centre {x, y} and radius, or null if the points are (near-)collinear / too few
// — in which case there's no meaningful arc/pivot to spring about. Used for the
// Auto Torsion mode where the pivot is inferred from the arc the piece travels.
function fitCircle(pts) {
  const clean = pts.filter(Boolean);
  const n = clean.length;
  if (n < 3) return null;
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
  for (const p of clean) {
    const z = p.x * p.x + p.y * p.y;
    sx += p.x; sy += p.y;
    sxx += p.x * p.x; syy += p.y * p.y; sxy += p.x * p.y;
    sxz += p.x * z; syz += p.y * z; sz += z;
  }
  // Solve the normal equations for a*x + b*y + c = z where centre = (a/2, b/2).
  const A = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const B = [sxz, syz, sz];
  const det =
    A[0][0] * (A[1][1] * A[2][2] - A[1][2] * A[2][1]) -
    A[0][1] * (A[1][0] * A[2][2] - A[1][2] * A[2][0]) +
    A[0][2] * (A[1][0] * A[2][1] - A[1][1] * A[2][0]);
  if (Math.abs(det) < 1e-6) return null;
  const inv = (i, j) => {
    // Cramer's rule per component.
    const M = A.map((row) => row.slice());
    for (let r = 0; r < 3; r++) M[r][i] = B[r];
    const d =
      M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
      M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
      M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    return d / det;
  };
  const a = inv(0);
  const b = inv(1);
  const cx = a / 2, cy = b / 2;
  if (!isFinite(cx) || !isFinite(cy)) return null;
  return { x: cx, y: cy };
}

// Unwrap an angle sequence so it stays continuous (no ±2π jumps), enabling a
// spring to integrate through multiple turns smoothly.
function unwrapAngles(raw) {
  const out = new Array(raw.length);
  let prev = raw[0] ?? 0;
  let acc = prev;
  out[0] = acc;
  for (let i = 1; i < raw.length; i++) {
    let a = raw[i];
    if (a == null) { out[i] = acc; continue; }
    let d = a - prev;
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    acc += d;
    out[i] = acc;
    prev = a;
  }
  return out;
}

// Rotate a geometry (recursively) by rotDeg about pivot (cx, cy).
function rotateGeoAbout(geo, rotDeg, cx, cy) {
  return translateGeo(geo, 0, 0, rotDeg, cx, cy);
}

export function springRuntime(params, inputs, context) {
  const geo = inputs?.geometry_in;
  if (!geo) return null;

  const mode = params.mode || 'Linear';
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

  // Resolve each track frame's centre once.
  const centers = track.map((g) => geoCenter(g));
  const curCenter = geoCenter(geo) || centers[Math.min(frame, centers.length - 1)];
  if (!curCenter) return geo;

  const dt = 1 / (fps * substeps);
  const N = Math.min(frame, centers.length - 1);

  // ---- TORSION: spring the ANGLE about a pivot (a real torsion spring). ------
  if (mode === 'Torsion' || mode === 'Auto Torsion') {
    // Resolve the pivot. Auto mode fits the arc the centre travels; explicit
    // mode uses the user pivot. If the auto-fit fails (piece barely rotates /
    // moves in a straight line) fall back to the explicit pivot.
    let pivot = null;
    if (mode === 'Auto Torsion') {
      pivot = fitCircle(centers.slice(0, N + 1));
    }
    if (!pivot) pivot = { x: params.pivot_x ?? 0, y: params.pivot_y ?? 0 };

    // Angle of each frame's centre about the pivot, unwrapped for continuity.
    const rawAng = centers.map((cp) =>
      cp ? Math.atan2(cp.y - pivot.y, cp.x - pivot.x) : null
    );
    const ang = unwrapAngles(rawAng);

    // Integrate the damped torsion spring on the angle from frame 0 -> N.
    let theta = ang[0] ?? 0;
    let omega = 0;
    for (let f = 1; f <= N; f++) {
      const target = ang[f];
      for (let s = 0; s < substeps; s++) {
        const r = stepSpring(theta, omega, target, k, c, m, dt);
        theta = r.pos; omega = r.vel;
      }
    }

    // Overshoot = how far the springy angle sits past the true angle now.
    const thetaNow = ang[N] ?? theta;
    const extraRad = (theta - thetaNow) * amount;
    const extraDeg = (extraRad * 180) / Math.PI;
    if (Math.abs(extraDeg) < 1e-4) return geo;
    return rotateGeoAbout(geo, extraDeg, pivot.x, pivot.y);
  }

  // ---- LINEAR: spring the POSITION (original behaviour). ---------------------
  const targets = centers;
  const t0 = targets[0] || curCenter;
  let px = t0.x, py = t0.y, vx = 0, vy = 0;

  for (let f = 1; f <= N; f++) {
    const tgt = targets[f] || t0;
    for (let s = 0; s < substeps; s++) {
      if (affectX) { const r = stepSpring(px, vx, tgt.x, k, c, m, dt); px = r.pos; vx = r.vel; }
      if (affectY) { const r = stepSpring(py, vy, tgt.y, k, c, m, dt); py = r.pos; vy = r.vel; }
    }
  }

  const tgtNow = targets[N] || curCenter;
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
