import paper from 'paper';
import { ensurePaper as __ensureMainPaper } from '../utils/geoPathUtils';
import { geoToPaperPath } from '../utils/geoPathUtils';
import {
  prepareConstraint,
  warmStart,
  solveConstraint,
  applyRestitution,
  integrateBody,
  resetDeltas,
} from './physicsSolver';

function ensurePaper() {
  __ensureMainPaper();
}

// --- Contact solver stability tuning -------------------------------------
// We split the solver into a VELOCITY pass (bounce + friction impulses) and a
// POSITION pass (push overlapping bodies apart). Keeping them separate is what
// stops resting stacks from buzzing: the velocity pass never injects energy to
// fix penetration, and the position pass never adds velocity.
//
// Position correction uses a small penetration "slop" (tolerated overlap) so a
// body resting with a hair of penetration isn't nudged every iteration, but
// resolves a large fraction of the *excess* so deep piles actually separate
// instead of sinking and grinding.
// --- TGS-Soft solver tuning ----------------------------------------------
// The solver resolves velocity AND penetration together via compliant (soft)
// constraints, sub-stepped with position integration each step (TGS), and warm-
// started across substeps. There is no separate geometric push-out pass, so the
// order-dependent position noise that caused the old engine's residual jitter is
// gone by construction.
const VELOCITY_ITERATIONS = 4;     // biased solve passes per substep (TGS needs few)
const RELAX_ITERATIONS = 2;        // unbiased relax passes (remove bias velocity)

// Contact softness: a stiff spring. Higher hertz = firmer (less sink), lower =
// softer/springier. Damping ratio ~ critical keeps it from ringing. These are
// clamped against the substep rate inside the solver so they stay stable.
const CONTACT_HERTZ = 30;
const CONTACT_ZETA = 10;           // damping ratio (over-damped -> no bounce-out)

// Contacts whose closing speed is below this are treated as resting: no bounce
// (restitution suppressed) so bodies stop micro-hopping and settle.
const REST_VELOCITY = 25;          // px/s

// Sleep thresholds: a barely-moving resting box that is nearly axis-aligned is
// snapped flat for cosmetic latching. SLEEP_LINEAR is the default the Sleep
// Speed slider uses and the reference used to scale the angular threshold.
const FLAT_SNAP_ANGLE = 0.12;      // rad (~7°) within an axis -> snap flat

// Fraction of residual velocity RETAINED per step by a contacted, near-rest
// body (models internal friction of a packed pile). Bleeds the slow tangential
// "creep" the soft solver leaves so the pile reaches a dead-still sleep in a few
// frames instead of shuffling for a second. Only applied below the settling
// band, so the active push and free motion are untouched.
const REST_RELAX = 0.6;

// Sleep system: touching bodies form an island and sleep together once every
// member has been quiet for SLEEP_TIME, latching the pile into a solid, frozen
// block. A sleeping body wakes only when something fast enough contacts it.
const SLEEP_TIME = 0.3;            // s of continuous quiet before a body sleeps
const SLEEP_LINEAR = 8;            // px/s below which a body counts as quiet
const SLEEP_ANGULAR = 0.15;        // rad/s below which a body counts as quiet
const WAKE_VELOCITY = 30;          // rel. contact speed that wakes a sleeper
// immovable, so it contributes zero — the same math that makes colliders
// one-sided also makes sleepers a solid, non-jittering foundation.
function invMassOf(body) {
  return (body.isCollider || body.sleeping) ? 0 : body.invMass;
}

// Wake a sleeping body: it rejoins the dynamic simulation and must re-earn its
// sleep by staying quiet again.
function wake(body) {
  body.sleeping = false;
  body.quietTime = 0;
}

// Deterministic RNG so a given seed always bakes the same tumble.
function seededRandom(seed) {
  let s = ((seed | 0) + 1) || 1;
  return () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
}

// --- Convex-hull polygon bodies ------------------------------------------
// Irregular shapes (text, polygons, curves, L-shapes) don't fill their
// bounding box, so modelling them as a box makes them "collide" at empty
// bbox corners — producing phantom contacts and endless jitter that never
// sleeps. Instead we sample each shape's real outline, take its convex hull,
// and simulate that polygon: contacts happen on the true surface.

// Sample world-space points along a paper path's outline, flattening curves.
// Handles compound paths (glyphs with holes) by walking every child.
function samplePathPoints(path) {
  const pts = [];
  const pushFrom = (p) => {
    const len = p.length;
    if (!isFinite(len) || len <= 0) {
      // Degenerate (e.g. a single point); use its segments if any.
      if (p.segments) for (const seg of p.segments) pts.push({ x: seg.point.x, y: seg.point.y });
      return;
    }
    // ~2px spacing, capped, so curves are well approximated without huge counts.
    const n = Math.max(8, Math.min(96, Math.ceil(len / 2)));
    for (let i = 0; i < n; i++) {
      const pt = p.getPointAt((i / n) * len);
      if (pt) pts.push({ x: pt.x, y: pt.y });
    }
  };
  if (path.children && path.children.length) {
    for (const child of path.children) pushFrom(child);
  } else {
    pushFrom(path);
  }
  return pts;
}

// Andrew's monotone-chain convex hull. Returns CCW hull points (screen space,
// where +y is down, so "CCW" is just a consistent winding for our math).
function convexHull(points) {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => (a.x - b.x) || (a.y - b.y));
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

// Collapse near-collinear hull vertices. Sampling the outline of a rectangle
// leaves tiny bumps that survive the strict convex-hull test as extra vertices,
// producing 5-6-gons for what is really a 4-gon. Those spurious micro-edges
// break face-face contact detection (SAT picks a tiny edge as the reference
// face) and make thin boxes rock. Merging vertices whose turn is below a small
// angle restores clean polygons so flat rests are detected as true faces.
function simplifyHull(hull) {
  if (hull.length <= 3) return hull;
  const MIN_TURN = 0.08; // rad (~4.6°): flatter than this -> treat as collinear
  const MIN_EDGE = 1.5;  // px: drop vertices that barely advance the outline
  let pts = hull.slice();
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const prev = pts[(i - 1 + pts.length) % pts.length];
      const cur = pts[i];
      const next = pts[(i + 1) % pts.length];
      const ax = cur.x - prev.x, ay = cur.y - prev.y;
      const bx = next.x - cur.x, by = next.y - cur.y;
      const la = Math.hypot(ax, ay), lb = Math.hypot(bx, by);
      if (la < MIN_EDGE) { pts.splice(i, 1); changed = true; break; }
      // Turn angle between incoming and outgoing edges.
      const cross = ax * by - ay * bx;
      const dotp = ax * bx + ay * by;
      const turn = Math.abs(Math.atan2(cross, dotp));
      if (turn < MIN_TURN) { pts.splice(i, 1); changed = true; break; }
      void lb;
    }
  }
  return pts;
}

// Area + centroid of a polygon (shoelace). Sign-independent.
function polygonAreaCentroid(verts) {
  let area2 = 0, cx = 0, cy = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i];
    const q = verts[(i + 1) % verts.length];
    const cr = p.x * q.y - q.x * p.y;
    area2 += cr;
    cx += (p.x + q.x) * cr;
    cy += (p.y + q.y) * cr;
  }
  const area = area2 / 2;
  if (Math.abs(area) < 1e-9) {
    // Degenerate: fall back to vertex average.
    let mx = 0, my = 0;
    for (const p of verts) { mx += p.x; my += p.y; }
    return { area: 0, cx: mx / verts.length, cy: my / verts.length };
  }
  return { area: Math.abs(area), cx: cx / (3 * area2), cy: cy / (3 * area2) };
}

// Second moment of area of a polygon about its centroid, per unit density.
// verts must already be relative to the centroid.
function polygonInertiaPerMass(verts, area) {
  let num = 0, den = 0;
  for (let i = 0; i < verts.length; i++) {
    const p = verts[i];
    const q = verts[(i + 1) % verts.length];
    const crossv = Math.abs(p.x * q.y - q.x * p.y);
    num += crossv * (p.x * p.x + p.x * q.x + q.x * q.x + p.y * p.y + p.y * q.y + q.y * q.y);
    den += crossv;
  }
  if (den < 1e-9) return area; // degenerate fallback
  // I/mass = (1/6) * sum(cross*(...)) / sum(cross); mass ∝ area, density 1.
  return num / (6 * den);
}


// Pull the individual rigid bodies out of the incoming geometry. A group /
// boolean's direct children each become their own body; anything else is a
// single body. Nested groups are flattened so e.g. a Merge of two rectangles
// yields two bodies.
function extractBodies(geo, out = []) {
  if (!geo) return out;
  if ((geo.type === 'group' || geo.type === 'boolean') && Array.isArray(geo.children)) {
    for (const child of geo.children) extractBodies(child, out);
    return out;
  }
  out.push(geo);
  return out;
}

// Build a simulation body from a geometry object. Circles (round ellipses) are
// modelled as discs; everything else becomes a convex-hull polygon sampled from
// the shape's real outline, so collisions happen at the true surface instead of
// at empty bounding-box corners. We cache the source geometry + rest center so
// we can translate and rotate it for the output frame.
function makeBody(geo, rand, spin, opts = {}) {
  const path = geoToPaperPath(geo);
  if (!path) return null;
  const b = path.bounds;
  const w = b.width;
  const h = b.height;
  if (!isFinite(w) || !isFinite(h) || w <= 0 || h <= 0) { path.remove(); return null; }

  const isCollider = !!opts.isCollider;

  // Container collider: capture the cavity polygon (world space) the ball must
  // stay inside. Computed before the path is removed below.
  let containPoly = null;
  if (isCollider && opts.contain) {
    containPoly = containmentPolygon(path);
  }

  // Treat a full ellipse whose bounds are ~square as a physics circle, so it
  // collides at its true surface instead of at its bounding-box corners.
  const isCircle = geo.type === 'ellipse' &&
    Math.abs(w - h) <= 0.05 * Math.max(w, h);

  let shape, cx, cy, radius, verts, mass, inertia;

  if (isCircle) {
    shape = 'circle';
    cx = b.x + w / 2;
    cy = b.y + h / 2;
    radius = (w + h) / 4;
    mass = Math.PI * radius * radius;
    inertia = mass * radius * radius / 2;
    verts = null;
    path.remove();
  } else {
    // Sample the real outline, take its convex hull, and build a polygon body.
    // The convex hull is always convex (SAT-friendly) and hugs the true shape
    // far better than the bounding box.
    const worldPts = samplePathPoints(path);
    path.remove();
    let hull = simplifyHull(convexHull(worldPts));
    if (hull.length < 3) {
      // Fall back to the bounding box if the hull degenerated.
      hull = [
        { x: b.x, y: b.y },
        { x: b.x + w, y: b.y },
        { x: b.x + w, y: b.y + h },
        { x: b.x, y: b.y + h },
      ];
    }
    shape = 'poly';
    const { area, cx: hcx, cy: hcy } = polygonAreaCentroid(hull);
    cx = hcx;
    cy = hcy;
    // Store vertices relative to the centroid (body-local, angle 0).
    verts = hull.map((p) => ({ x: p.x - cx, y: p.y - cy }));
    mass = area > 1e-6 ? area : w * h;
    inertia = mass * polygonInertiaPerMass(verts, mass);
    // Bounding radius (for broad-phase + circle tests).
    radius = 0;
    for (const v of verts) radius = Math.max(radius, Math.hypot(v.x, v.y));
  }

  if (!isFinite(mass) || mass <= 0) mass = w * h;
  if (!isFinite(inertia) || inertia <= 0) inertia = mass * (w * w + h * h) / 12;

  // Mass multiplier from the node's Mass / Collider Mass sliders. Scaling both
  // mass and inertia keeps the shape's rotational behaviour consistent while
  // making it heavier (harder to shove, settles more firmly).
  const massScale = opts.massScale > 0 ? opts.massScale : 1;
  mass *= massScale;
  inertia *= massScale;

  return {
    geo,
    isCollider,
    shape,
    radius,
    verts,        // local-space hull vertices (null for circles)
    // Container cavity polygon (world space, static — colliders don't rotate in
    // this mode). When present the collision inverts: dynamic bodies are kept
    // INSIDE this polygon instead of pushed out of the solid hull.
    containPoly,
    w,
    h,
    hw: w / 2,
    hh: h / 2,
    // Center = polygon centroid (or circle center) in world space.
    cx,
    cy,
    x0: cx,
    y0: cy,
    vx: 0,
    vy: 0,
    angle: 0,
    // A little seeded initial spin so pieces tumble instead of falling flat.
    angVel: (!isCollider && spin) ? (rand() - 0.5) * 2 * spin : 0,
    // Colliders are kinematic: infinite mass/inertia so bodies can't move them.
    invMass: isCollider ? 0 : 1 / mass,
    invInertia: isCollider ? 0 : 1 / inertia,
    // Rest + animated-current center, used to sweep an animated collider across
    // the bake. Set later once we know the collider's current-frame pose.
    restCX: cx,
    restCY: cy,
    curCX: cx,
    curCY: cy,
    // Sleep state: quietTime accrues while the body is slow + supported; once it
    // passes the threshold the body latches asleep (immovable) until an impact.
    sleeping: false,
    quietTime: 0,
    contacted: false,
  };
}

// Extract a containment polygon (world-space CCW-ish vertices) for a collider
// used as a container. The ball is kept INSIDE this polygon. For a hollow frame
// (compound path: an outer contour and an inner hole) we want the INNER contour
// — that's the cavity the ball lives in. For a plain filled shape we use its
// single outline. We deliberately do NOT convex-hull it here: the raw contour
// (possibly concave, e.g. a lozenge) is what bounds the ball.
function containmentPolygon(path) {
  const contourPts = (child) => {
    const pts = [];
    const len = child.length;
    if (!isFinite(len) || len <= 0) return pts;
    const n = Math.max(48, Math.min(512, Math.ceil(len / 3)));
    for (let i = 0; i < n; i++) {
      const pt = child.getPointAt((i / n) * len);
      if (pt) pts.push({ x: pt.x, y: pt.y });
    }
    return pts;
  };
  let contours = [];
  if (path.children && path.children.length) {
    contours = path.children.map(contourPts).filter((c) => c.length >= 3);
  } else {
    const c = contourPts(path);
    if (c.length >= 3) contours = [c];
  }
  if (contours.length === 0) return null;
  if (contours.length === 1) return contours[0];
  // Multiple contours = a frame with a hole. The cavity is the SMALLER-area
  // contour (the inner boundary); the larger is the outer edge of the frame.
  let best = null, bestArea = Infinity;
  for (const c of contours) {
    const { area } = polygonAreaCentroid(c);
    const a = Math.abs(area);
    if (a > 1e-3 && a < bestArea) { bestArea = a; best = c; }
  }
  return best || contours[0];
}

// World-space vertices of a body's polygon. For a poly body we transform its
// cached local hull vertices by the current angle + center.
function corners(body) {
  const c = Math.cos(body.angle);
  const s = Math.sin(body.angle);
  const { cx, cy } = body;
  return body.verts.map(({ x: lx, y: ly }) => ({
    x: cx + lx * c - ly * s,
    y: cy + lx * s + ly * c,
  }));
}

function dot(ax, ay, bx, by) {
  return ax * bx + ay * by;
}

// Velocity of a point on the body, including the contribution from rotation.
function pointVelocity(body, px, py) {
  const rx = px - body.cx;
  const ry = py - body.cy;
  return {
    x: body.vx - body.angVel * ry,
    y: body.vy + body.angVel * rx,
  };
}

// Resolve a rigid body against the static world bounds. Boxes test every corner;
// circles test their single closest surface point per wall. Any point past the
// floor or a wall produces a contact with an inward normal.
// Project a body's corners onto an axis and return the [min, max] interval.
function project(cs, ax, ay) {
  let min = Infinity, max = -Infinity;
  for (const p of cs) {
    const d = dot(p.x, p.y, ax, ay);
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

// SAT collision between two oriented convex polygons. Returns a contact
// MANIFOLD (one or two points) so that a flat face-face rest — e.g. a thin
// rectangle lying on a surface — is solved at BOTH corners. A single averaged
// contact point makes thin boxes rock forever: the off-center normal impulse
// injects torque, the box tips slightly, the point wanders, and it never
// settles. Two symmetric points make the torques cancel, so flat bodies rest.
function satCollide(a, b, hint) {
  const csA = corners(a);
  const csB = corners(b);
  const axesA = edgeNormals(csA);
  const axesB = edgeNormals(csB);

  // Find the minimum-penetration axis over both bodies' face normals, tracking
  // which body owns the reference face. When a hint normal (last substep's
  // contact normal for this pair) is supplied, we bias the comparison so a
  // near-tied axis that agrees with the hint wins. Two tall thin bars crushed
  // together have two candidate separating axes with nearly equal penetration
  // (the long face vs the short face); without coherence SAT flips between them
  // frame to frame, flipping the normal ~90° and launching a body sideways/up
  // (the "pop"). Preferring the previous normal keeps the manifold stable.
  const TIE = 4; // px: penetrations within this are considered a tie
  let minPen = Infinity;
  let nx = 0, ny = 0;
  let refIsA = true;
  let refEdge = 0;
  let bestScore = -Infinity;

  // First pass: find the true minimum penetration (needed for the tie window).
  const cand = [];
  for (let i = 0; i < axesA.length; i++) {
    const ax = axesA[i];
    const [minA, maxA] = project(csA, ax.x, ax.y);
    const [minB, maxB] = project(csB, ax.x, ax.y);
    if (maxA < minB || maxB < minA) return null;
    const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
    if (overlap < minPen) minPen = overlap;
    cand.push({ ax, i, isA: true, overlap });
  }
  for (let i = 0; i < axesB.length; i++) {
    const ax = axesB[i];
    const [minA, maxA] = project(csA, ax.x, ax.y);
    const [minB, maxB] = project(csB, ax.x, ax.y);
    if (maxA < minB || maxB < minA) return null;
    const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
    if (overlap < minPen) minPen = overlap;
    cand.push({ ax, i, isA: false, overlap });
  }
  // Second pass: pick the axis. Base score prefers smaller penetration; within
  // TIE of the minimum, add a bonus for agreement with the hint normal so the
  // chosen separating axis stays coherent across substeps (no ~90° flip/pop).
  for (const c of cand) {
    let score = -c.overlap;
    if (hint && c.overlap < minPen + TIE) {
      score += Math.abs(c.ax.x * hint.x + c.ax.y * hint.y) * (2 * TIE);
    }
    if (score > bestScore) {
      bestScore = score;
      nx = c.ax.x; ny = c.ax.y; refIsA = c.isA; refEdge = c.i;
    }
  }
  minPen = cand.find((c) => c.isA === refIsA && c.i === refEdge).overlap;

  // Orient the collision normal from A to B.
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  if (dot(dx, dy, nx, ny) < 0) { nx = -nx; ny = -ny; }

  // Build the contact manifold by clipping the incident face against the
  // reference face's side planes. This yields the up-to-2 real contact points.
  const refCs = refIsA ? csA : csB;
  const incCs = refIsA ? csB : csA;
  // Reference face outward normal (points from ref body toward the other).
  let refNx, refNy;
  {
    const p = refCs[refEdge];
    const q = refCs[(refEdge + 1) % refCs.length];
    const ex = q.x - p.x, ey = q.y - p.y;
    const len = Math.hypot(ex, ey) || 1e-6;
    refNx = -ey / len; refNy = ex / len;
    // Ensure it points toward the incident body.
    const cxRef = refIsA ? a.cx : b.cx;
    const cxInc = refIsA ? b.cx : a.cx;
    const cyRef = refIsA ? a.cy : b.cy;
    const cyInc = refIsA ? b.cy : a.cy;
    if (dot(cxInc - cxRef, cyInc - cyRef, refNx, refNy) < 0) { refNx = -refNx; refNy = -refNy; }
  }

  const manifold = buildManifold(refCs, refEdge, refNx, refNy, incCs);
  if (manifold.length === 0) {
    // Fallback: deepest-corner average (old behavior) so we always return a hit.
    const c = approxContact(csA, csB, nx, ny);
    return { nx, ny, pen: minPen, points: [{ px: c.x, py: c.y, pen: minPen, feat: refEdge * 32 + 31 }] };
  }
  // Tag each point with a stable feature id built from the reference face and
  // the clip endpoint index. Combined with the body-pair id upstream this keys
  // warm-starting; it survives rotation because it's an edge index, not a
  // world position. `refIsA` flips which body owns the face, so encode it too.
  const base = (refIsA ? 0 : 1) * 1024 + refEdge * 32;
  for (let i = 0; i < manifold.length; i++) manifold[i].feat = base + i;
  return { nx, ny, pen: minPen, points: manifold };
}

// Outward unit normals for each edge of a CCW/CW polygon (world space).
function edgeNormals(cs) {
  const out = [];
  for (let i = 0; i < cs.length; i++) {
    const p = cs[i];
    const q = cs[(i + 1) % cs.length];
    const ex = q.x - p.x, ey = q.y - p.y;
    const len = Math.hypot(ex, ey) || 1e-6;
    out.push({ x: -ey / len, y: ex / len });
  }
  return out;
}

// Given a reference edge (index refEdge on refCs) with outward normal (refNx,
// refNy), find the incident face on incCs (the edge whose normal most opposes
// the reference normal), clip it to the reference edge's side planes, and keep
// only points below the reference face. Returns [{px,py,pen}] with 0..2 points.
function buildManifold(refCs, refEdge, refNx, refNy, incCs) {
  const rp = refCs[refEdge];
  const rq = refCs[(refEdge + 1) % refCs.length];

  // Incident face: the edge of incCs most anti-parallel to the reference normal.
  // We compute each edge's normal on the fly and orient it OUTWARD from the
  // incident polygon (using its centroid) so winding (CW vs CCW) doesn't matter.
  let icx = 0, icy = 0;
  for (const p of incCs) { icx += p.x; icy += p.y; }
  icx /= incCs.length; icy /= incCs.length;

  let bestDot = Infinity, incEdge = 0;
  for (let i = 0; i < incCs.length; i++) {
    const p = incCs[i];
    const q = incCs[(i + 1) % incCs.length];
    let ex = q.x - p.x, ey = q.y - p.y;
    const len = Math.hypot(ex, ey) || 1e-6;
    let enx = -ey / len, eny = ex / len;
    // Orient outward from the incident centroid.
    const mx = (p.x + q.x) / 2, my = (p.y + q.y) / 2;
    if (dot(mx - icx, my - icy, enx, eny) < 0) { enx = -enx; eny = -eny; }
    const d = dot(enx, eny, refNx, refNy);
    if (d < bestDot) { bestDot = d; incEdge = i; }
  }
  let v1 = { x: incCs[incEdge].x, y: incCs[incEdge].y };
  let v2 = { x: incCs[(incEdge + 1) % incCs.length].x, y: incCs[(incEdge + 1) % incCs.length].y };

  // Reference edge tangent (side-plane direction).
  const tx = rq.x - rp.x, ty = rq.y - rp.y;
  const tlen = Math.hypot(tx, ty) || 1e-6;
  const utx = tx / tlen, uty = ty / tlen;

  // Clip the incident segment to the two side planes of the reference edge.
  const cOffP = dot(rp.x, rp.y, utx, uty);
  const cOffQ = dot(rq.x, rq.y, utx, uty);
  const lo = Math.min(cOffP, cOffQ);
  const hi = Math.max(cOffP, cOffQ);

  let pts = clipSegment(v1, v2, utx, uty, lo, hi);
  if (pts.length === 0) return [];

  // Keep BOTH clipped points as the contact patch. refNx/refNy points OUTWARD
  // from the reference body toward the incident one, so a penetrating incident
  // point projects LESS than the face offset -> sep < 0. Points with positive
  // separation are still kept (they define the patch); the velocity solver
  // naturally ignores any point that is separating, and per-point penetration is
  // clamped to >= 0 so only genuinely overlapping points get pushed apart.
  const refOff = dot(rp.x, rp.y, refNx, refNy);
  const out = [];
  for (const p of pts) {
    const sep = dot(p.x, p.y, refNx, refNy) - refOff;
    // Only keep points at/behind the reference face within a reasonable band;
    // points far in front are clip artifacts, not contacts.
    if (sep <= 1.0) out.push({ px: p.x, py: p.y, pen: Math.max(0, -sep) });
  }
  return out;
}

// Clip segment (a,b) to the interval [lo, hi] along the direction (dx,dy).
function clipSegment(a, b, dx, dy, lo, hi) {
  const pts = [a, b];
  // Clip against lower plane (keep >= lo).
  let clipped = clipPlane(pts, dx, dy, lo, +1);
  // Clip against upper plane (keep <= hi).
  clipped = clipPlane(clipped, dx, dy, hi, -1);
  return clipped;
}

// Keep the part of the segment on the `sign` side of the plane {p·(dx,dy)=off}.
function clipPlane(pts, dx, dy, off, sign) {
  if (pts.length < 2) return pts;
  const [a, b] = pts;
  const da = sign * (dot(a.x, a.y, dx, dy) - off);
  const db = sign * (dot(b.x, b.y, dx, dy) - off);
  const out = [];
  if (da >= 0) out.push(a);
  if (db >= 0) out.push(b);
  if (da * db < 0) {
    const t = da / (da - db);
    out.push({ x: a.x + t * (b.x - a.x), y: a.y + t * (b.y - a.y) });
  }
  return out;
}

function approxContact(csA, csB, nx, ny) {
  // Corner of B most in the -normal direction and corner of A most in +normal.
  let bDeep = csB[0], bMin = Infinity;
  for (const p of csB) {
    const d = dot(p.x, p.y, nx, ny);
    if (d < bMin) { bMin = d; bDeep = p; }
  }
  let aDeep = csA[0], aMax = -Infinity;
  for (const p of csA) {
    const d = dot(p.x, p.y, nx, ny);
    if (d > aMax) { aMax = d; aDeep = p; }
  }
  return { x: (aDeep.x + bDeep.x) / 2, y: (aDeep.y + bDeep.y) / 2 };
}

// Circle vs circle: contact when centers are closer than the summed radii.
function collideCircleCircle(a, b) {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const distSq = dx * dx + dy * dy;
  const rSum = a.radius + b.radius;
  if (distSq >= rSum * rSum) return null;
  const dist = Math.sqrt(distSq) || 1e-6;
  const nx = dx / dist;
  const ny = dy / dist;
  const pen = rSum - dist;
  // Contact sits on the surface between the two circles.
  const px = a.cx + nx * a.radius;
  const py = a.cy + ny * a.radius;
  return { nx, ny, pen, px, py };
}

// Closest point on a convex polygon body to world point (wx, wy), plus whether
// the point is inside the polygon.
function closestPointOnPoly(poly, wx, wy) {
  const cs = corners(poly);
  let bestX = cs[0].x, bestY = cs[0].y, bestDist = Infinity;
  let inside = true;
  for (let i = 0; i < cs.length; i++) {
    const p = cs[i];
    const q = cs[(i + 1) % cs.length];
    const ex = q.x - p.x;
    const ey = q.y - p.y;
    // Outward edge normal (polygon is CCW in our winding) — if the point is on
    // the outward side of any edge it's outside.
    const nxE = -ey, nyE = ex;
    if ((wx - p.x) * nxE + (wy - p.y) * nyE > 0) inside = false;
    // Closest point on this edge segment.
    const len2 = ex * ex + ey * ey || 1e-6;
    let t = ((wx - p.x) * ex + (wy - p.y) * ey) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = p.x + t * ex;
    const qy = p.y + t * ey;
    const d = (wx - qx) * (wx - qx) + (wy - qy) * (wy - qy);
    if (d < bestDist) { bestDist = d; bestX = qx; bestY = qy; }
  }
  return { x: bestX, y: bestY, inside };
}

// Circle vs convex polygon. Returns the contact with normal poly(a) -> circle(b).
function collideCirclePoly(poly, circle) {
  const cp = closestPointOnPoly(poly, circle.cx, circle.cy);
  let nx = circle.cx - cp.x;
  let ny = circle.cy - cp.y;
  let dist = Math.sqrt(nx * nx + ny * ny);

  if (cp.inside) {
    // Circle center inside the polygon: push out toward the nearest edge point.
    const m = dist || 1e-6;
    // Direction from center-of-poly to circle as a stable fallback.
    let ox = circle.cx - poly.cx;
    let oy = circle.cy - poly.cy;
    const om = Math.sqrt(ox * ox + oy * oy) || 1e-6;
    ox /= om; oy /= om;
    nx = m > 1e-6 ? nx / m : ox;
    ny = m > 1e-6 ? ny / m : oy;
    const pen = circle.radius + dist;
    return { nx, ny, pen, px: cp.x, py: cp.y };
  }

  if (dist >= circle.radius) return null;
  dist = dist || 1e-6;
  nx /= dist; ny /= dist;
  const pen = circle.radius - dist;
  return { nx, ny, pen, px: cp.x, py: cp.y };
}

// --- Containment (keep a body INSIDE a collider's cavity) -----------------
// Ray-cast point-in-polygon (handles concave contours like a lozenge cavity).
function pointInPolygon(poly, x, y) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y;
    const xj = poly[j].x, yj = poly[j].y;
    const intersect = ((yi > y) !== (yj > y)) &&
      (x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Closest point on a raw world-space polygon boundary to (wx, wy). Also returns
// the boundary EDGE tangent/normal at the closest point and whether the closest
// feature is the interior of an edge (vs an endpoint/vertex). For containment we
// prefer the edge's true perpendicular over the point-to-center vector: the
// latter picks up a tiny lateral component from asymmetric contour faceting,
// and with zero friction that lateral kick never decays — the ball drifts into
// a wall and rides it down. The edge perpendicular is symmetric and stable.
function closestPointOnContour(poly, wx, wy) {
  let bestX = poly[0].x, bestY = poly[0].y, bestDist = Infinity;
  let bestEx = 1, bestEy = 0, bestOnEdge = false, bestLen = 1;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % n];
    const ex = q.x - p.x, ey = q.y - p.y;
    const len2 = ex * ex + ey * ey || 1e-6;
    let t = ((wx - p.x) * ex + (wy - p.y) * ey) / len2;
    t = Math.max(0, Math.min(1, t));
    const qx = p.x + t * ex, qy = p.y + t * ey;
    const d = (wx - qx) * (wx - qx) + (wy - qy) * (wy - qy);
    if (d < bestDist) {
      bestDist = d; bestX = qx; bestY = qy;
      bestEx = ex; bestEy = ey; bestLen = Math.sqrt(len2);
      // On the interior of the edge (not clamped to a vertex) the edge
      // perpendicular is the meaningful contact normal.
      bestOnEdge = (t > 1e-4 && t < 1 - 1e-4);
    }
  }
  // Unit tangent along the edge and its two perpendiculars.
  const inv = 1 / (bestLen || 1e-6);
  const tx = bestEx * inv, ty = bestEy * inv;
  return { x: bestX, y: bestY, dist: Math.sqrt(bestDist), tx, ty, onEdge: bestOnEdge };
}

// Keep a dynamic body (treated as a disc of its bounding radius) INSIDE the
// container's cavity polygon. Returns a manifold with the normal pointing
// INWARD (toward the cavity) when the body reaches/exceeds the wall, else null.
// `cont` is the container collider, `body` the dynamic body.
function collideContainment(cont, body) {
  const poly = cont.containPoly;
  if (!poly || poly.length < 3) return null;
  const r = body.radius;
  const cx = body.cx, cy = body.cy;
  const cp = closestPointOnContour(poly, cx, cy);
  const inside = pointInPolygon(poly, cx, cy);

  // Vector from the boundary point to the body center.
  let dx = cx - cp.x, dy = cy - cp.y;
  let d = Math.hypot(dx, dy);

  if (inside) {
    // Fully inside with clearance: no contact.
    if (cp.dist >= r) return null;
    // Near the wall from the inside: push inward (away from the wall point).
    let nx, ny;
    if (cp.onEdge) {
      // Use the wall EDGE perpendicular, oriented toward the interior. This is
      // symmetric and stable: a body falling straight down a symmetric cavity
      // gets a purely vertical/horizontal normal, so it never picks up a
      // spurious lateral kick from asymmetric contour faceting (which, with
      // zero friction, would otherwise never decay and make it ride a wall).
      let px = -cp.ty, py = cp.tx;              // edge perpendicular
      if (px * dx + py * dy < 0) { px = -px; py = -py; } // orient toward center
      nx = px; ny = py;
    } else if (d > 1e-6) {
      // Closest feature is a vertex: fall back to the point-to-center vector.
      nx = dx / d; ny = dy / d;
    } else {
      // Center sits exactly on the wall; aim toward the cavity centroid.
      const c = polygonAreaCentroid(poly);
      const ox = c.cx - cx, oy = c.cy - cy, om = Math.hypot(ox, oy) || 1e-6;
      nx = ox / om; ny = oy / om;
    }
    const pen = r - cp.dist;
    // Manifold normal convention is A(cont) -> B(body). Inward push means the
    // body should move along +n (toward interior), so normal = n.
    return { nx, ny, pen, px: cp.x, py: cp.y };
  }

  // Body center has escaped OUTSIDE the cavity: pull it back in hard. The
  // inward direction is from the center toward the nearest boundary point.
  const pen = r + cp.dist;
  let nx, ny;
  if (cp.onEdge) {
    let px = -cp.ty, py = cp.tx;                 // edge perpendicular
    if (px * dx + py * dy > 0) { px = -px; py = -py; } // point back toward wall/interior
    nx = px; ny = py;
  } else if (d > 1e-6) {
    nx = -dx / d; ny = -dy / d;
  } else { nx = 0; ny = 1; }
  return { nx, ny, pen, px: cp.x, py: cp.y };
}

// Dispatch collision detection by the pair of shapes. Always returns the
// contact with the normal oriented from A toward B (matching satCollide).
function collide(a, b, hint) {
  // Broad-phase: bounding-radius reject to skip the expensive SAT test for
  // pairs that can't possibly touch (also cheap for the many-body case).
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  const rr = a.radius + b.radius;
  if (dx * dx + dy * dy > rr * rr) return null;

  if (a.shape === 'circle' && b.shape === 'circle') {
    return asManifold(collideCircleCircle(a, b));
  }
  if (a.shape === 'circle' && b.shape === 'poly') {
    // collideCirclePoly returns normal poly->circle (b). Flip to a->b.
    const hit = collideCirclePoly(b, a);
    if (!hit) return null;
    return asManifold({ nx: -hit.nx, ny: -hit.ny, pen: hit.pen, px: hit.px, py: hit.py });
  }
  if (a.shape === 'poly' && b.shape === 'circle') {
    return asManifold(collideCirclePoly(a, b)); // normal poly(a)->circle(b) == a->b
  }
  return satCollide(a, b, hint);
}

// Normalize a single-point circle hit into the manifold shape used by box-box.
function asManifold(hit) {
  if (!hit) return null;
  return { nx: hit.nx, ny: hit.ny, pen: hit.pen, points: [{ px: hit.px, py: hit.py, pen: hit.pen, feat: 0 }] };
}

// --- Accumulated-impulse contact solver ----------------------------------
// Build the full contact set for this substep ONCE, then relax it over the
// velocity iterations. Each contact point keeps a running total of the normal
// impulse it has applied; we clamp that TOTAL to be non-negative and only apply
// the per-iteration delta. Unlike re-applying a fresh full impulse each pass,
// this converges monotonically and cannot yank bodies back — which is exactly
// what kills the ringing when a fast collider rams a tight stack of thin bars.
// Build the contact set for this substep as MANIFOLDS (not pre-baked impulse
// points). Each manifold carries the normal, its points (with signed separation
// and a stable feature id), the collider push-scale, and a per-pair warm-start
// key prefix. The TGS-Soft solver consumes these directly.
function buildManifolds(bodies, floorY, leftX, rightX, useWalls, friction, normalCache) {
  const out = [];

  // Body-body.
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i], b = bodies[j];
      if (a.isCollider && b.isCollider) continue;

      // Container collider: keep the dynamic body INSIDE its cavity rather than
      // colliding with it as a solid. Identify (container, dynamic) either way.
      const aCont = a.isCollider && a.containPoly;
      const bCont = b.isCollider && b.containPoly;
      if (aCont || bCont) {
        const cont = aCont ? a : b;
        const dyn = aCont ? b : a;
        if (dyn.isCollider) continue; // two colliders: nothing to contain
        const chit = collideContainment(cont, dyn);
        if (!chit) continue;
        cont.contacted = true;
        dyn.contacted = true;
        if (dyn.sleeping) wake(dyn);
        const imD = invMassOf(dyn);
        if (imD === 0) continue;
        // collideContainment returns the normal in the cont -> dyn sense (inward,
        // toward the cavity). We always emit the manifold as (a: cont, b: dyn),
        // so the normal is already correct and needs no flip.
        const nx = chit.nx, ny = chit.ny;
        const keyBase = cont.id * 100003 + dyn.id * 331;
        out.push({
          a: cont, b: dyn, nx, ny,
          points: [{ px: chit.px, py: chit.py, sep: -(chit.pen || 0), fid: keyBase + 7 }],
          pushScale: cont.pushScale || 1, friction,
        });
        continue;
      }

      const pairKey = a.id * 100003 + b.id;
      const hint = normalCache ? normalCache.get(pairKey) : null;
      const hit = collide(a, b, hint);
      if (!hit) { if (normalCache) normalCache.delete(pairKey); continue; }
      const { nx, ny, points } = hit;
      if (normalCache) normalCache.set(pairKey, { x: nx, y: ny });
      a.contacted = true;
      b.contacted = true;

      const p0 = points[0];
      const vpA0 = pointVelocity(a, p0.px, p0.py);
      const vpB0 = pointVelocity(b, p0.px, p0.py);
      if (Math.hypot(vpB0.x - vpA0.x, vpB0.y - vpA0.y) > WAKE_VELOCITY) {
        if (a.sleeping && !b.sleeping) wake(a);
        if (b.sleeping && !a.sleeping) wake(b);
      }

      const imA = invMassOf(a), imB = invMassOf(b);
      if (imA + imB === 0) continue;
      const pushScale = (a.isCollider && imB > 0) ? (a.pushScale || 1)
        : (b.isCollider && imA > 0) ? (b.pushScale || 1) : 1;

      const keyBase = a.id * 100003 + b.id * 331;
      const pts = points.map((pt) => ({
        px: pt.px, py: pt.py,
        sep: -(pt.pen || 0),                 // penetration depth -> negative sep
        fid: keyBase + (pt.feat || 0),       // stable warm-start key
      }));
      out.push({ a, b, nx, ny, points: pts, pushScale, friction });
    }
  }

  // World bounds (floor + optional side walls). Modeled as contacts vs an
  // immovable "null" body. Feature ids are the wall side + corner index so
  // warm-starting persists per corner.
  for (const body of bodies) {
    if (body.isCollider || body.sleeping) continue;
    const groups = new Map(); // normal-key -> { nx, ny, pts:[{px,py,sep,fid}] }
    const add = (nx, ny, px, py, sep, side, idx) => {
      const key = nx + ',' + ny;
      if (!groups.has(key)) groups.set(key, { nx, ny, pts: [] });
      groups.get(key).pts.push({ px, py, sep, fid: body.id * 100003 + 900000 + side * 16 + idx });
    };
    if (body.shape === 'circle') {
      const r = body.radius;
      if (body.cy + r > floorY) add(0, 1, body.cx, body.cy + r, floorY - (body.cy + r), 0, 0);
      if (useWalls) {
        if (body.cx - r < leftX) add(-1, 0, body.cx - r, body.cy, (body.cx - r) - leftX, 1, 0);
        if (body.cx + r > rightX) add(1, 0, body.cx + r, body.cy, rightX - (body.cx + r), 2, 0);
      }
    } else {
      const cs = corners(body);
      for (let idx = 0; idx < cs.length; idx++) {
        const p = cs[idx];
        if (p.y > floorY) add(0, 1, p.x, p.y, floorY - p.y, 0, idx);
        if (useWalls) {
          if (p.x < leftX) add(-1, 0, p.x, p.y, p.x - leftX, 1, idx);
          if (p.x > rightX) add(1, 0, p.x, p.y, rightX - p.x, 2, idx);
        }
      }
    }
    if (groups.size === 0) continue;
    body.contacted = true;
    for (const g of groups.values()) {
      out.push({ a: body, b: null, nx: g.nx, ny: g.ny, points: g.pts, pushScale: 1, friction });
    }
  }

  return out;
}

// (Old per-point solver + geometric separation removed — the TGS-Soft solver in
// physicsSolver.js resolves velocity AND penetration together via compliant
// constraints, so there is no separate position push-out to fight it.)

// One full simulation step (one substep of the bake). TGS-Soft: build the
// contact manifolds, warm-start from the persistent impulse cache, run a biased
// solve (resolves velocity AND penetration through compliant constraints),
// integrate position, then a relax pass (no bias) so recovered penetration
// leaves no residual velocity. `warm` is a Map persisted across substeps keyed
// by feature id — this is what removes the frame-to-frame equilibrium hunting.
function stepSimulation(bodies, dt, opts, simTime, totalTime, warm, normalCache) {
  const { gravity, floorY, leftX, rightX, useWalls, restitution, friction,
    linearDamping, angularDamping, lockRotation, sleepSpeed, fps,
    contactHertz, contactZeta } = opts;

  const sleepLinear = sleepSpeed > 0 ? sleepSpeed : SLEEP_LINEAR;
  const sleepAngular = SLEEP_ANGULAR * (sleepLinear / SLEEP_LINEAR);
  const restVelocity = Math.max(REST_VELOCITY, sleepLinear * 2);
  const restThreshold = restVelocity; // below this closing speed -> no bounce

  const linMul = Math.max(0, 1 - linearDamping * dt);
  const angMul = lockRotation ? 0 : Math.max(0, 1 - angularDamping * dt);

  // --- 1) Integrate velocity (gravity + damping) and position colliders. ----
  for (const body of bodies) {
    resetDeltas(body);
    if (body.isCollider) {
      if (body.track && body.track.length > 0) {
        const track = body.track;
        const last = track.length - 1;
        const frameF = Math.max(0, Math.min(last, (simTime * (fps || 30))));
        const i0 = Math.floor(frameF);
        const i1 = Math.min(last, i0 + 1);
        const frac = frameF - i0;
        const p0 = track[i0];
        const p1 = track[i1];
        body.cx = p0.cx + (p1.cx - p0.cx) * frac;
        body.cy = p0.cy + (p1.cy - p0.cy) * frac;
        const fdt = 1 / (fps || 30);
        body.vx = fdt > 0 ? (p1.cx - p0.cx) / fdt : 0;
        body.vy = fdt > 0 ? (p1.cy - p0.cy) / fdt : 0;
      } else {
        const t = totalTime > 0 ? Math.min(1, simTime / totalTime) : 1;
        body.cx = body.restCX + (body.curCX - body.restCX) * t;
        body.cy = body.restCY + (body.curCY - body.restCY) * t;
        body.vx = totalTime > 0 ? (body.curCX - body.restCX) / totalTime : 0;
        body.vy = totalTime > 0 ? (body.curCY - body.restCY) / totalTime : 0;
      }
      // Collider position is set at substep start (above). Its velocity is
      // carried into the constraint via vn, so leave its position deltas at 0 —
      // separation tracking only needs the DYNAMIC bodies' motion this substep.
      continue;
    }
    if (body.sleeping) { body.contacted = false; continue; }
    body.vy += gravity * dt;
    body.vx *= linMul;
    body.vy *= linMul;
    body.angVel *= angMul;
    body.contacted = false;
  }

  // --- 2) Build contact manifolds for this substep. ------------------------
  const manifolds = buildManifolds(bodies, floorY, leftX, rightX, useWalls, friction, normalCache);

  // --- 3) Prepare constraints (cache solver data + warm-start impulses). ----
  const constraints = [];
  for (const m of manifolds) {
    constraints.push(prepareConstraint(
      m, m.a, m.b, warm, contactHertz, contactZeta, dt, restitution, restThreshold,
    ));
  }
  for (const k of constraints) warmStart(k);

  // --- 4) Biased velocity solve (velocity + soft penetration recovery). -----
  for (let it = 0; it < VELOCITY_ITERATIONS; it++) {
    for (const k of constraints) solveConstraint(k, true, dt);
  }

  // --- 5) Integrate position with the solved velocity (TGS). ---------------
  for (const body of bodies) integrateBody(body, dt);

  // --- 6) Relax pass (no bias): removes any velocity that the positional bias
  // injected, so recovered penetration doesn't leave the pile drifting/bouncing.
  for (let it = 0; it < RELAX_ITERATIONS; it++) {
    for (const k of constraints) solveConstraint(k, false, dt);
  }

  // --- 6b) Restitution pass: inject the bounce velocity as a hard impulse so
  // the soft-constraint solve can't bleed it. This is what makes the Bounciness
  // slider actually reach its set value (e.g. 1.0 -> a near-elastic rebound).
  for (const k of constraints) applyRestitution(k);

  // --- 7) Store the solved impulses for next substep's warm start. ----------
  if (warm) {
    for (const k of constraints) {
      for (const p of k.points) {
        if (p.fid != null) warm.set(p.fid, { Pn: p.Pn, Pt: p.Pt });
      }
    }
  }

  // --- 8) Island-based sleeping (unchanged): touching bodies sleep together
  // once every member has been quiet for SLEEP_TIME, latching the pile solid.
  const dyn = [];
  for (const b of bodies) if (!b.isCollider && !b.sleeping) dyn.push(b);
  const parent = dyn.map((_, i) => i);
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const union = (x, y) => { const rx = find(x), ry = find(y); if (rx !== ry) parent[rx] = ry; };
  for (let i = 0; i < dyn.length; i++) {
    for (let j = i + 1; j < dyn.length; j++) {
      if (collide(dyn[i], dyn[j])) union(i, j);
    }
  }

  for (const body of dyn) {
    // Near-rest dissipation: once a contacted body has slowed into the settling
    // band, bleed a fraction of its residual velocity each step. The soft solver
    // removes closing/penetration energy but leaves a slowly-decaying tangential
    // "creep" in a packed pile (bodies sliding against each other) that can take
    // dozens of frames to die on its own — visible as a long, slow shuffle after
    // the pusher stops. This models the internal friction of a real pile: it only
    // engages on bodies in contact AND already slow (below the settling band), so
    // free fall, tumbling, and the active fast push are untouched. It's what lets
    // the pile reach a dead-still sleep quickly instead of creeping for a second.
    // Near-rest dissipation only bleeds velocity from a body that has ALREADY
    // been resting/creeping for a sustained moment (quietTime accrued) — never on
    // first contact. This is critical: a body rebounding off the floor is briefly
    // "contacted" and slow at the top of its arc, and an eager dissipation there
    // would silently eat all restitution (bounce would look dead). By requiring
    // prior sustained quiet, a bouncing body (quietTime≈0, still separating) keeps
    // its rebound, while a genuinely settled pile still gets its creep bled off.
    const speed = Math.hypot(body.vx, body.vy);
    if (body.contacted && (body.quietTime || 0) > 0 && speed < restVelocity) {
      body.vx *= REST_RELAX;
      body.vy *= REST_RELAX;
      body.angVel *= REST_RELAX;
    }
    // Snap a nearly axis-aligned, quiet box flat so a hair of residual angle
    // doesn't keep it technically "moving". The soft solver already keeps it
    // stable; this is purely cosmetic latching.
    if (body.contacted && body.shape !== 'circle' && Math.abs(body.angVel) < sleepAngular) {
      const q = Math.PI / 2;
      const nearest = Math.round(body.angle / q) * q;
      if (Math.abs(body.angle - nearest) < FLAT_SNAP_ANGLE) {
        body.angle = nearest;
        body.angVel = 0;
      }
    }
    const quiet = body.contacted &&
      Math.hypot(body.vx, body.vy) < sleepLinear &&
      Math.abs(body.angVel) < sleepAngular;
    body.quietTime = quiet ? (body.quietTime || 0) + dt : 0;
  }

  const islandMinQuiet = new Map();
  for (let i = 0; i < dyn.length; i++) {
    const r = find(i);
    const q = dyn[i].quietTime || 0;
    const prev = islandMinQuiet.get(r);
    islandMinQuiet.set(r, prev === undefined ? q : Math.min(prev, q));
  }
  for (let i = 0; i < dyn.length; i++) {
    if ((islandMinQuiet.get(find(i)) || 0) >= SLEEP_TIME) {
      const body = dyn[i];
      body.sleeping = true;
      body.vx = 0; body.vy = 0; body.angVel = 0;
    }
  }

  // --- 9) Cohesion: close hairline seams between settled neighbours. ---------
  if (opts.cohesion > 0) {
    for (let i = 0; i < bodies.length; i++) {
      if (bodies[i].isCollider) continue;
      for (let j = i + 1; j < bodies.length; j++) {
        if (bodies[j].isCollider) continue;
        applyCohesion(bodies[i], bodies[j], opts.cohesion);
      }
    }
  }
}

// Approximate surface gap + direction between two bodies. For circles this is
// exact; for boxes we use center distance minus half-extents along the axis,
// which is close enough for the small nudges cohesion applies.
function surfaceGap(a, b) {
  const dx = b.cx - a.cx;
  const dy = b.cy - a.cy;
  const dist = Math.hypot(dx, dy) || 1e-6;
  const nx = dx / dist;
  const ny = dy / dist;

  const reach = (body) => {
    if (body.shape === 'circle') return body.radius;
    // Support distance of the polygon along the contact normal: the farthest
    // projection of any hull vertex onto that direction.
    const cs = corners(body);
    let max = 0;
    for (const p of cs) {
      const d = (p.x - body.cx) * nx + (p.y - body.cy) * ny;
      if (d > max) max = d;
    }
    return max;
  };

  const gap = dist - reach(a) - reach(b);
  return { gap, nx, ny };
}

function applyCohesion(a, b, strength) {
  // Only nestle bodies that are essentially at rest, so falling/bouncing pieces
  // aren't artificially attracted.
  const restSpeed = 40;
  const aSlow = Math.hypot(a.vx, a.vy) < restSpeed;
  const bSlow = Math.hypot(b.vx, b.vy) < restSpeed;
  if (!aSlow || !bSlow) return;

  const { gap, nx, ny } = surfaceGap(a, b);
  // Only close hairline seams between pieces that are already touching (or all
  // but touching). Deliberately tiny so cohesion can never drag deliberately
  // spaced-out shapes together — it just removes sub-pixel/AA gaps so resting
  // neighbours read as flush.
  const maxGap = 3;
  if (gap <= 0 || gap > maxGap) return;

  const invSum = a.invMass + b.invMass || 1;
  const move = gap * strength;
  a.cx += nx * move * (a.invMass / invSum);
  a.cy += ny * move * (a.invMass / invSum);
  b.cx -= nx * move * (b.invMass / invSum);
  b.cy -= ny * move * (b.invMass / invSum);
}

// Translate + rotate a body's cached geometry from its rest pose to its
// simulated pose and emit a fresh geometry object.
function bodyToGeo(body) {
  ensurePaper();
  const path = geoToPaperPath(body.geo);
  if (!path) return body.geo;

  const dx = body.cx - body.x0;
  const dy = body.cy - body.y0;
  if (dx !== 0 || dy !== 0) path.translate(new paper.Point(dx, dy));
  if (body.angle !== 0) {
    // Rotate about the (moved) center. Paper uses degrees.
    path.rotate(body.angle * 180 / Math.PI, new paper.Point(body.cx, body.cy));
  }

  const pathData = path.pathData;
  const bounds = path.bounds;
  path.remove();

  const geo = body.geo;
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
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}

// --- Cross-frame bake cache ------------------------------------------------
// The graph is re-evaluated from scratch every frame, so without a cache the
// physics would re-bake from frame 0 on every frame. For a chaotic, marginally-
// stable pile (e.g. thin bars crushed by a collider) that makes adjacent frames
// land in visibly different configurations — the mid-animation "jitter" — even
// though each individual bake is smooth and deterministic. The fix: remember the
// simulated state at each integer frame and CONTINUE forward from the previous
// frame instead of re-baking, so the displayed sequence is one continuous
// trajectory. Scrubbing forward is O(1) per frame; scrubbing backward or editing
// any parameter/geometry rebuilds from the nearest valid point (or 0).
//
// The cache lives on the module (one graph, one physics node in play at a time).
// It is keyed by a fingerprint of everything that changes the bake; any change
// invalidates it so edits and param tweaks stay correct.
const bakeCache = {
  key: null,        // fingerprint string
  trackSig: '',     // collider-track portion of the key (persists across no-track evals)
  frames: [],       // frames[f] = array of dynamic body-state snapshots at end of frame f
  warm: [],         // warm[f]   = serialized warm-start cache after frame f
};

// Snapshot only the DYNAMIC state of a body (geometry/hull is rebuilt fresh each
// evaluate by makeBody, so we never cache that — just what the sim mutates).
function snapshotBody(b) {
  return {
    cx: b.cx, cy: b.cy, angle: b.angle,
    vx: b.vx, vy: b.vy, angVel: b.angVel,
    sleeping: b.sleeping, quietTime: b.quietTime || 0,
    contacted: b.contacted || false,
  };
}
function restoreBody(b, s) {
  b.cx = s.cx; b.cy = s.cy; b.angle = s.angle;
  b.vx = s.vx; b.vy = s.vy; b.angVel = s.angVel;
  b.sleeping = s.sleeping; b.quietTime = s.quietTime;
  b.contacted = s.contacted;
}

// Stable fingerprint of the inputs that affect the bake. Geometry is summarized
// by each part's rest center + size (cheap, and enough to detect edits). Any
// change -> new key -> full rebuild, so correctness never depends on the cache.
function bakeFingerprint(opts, seed, initialSpin, massScale, colliderMass, effSubsteps, bodies, colliders) {
  const geoSig = bodies.map((b) => `${b.x0.toFixed(2)},${b.y0.toFixed(2)},${b.radius.toFixed(2)}`).join('|');
  const colSig = colliders.map((c) => `${c.restCX.toFixed(2)},${c.restCY.toFixed(2)},${c.radius.toFixed(2)}`).join('|');
  return JSON.stringify({ o: opts, seed, initialSpin, massScale, colliderMass, effSubsteps, geoSig, colSig });
}

export function physicsRuntime(params, inputs, context) {
  ensurePaper();

  const geo = inputs?.geometry_in;
  if (!geo) return null;

  // Gravity is authored in m/s² (Earth ≈ 9.81). Convert to px/s² for the sim.
  // Legacy graphs stored gravity directly in px/s² (e.g. 900); values whose
  // magnitude exceeds the slider's m/s² range are treated as legacy px values
  // so old saves keep behaving the same.
  const PX_PER_METER = 91.74; // makes 9.81 m/s² ≈ 900 px/s² (prior default feel)
  const gravityInput = params.gravity ?? 9.81;
  const gravity = Math.abs(gravityInput) > 55 ? gravityInput : gravityInput * PX_PER_METER;
  const massScale = Math.max(0.1, params.mass ?? 1);
  const colliderMass = Math.max(0.1, params.collider_mass ?? 1);
  const containInside = params.contain_inside === true;
  const restitution = Math.max(0, Math.min(1, params.restitution ?? 0.2));
  const friction = Math.max(0, Math.min(1, params.friction ?? 0.2));
  const useWalls = params.walls !== false;
  const floorY = params.floor_y ?? 300;
  const leftX = Math.min(params.left_x ?? -400, params.right_x ?? 400);
  const rightX = Math.max(params.left_x ?? -400, params.right_x ?? 400);
  const substeps = Math.max(1, Math.min(32, Math.round(params.substeps ?? 8)));
  const rotation = params.rotation !== false;
  const initialSpin = rotation ? (params.initial_spin ?? 0) : 0;
  const linearDamping = Math.max(0, params.linear_damping ?? 0);
  const angularDamping = Math.max(0, params.angular_damping ?? 0.5);
  const cohesion = Math.max(0, Math.min(1, params.cohesion ?? 0));
  // Sleep Speed (px/s): resting pieces below this linear speed are treated as
  // still and allowed to freeze. Higher settles/locks sooner (kills residual
  // jitter); lower keeps motion alive longer. 0 -> use the built-in default.
  const sleepSpeed = Math.max(0, params.sleep_speed ?? SLEEP_LINEAR);
  const lockRotation = !rotation; // rotation toggle off -> freeze all spin
  const seed = params.seed ?? 0;

  const frame = Math.max(0, Math.round(context?.frame ?? 0));
  const fps = context?.fps || 30;

  const rand = seededRandom(seed);
  const bodies = extractBodies(geo)
    .map((g) => makeBody(g, rand, initialSpin, { massScale }))
    .filter(Boolean);
  if (bodies.length === 0) return geo;

  // Optional kinematic colliders: immovable obstacles the dynamic bodies bounce
  // off. If the collider input is animated, we sweep each collider from its
  // frame-0 (rest) pose to its current pose across the bake and derive a
  // velocity from that motion, so a moving collider shoves bodies like a paddle.
  const colliderGeo = inputs?.collision_in;
  const restColliderGeo = context?.restInputs?.collision_in;
  // Per-frame position track for the collision input (index = integer frame),
  // pre-sampled by the graph evaluator so an animated collider follows its true
  // keyframe path and then holds still once its animation ends. Absent for
  // static colliders or when the host didn't supply it.
  const colliderTrackGeo = context?.colliderTrackInput;

  // Center of a single collider part (bbox center), matching how bodies read
  // their current pose. Returns null if the part can't be measured.
  const partCenter = (part) => {
    const p = geoToPaperPath(part);
    if (!p) return null;
    const b = p.bounds;
    p.remove();
    if (!isFinite(b.width) || !isFinite(b.height)) return null;
    return { cx: b.x + b.width / 2, cy: b.y + b.height / 2 };
  };

  const colliders = [];
  if (colliderGeo) {
    const curParts = extractBodies(colliderGeo);
    const restParts = restColliderGeo ? extractBodies(restColliderGeo) : null;
    // Pre-extract each track frame's parts once (not per collider part).
    const trackParts = Array.isArray(colliderTrackGeo)
      ? colliderTrackGeo.map((g) => (g ? extractBodies(g) : null))
      : null;
    curParts.forEach((g, i) => {
      const body = makeBody(g, rand, 0, { isCollider: true, contain: containInside });
      if (!body) return;
      // Collider Mass scales how hard this collider shoves dynamic bodies.
      body.pushScale = colliderMass;
      // curCX/curCY already reflect this frame's pose (body built from it).
      body.curCX = body.cx;
      body.curCY = body.cy;
      // Rest pose comes from the frame-0 snapshot of the same collider part.
      const restPart = restParts && restParts[i];
      if (restPart) {
        const c = partCenter(restPart);
        if (c) { body.restCX = c.cx; body.restCY = c.cy; }
      } else {
        // No rest snapshot: treat as static at current pose (no sweep).
        body.restCX = body.curCX;
        body.restCY = body.curCY;
      }
      // Build this part's per-frame center track (index = integer frame). When
      // present the bake positions the collider along this real path instead of
      // a single rest->current interpolation, so it stops when its animation
      // does and lets disturbed bodies settle.
      if (trackParts) {
        const centers = [];
        for (let f = 0; f < trackParts.length; f++) {
          const parts = trackParts[f];
          const c = parts && parts[i] ? partCenter(parts[i]) : null;
          centers.push(c || { cx: body.restCX, cy: body.restCY });
        }
        if (centers.length > 0) body.track = centers;
      }
      // Start the sim with the collider at its rest pose.
      body.cx = body.restCX;
      body.cy = body.restCY;
      colliders.push(body);
    });
  }

  const simBodies = bodies.concat(colliders);
  // Stable ids for warm-start keying (survive across substeps).
  simBodies.forEach((b, i) => { b.id = i; });

  // Bake the simulation from frame 0 up to the requested frame, split into
  // substeps for stability. Deterministic: same frame -> same result.
  const opts = { gravity, floorY, leftX, rightX, useWalls, restitution, friction,
    linearDamping, angularDamping, lockRotation, cohesion, sleepSpeed, fps, containInside,
    contactHertz: CONTACT_HERTZ, contactZeta: CONTACT_ZETA };
  // The iterative solver + sleep thresholds are tuned for a small time step. At
  // low substeps the per-step dt is so large that residual velocities never dip
  // below the sleep threshold, so piles NEVER settle and jitter forever. To keep
  // settling robust regardless of the user's slider, we enforce a minimum
  // internal substep rate: the slider still lets you go HIGHER for accuracy, but
  // never coarser than what the solver needs to converge and sleep.
  // Signature of the collider track's SHAPE (independent of its length, which
  // grows as the requested frame advances). Sampling the per-collider centers at
  // a few early frames catches keyframe edits (which change the path) without
  // invalidating the cache just because the track got longer.
  let trackSig = '';
  if (colliders.length > 0 && colliders[0].track) {
    trackSig = colliders.map((c) => {
      const t = c.track || [];
      const pick = [0, 1, 2, 3, 5, 8, 13, 21];
      return pick.map((i) => (t[i] ? `${t[i].cx.toFixed(1)},${t[i].cy.toFixed(1)}` : '')).join(';');
    }).join('||');
  }

  const MIN_SUBSTEPS = 4;
  const effSubsteps = Math.max(substeps, MIN_SUBSTEPS);
  const dt = 1 / fps / effSubsteps;

  // Cross-frame continuity: resume from the previously baked frame instead of
  // re-solving from 0. A leaning/crushed pile is chaotic, so re-baking from 0
  // every frame lands adjacent frames in different poses (the mid-animation
  // jitter). Continuing forward makes the shown sequence ONE trajectory.
  const baseKey = bakeFingerprint(opts, seed, initialSpin, massScale, colliderMass, effSubsteps, bodies, colliders) + `|fps${fps}`;
  // The collider track drives the sim, so a track change must invalidate too —
  // BUT secondary evaluations (rest snapshot, track sampling) run WITHOUT a track
  // and must not wipe the authoritative cache built by the real render. So: only
  // let a present track update/invalidate the key; a missing track keeps whatever
  // track the cache already holds.
  const haveTrack = colliders.length > 0 && !!colliders[0].track;
  const key = baseKey + (haveTrack ? `|t${trackSig}` : (bakeCache.trackSig || ''));
  if (bakeCache.key !== key) {
    bakeCache.key = key;
    bakeCache.trackSig = haveTrack ? `|t${trackSig}` : (bakeCache.trackSig || '');
    bakeCache.frames = [];
    bakeCache.warm = [];
  }

  const totalTime = frame / fps; // real end-time of this frame (for collider sweep fallback)
  const warm = new Map();
  const normalCache = new Map();

  // Find the latest cached frame <= the requested frame to resume from.
  let startFrame = 0;
  const cached = bakeCache.frames;
  for (let f = Math.min(frame, cached.length - 1); f >= 0; f--) {
    if (cached[f]) { startFrame = f; break; }
  }
  if (startFrame > 0 && cached[startFrame]) {
    // Restore dynamic state of dynamic bodies from the snapshot.
    const snap = cached[startFrame];
    for (let i = 0; i < bodies.length; i++) if (snap[i]) restoreBody(bodies[i], snap[i]);
    // Restore the warm-start impulses so the solver keeps its converged solution.
    const w = bakeCache.warm[startFrame];
    if (w) for (const [k, v] of w) warm.set(k, { Pn: v.Pn, Pt: v.Pt });
  }
  // Frame 0 snapshot (initial rest state) so a resume-from-0 is possible.
  if (!cached[0]) {
    cached[0] = bodies.map(snapshotBody);
    bakeCache.warm[0] = new Map();
  }

  // Step forward frame by frame from startFrame+1 up to the requested frame,
  // caching each frame's end state so future frames resume in O(1).
  for (let f = startFrame + 1; f <= frame; f++) {
    for (let s = 0; s < effSubsteps; s++) {
      // Real end-of-substep time: frame f spans (f-1 .. f); substep s ends at
      // (f-1 + (s+1)/effSubsteps)/fps. The collider reads this to follow its
      // keyframed track at the correct moment regardless of the resume point.
      const simTime = ((f - 1) + (s + 1) / effSubsteps) / fps;
      stepSimulation(simBodies, dt, opts, simTime, totalTime, warm, normalCache);
      if (typeof globalThis.__PHYS_PROBE === 'function') {
        globalThis.__PHYS_PROBE(f * effSubsteps + s, bodies);
      }
    }
    cached[f] = bodies.map(snapshotBody);
    // Snapshot the warm cache so a later resume from THIS frame keeps momentum.
    const wSnap = new Map();
    for (const [k, v] of warm) wSnap.set(k, { Pn: v.Pn, Pt: v.Pt });
    bakeCache.warm[f] = wSnap;
  }

  const children = bodies.map(bodyToGeo);
  // Emit colliders at their current (final) pose so the obstacle stays visible.
  const colliderChildren = colliders.map(bodyToGeo);
  const allChildren = children.concat(colliderChildren);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of allChildren) {
    if (c.bounds) {
      minX = Math.min(minX, c.bounds.x);
      minY = Math.min(minY, c.bounds.y);
      maxX = Math.max(maxX, c.bounds.x + c.bounds.width);
      maxY = Math.max(maxY, c.bounds.y + c.bounds.height);
    }
  }

  return {
    type: 'group',
    children: allChildren,
    transform: {},
    bounds: {
      x: isFinite(minX) ? minX : 0,
      y: isFinite(minY) ? minY : 0,
      width: isFinite(maxX - minX) ? maxX - minX : 0,
      height: isFinite(maxY - minY) ? maxY - minY : 0,
    },
  };
}
