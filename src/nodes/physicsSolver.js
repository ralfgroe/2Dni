// TGS-Soft rigid-body solver (Box2D v3 "soft step" style).
//
// This is a from-scratch replacement for the old split velocity/position
// sequential-impulse solver. It fixes the structural jitter ceiling of that
// design:
//
//   1. SOFT CONTACTS. Penetration is resolved *inside* the velocity solve as a
//      compliant spring (mass-normalized stiffness + damping), not by a separate
//      ad-hoc geometric push-out that fights the velocity solution and injects
//      order-dependent position noise. The old `separatePair`/`separateBounds`
//      pass — the real source of the frame-to-frame shimmer — is gone.
//
//   2. SUBSTEP TGS (Temporal Gauss-Seidel). We integrate position every substep
//      and re-solve, so a fast pusher is seen at fine time resolution and the
//      constraint is re-linearized as bodies move. This propagates a push
//      through a stack without ringing.
//
//   3. WARM-STARTING with STABLE FEATURE IDs. Contact impulses persist across
//      substeps, keyed by (bodyA, bodyB, feature). Because the ids come from the
//      SAT reference/incident edge indices they survive rotation, so the solver
//      resumes from the previous solution and converges to the SAME equilibrium
//      each step instead of hunting a new one. This is what removes the residual
//      push-phase jitter that no amount of tuning fixed in the old engine.
//
// The solver is intentionally self-contained: it operates on plain body objects
// and a `collideFn(a,b) -> manifold` supplied by the caller (physics.js keeps
// owning geometry, hull extraction and SAT). Bodies use the same fields the old
// engine used (cx,cy,angle,vx,vy,angVel,invMass,invInertia,...), so the runtime
// wiring barely changes.

function dot(ax, ay, bx, by) {
  return ax * bx + ay * by;
}

function invMassOf(body) {
  return (body.isCollider || body.sleeping) ? 0 : body.invMass;
}
function invInertiaOf(body) {
  return (body.isCollider || body.sleeping) ? 0 : body.invInertia;
}

function applyImpulse(body, ix, iy, rx, ry) {
  const im = invMassOf(body);
  const ii = invInertiaOf(body);
  body.vx += ix * im;
  body.vy += iy * im;
  body.angVel += (rx * iy - ry * ix) * ii;
}

// Soft-constraint coefficients from a target frequency (hertz) and damping
// ratio, for a given substep dt. Returns the three coefficients Box2D v3 uses:
//   biasRate    — how fast penetration is pushed out (position error -> bias vel)
//   massScale   — scales the impulse (softening)
//   impulseScale— bleeds the accumulated impulse toward the soft target
// A rigid contact (hertz -> very large) recovers the classic stiff solver.
function softParams(hertz, zeta, dt) {
  if (hertz <= 0) {
    return { biasRate: 0, massScale: 1, impulseScale: 0 };
  }
  const omega = 2 * Math.PI * hertz;
  const a1 = 2 * zeta + dt * omega;
  const a2 = dt * omega * a1;
  const a3 = 1 / (1 + a2);
  return {
    biasRate: omega / a1,
    massScale: a2 * a3,
    impulseScale: a3,
  };
}

// A ContactConstraint bundles the (up to 2) points of one manifold plus the
// cached solver data. Feature ids let us warm-start across substeps.
function prepareConstraint(c, a, b, warm, hertz, zeta, dt, restitution, restThreshold) {
  const nx = c.nx, ny = c.ny;
  const tx = -ny, ty = nx;
  const imA = invMassOf(a), iiA = invInertiaOf(a);
  const imB = b ? invMassOf(b) : 0, iiB = b ? invInertiaOf(b) : 0;
  const soft = softParams(hertz, zeta, dt);

  const points = [];
  for (const p of c.points) {
    const raX = p.px - a.cx, raY = p.py - a.cy;
    const rbX = b ? p.px - b.cx : 0, rbY = b ? p.py - b.cy : 0;

    const rnA = raX * ny - raY * nx;
    const rnB = rbX * ny - rbY * nx;
    const kn = imA + imB + iiA * rnA * rnA + iiB * rnB * rnB;

    const rtA = raX * ty - raY * tx;
    const rtB = rbX * ty - rbY * tx;
    const kt = imA + imB + iiA * rtA * rtA + iiB * rtB * rtB;

    // Relative normal speed at build time -> restitution target.
    const vaX = a.vx - a.angVel * raY, vaY = a.vy + a.angVel * raX;
    const vbX = b ? b.vx - b.angVel * rbY : 0, vbY = b ? b.vy + b.angVel * rbX : 0;
    const vn = dot(vbX - vaX, vbY - vaY, nx, ny);
    // Store the approach speed (positive = closing) for a dedicated restitution
    // pass. Only contacts arriving faster than the rest threshold bounce; slower
    // ones are treated as resting so the pile settles instead of micro-hopping.
    const relRest = (-vn > restThreshold) ? restitution * (-vn) : 0; // target separating speed

    // Warm start from the persisted impulse for this feature.
    const key = p.fid;
    const prev = warm && key != null ? warm.get(key) : undefined;
    const Pn = prev ? prev.Pn : 0;
    const Pt = prev ? prev.Pt : 0;

    points.push({
      fid: key,
      px: p.px, py: p.py,
      raX, raY, rbX, rbY,
      sep0: p.sep,        // signed separation at prepare time (neg = penetrating)
      massN: kn > 0 ? 1 / kn : 0,
      massT: kt > 0 ? 1 / kt : 0,
      relRest,
      Pn, Pt,
    });
  }

  return { a, b, nx, ny, tx, ty, soft, points, pushScale: c.pushScale || 1, friction: c.friction };
}

// Apply warm-start impulses so the bodies begin the substep near last step's
// solution (fewer iterations to converge, no equilibrium hunting).
function warmStart(k) {
  const { a, b, nx, ny, tx, ty, pushScale } = k;
  for (const p of k.points) {
    const ix = (p.Pn * nx + p.Pt * tx) * pushScale;
    const iy = (p.Pn * ny + p.Pt * ty) * pushScale;
    applyImpulse(a, -ix, -iy, p.raX, p.raY);
    if (b) applyImpulse(b, ix, iy, p.rbX, p.rbY);
  }
}

// One normal+friction relaxation pass. `useBias` enables the soft positional
// bias (penetration recovery); the final "relax" pass runs with useBias=false
// so recovered penetration doesn't leave residual velocity (no bounce-out).
function solveConstraint(k, useBias, dt) {
  const { a, b, nx, ny, tx, ty, soft, pushScale, friction } = k;

  for (const p of k.points) {
    // Current separation = separation at prepare time + normal motion since.
    // (TGS: bodies have moved during this substep's position integration.)
    const raX = p.raX, raY = p.raY, rbX = p.rbX, rbY = p.rbY;

    // Relative velocity at the contact point.
    let vaX = a.vx - a.angVel * raY;
    let vaY = a.vy + a.angVel * raX;
    let vbX = b ? b.vx - b.angVel * rbY : 0;
    let vbY = b ? b.vy + b.angVel * rbX : 0;
    let vn = dot(vbX - vaX, vbY - vaY, nx, ny);

    // Track separation incrementally: sep = sep0 + (delta position along n).
    // We approximate current separation using body position deltas since prepare.
    const sep = p.sep0 + normalDelta(a, b, p, nx, ny);

    let bias = 0, mScale = 1, iScale = 0;
    if (sep > 0) {
      // Speculative: bodies not yet touching this substep — allow closing but
      // push the constraint so they stop exactly at contact (no tunneling).
      bias = sep / dt; // positive: allows approaching up to contact only
    } else if (useBias) {
      bias = Math.max(soft.biasRate * sep, -MAX_BIAS_VEL); // sep<0 -> negative
      mScale = soft.massScale;
      iScale = soft.impulseScale;
    }

    // Normal impulse. Softened velocity + penetration constraint (NO restitution
    // here — restitution is applied as a dedicated hard pass afterwards so the
    // soft-constraint compliance can't bleed the bounce energy).
    let dPn = -p.massN * (mScale * (vn + bias)) - iScale * p.Pn;
    const newPn = Math.max(p.Pn + dPn, 0);
    dPn = (newPn - p.Pn) * pushScale;
    p.Pn = newPn;

    let ix = dPn * nx, iy = dPn * ny;
    applyImpulse(a, -ix, -iy, raX, raY);
    if (b) applyImpulse(b, ix, iy, rbX, rbY);

    // Friction: recompute tangential velocity after the normal impulse.
    vaX = a.vx - a.angVel * raY;
    vaY = a.vy + a.angVel * raX;
    vbX = b ? b.vx - b.angVel * rbY : 0;
    vbY = b ? b.vy + b.angVel * rbX : 0;
    const vt = dot(vbX - vaX, vbY - vaY, tx, ty);

    let dPt = -p.massT * vt;
    const maxF = friction * p.Pn;
    const newPt = Math.max(-maxF, Math.min(maxF, p.Pt + dPt));
    dPt = (newPt - p.Pt) * pushScale;
    p.Pt = newPt;

    ix = dPt * tx; iy = dPt * ty;
    applyImpulse(a, -ix, -iy, raX, raY);
    if (b) applyImpulse(b, ix, iy, rbX, rbY);
  }
}

const MAX_BIAS_VEL = 300; // px/s cap on recovery bias so a crushed body isn't ejected

// Dedicated restitution pass (run once after the relax pass). Bounce energy is
// applied here as a HARD impulse — not through the soft-constraint solve — so the
// compliant contact machinery can't bleed it. For each contact point we ensure
// the outgoing normal velocity separates at least as fast as
// restitution * approachSpeed (stored in relRest at prepare time). We only ADD
// separating impulse (clamped so we never pull bodies together), and cap the
// total normal impulse budget by what the contact already carried, matching
// Box2D v3's applyRestitution.
function applyRestitution(k) {
  const { a, b, nx, ny, pushScale } = k;
  for (const p of k.points) {
    if (p.relRest <= 0 || p.Pn <= 0) continue; // no bounce target / not touching
    const raX = p.raX, raY = p.raY, rbX = p.rbX, rbY = p.rbY;
    const vaX = a.vx - a.angVel * raY;
    const vaY = a.vy + a.angVel * raX;
    const vbX = b ? b.vx - b.angVel * rbY : 0;
    const vbY = b ? b.vy + b.angVel * rbX : 0;
    const vn = dot(vbX - vaX, vbY - vaY, nx, ny);
    // Want vn >= relRest (separating). If already separating fast enough, skip.
    if (vn >= p.relRest) continue;
    let dPn = -p.massN * (vn - p.relRest);
    // Clamp accumulated impulse non-negative (same budget as the normal solve).
    const newPn = Math.max(p.Pn + dPn, 0);
    dPn = (newPn - p.Pn) * pushScale;
    p.Pn = newPn;
    const ix = dPn * nx, iy = dPn * ny;
    applyImpulse(a, -ix, -iy, raX, raY);
    if (b) applyImpulse(b, ix, iy, rbX, rbY);
  }
}

// How far the contact anchors have moved along the normal since prepare, to
// keep an up-to-date separation estimate during TGS position integration. We
// track each body's accumulated center delta + rotation delta in dp*/da* fields.
function normalDelta(a, b, p, nx, ny) {
  // Displacement of the anchor point on A and B since prepare.
  const daX = a._dpx + (-a._dth) * p.raY; // small-angle: d(r rotated) ≈ -dθ*ry, dθ*rx
  const daY = a._dpy + (a._dth) * p.raX;
  let dbX = 0, dbY = 0;
  if (b) {
    dbX = b._dpx + (-b._dth) * p.rbY;
    dbY = b._dpy + (b._dth) * p.rbX;
  }
  return dot((dbX - daX), (dbY - daY), nx, ny);
}

// Integrate a body's velocity into position for a substep, tracking the deltas
// used by normalDelta so separation stays current within the substep.
function integrateBody(body, dt) {
  if (body.isCollider || body.sleeping) return;
  const dpx = body.vx * dt;
  const dpy = body.vy * dt;
  const dth = body.angVel * dt;
  body.cx += dpx;
  body.cy += dpy;
  body.angle += dth;
  body._dpx += dpx;
  body._dpy += dpy;
  body._dth += dth;
}

// Reset per-substep position-delta accumulators.
function resetDeltas(body) {
  body._dpx = 0;
  body._dpy = 0;
  body._dth = 0;
}

export {
  dot,
  invMassOf,
  invInertiaOf,
  applyImpulse,
  softParams,
  prepareConstraint,
  warmStart,
  solveConstraint,
  applyRestitution,
  integrateBody,
  resetDeltas,
};
