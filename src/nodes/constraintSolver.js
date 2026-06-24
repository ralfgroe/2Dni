/* Geometric constraint solver — the SolidWorks-style core of the Dimension node.

   The model: each sketch vertex is two unknowns (x, y). Dimensions and relations
   are residual equations f(vars) = 0. We solve the system numerically with a
   damped Gauss–Newton (Levenberg–Marquardt) iteration seeded from the current
   vertex positions, so the solution is the minimal-movement configuration —
   exactly how dragging a dimension in SolidWorks reshapes the sketch.

   Degrees of freedom drive the blue/black/red status: effective DOF =
   2*N - rank(Jacobian). A new constraint that adds no independent information
   (rank doesn't rise) or can't be satisfied is over-defined and rejected.

   This module is intentionally pure: no paper.js, no DOM, no React, so it can be
   unit-tested headlessly. The dimension runtime/overlay adapt geometry to and
   from the {vertices, edges, constraints} shape this module understands. */

const EPS = 1e-6;

/* ---- constraint residual definitions -------------------------------------
   Each constraint type maps to one or more scalar residuals over the flat
   variable vector V (V[2i], V[2i+1] are vertex i's x,y). A residual of 0 means
   satisfied. `params` carries the constraint's fixed data (target value, the
   reference angle, etc.). Vertex references are indices into the vertex array. */

function angleWrap(a) {
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

/* Returns an array of residual values for a single constraint given V. */
function constraintResiduals(c, V) {
  const gx = (i) => V[2 * i];
  const gy = (i) => V[2 * i + 1];
  switch (c.type) {
    case 'anchor': {
      // Pin a vertex to a fixed coordinate (grounds the sketch).
      return [gx(c.v) - c.x, gy(c.v) - c.y];
    }
    case 'anchorX':
      return [gx(c.v) - c.x];
    case 'anchorY':
      return [gy(c.v) - c.y];
    case 'coincident':
      // Two vertices share a location: both x and y equal.
      return [gx(c.a) - gx(c.b), gy(c.a) - gy(c.b)];
    case 'horizontal':
      // Edge a->b is horizontal: y equal.
      return [gy(c.a) - gy(c.b)];
    case 'vertical':
      return [gx(c.a) - gx(c.b)];
    case 'fixedAngle': {
      // Edge a->b keeps the reference angle theta0 (undimensioned diagonals).
      const dx = gx(c.b) - gx(c.a);
      const dy = gy(c.b) - gy(c.a);
      return [angleWrap(Math.atan2(dy, dx) - c.theta0)];
    }
    case 'distance': {
      // axis: 'horizontal' | 'vertical' | 'aligned'
      if (c.axis === 'horizontal') return [Math.abs(gx(c.b) - gx(c.a)) - c.value];
      if (c.axis === 'vertical') return [Math.abs(gy(c.b) - gy(c.a)) - c.value];
      const dx = gx(c.b) - gx(c.a);
      const dy = gy(c.b) - gy(c.a);
      return [Math.hypot(dx, dy) - c.value];
    }
    case 'angle': {
      // Angle at vertex v between arms v->a and v->b equals value (degrees).
      const a1 = Math.atan2(gy(c.a) - gy(c.v), gx(c.a) - gx(c.v));
      const a2 = Math.atan2(gy(c.b) - gy(c.v), gx(c.b) - gx(c.v));
      const cur = Math.abs(angleWrap(a2 - a1)) * 180 / Math.PI;
      return [cur - c.value];
    }
    case 'distanceToPoint': {
      // Radius-style: distance from center point (cx,cy fixed) to vertex == value.
      const dx = gx(c.a) - c.cx;
      const dy = gy(c.a) - c.cy;
      return [Math.hypot(dx, dy) - c.value];
    }
    default:
      return [];
  }
}

/* Number of scalar residuals a constraint contributes (for sizing). */
function residualCount(c) {
  if (c.type === 'anchor') return 2;
  if (c.type === 'coincident') return 2;
  return 1;
}

/* ---- system assembly ------------------------------------------------------ */

export function buildSystem(vertices, constraints) {
  const n = vertices.length;
  const V = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    V[2 * i] = vertices[i].x;
    V[2 * i + 1] = vertices[i].y;
  }
  return { n, V, constraints: constraints.slice() };
}

/* Flatten all constraints into one residual vector for the current V. */
function residualVector(constraints, V) {
  const out = [];
  for (const c of constraints) {
    const r = constraintResiduals(c, V);
    for (const v of r) out.push(v);
  }
  return out;
}

/* Numeric Jacobian: rows = residuals, cols = 2N variables. Central differences
   are accurate enough at sketch scale and keep the residual definitions simple
   (no hand-derived analytic gradients to get wrong). */
function jacobian(constraints, V) {
  const m = constraints.reduce((s, c) => s + residualCount(c), 0);
  const nv = V.length;
  const J = Array.from({ length: m }, () => new Float64Array(nv));
  const h = 1e-5;
  for (let j = 0; j < nv; j++) {
    const orig = V[j];
    V[j] = orig + h;
    const rPlus = residualVector(constraints, V);
    V[j] = orig - h;
    const rMinus = residualVector(constraints, V);
    V[j] = orig;
    for (let i = 0; i < m; i++) {
      J[i][j] = (rPlus[i] - rMinus[i]) / (2 * h);
    }
  }
  return J;
}

/* Solve the normal equations (JᵀJ + λI) dx = -Jᵀr via Gaussian elimination.
   λ is the Levenberg–Marquardt damping that keeps the step stable when the
   system is rank-deficient (under-defined sketches have many such directions). */
function solveStep(J, r, lambda) {
  const m = J.length;
  const nv = m > 0 ? J[0].length : 0;
  if (nv === 0) return new Float64Array(0);
  // A = JᵀJ + λI  (nv x nv),  g = Jᵀr  (nv)
  const A = Array.from({ length: nv }, () => new Float64Array(nv));
  const g = new Float64Array(nv);
  for (let k = 0; k < nv; k++) {
    for (let l = 0; l < nv; l++) {
      let s = 0;
      for (let i = 0; i < m; i++) s += J[i][k] * J[i][l];
      A[k][l] = s;
    }
    A[k][k] += lambda;
    let gs = 0;
    for (let i = 0; i < m; i++) gs += J[i][k] * r[i];
    g[k] = gs;
  }
  // Solve A dx = -g.
  const dx = gaussSolve(A, g.map((v) => -v));
  return dx;
}

/* Dense linear solve with partial pivoting. Returns x for Ax=b (b passed in). */
function gaussSolve(A, b) {
  const n = A.length;
  const M = A.map((row, i) => Float64Array.from([...row, b[i]]));
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    }
    if (Math.abs(M[piv][col]) < 1e-12) continue; // singular column, skip
    [M[col], M[piv]] = [M[piv], M[col]];
    const pivVal = M[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / pivVal;
      if (f === 0) continue;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  const x = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const d = M[i][i];
    x[i] = Math.abs(d) < 1e-12 ? 0 : M[i][n] / d;
  }
  return x;
}

/* Levenberg–Marquardt solve, two-phase, returning the minimal-movement solution.

   Phase 1 drives the real constraint residuals to (near) zero with damped
   Gauss–Newton. Phase 2 reduces the distance to the seed configuration while
   staying on the constraint manifold: it takes steps along the seed-direction
   projected into the null space of the constraint Jacobian, then re-solves the
   constraints. This is what makes editing one dimension move only what it must
   and leave undimensioned-but-positioned geometry (like an unrelated diagonal)
   exactly where the user drew it — the SolidWorks "minimal change" behavior. */
export function solve(system, opts = {}) {
  const maxIter = opts.maxIter ?? 120;
  const tol = opts.tol ?? 1e-6;
  const V = Float64Array.from(system.V);
  const seed = Float64Array.from(system.V);
  const { constraints } = system;
  if (constraints.length === 0) {
    return { V, converged: true, residualNorm: 0, iterations: 0 };
  }

  const phase1 = (Vv) => {
    let lambda = 1e-3;
    let r = residualVector(constraints, Vv);
    let cost = norm(r);
    for (let it = 0; it < maxIter; it++) {
      if (cost < tol) break;
      const J = jacobian(constraints, Vv);
      let improved = false;
      for (let tryStep = 0; tryStep < 8; tryStep++) {
        const dx = solveStep(J, r, lambda);
        const Vt = Float64Array.from(Vv);
        for (let k = 0; k < Vt.length; k++) Vt[k] += dx[k];
        const rt = residualVector(constraints, Vt);
        const ct = norm(rt);
        if (ct < cost) {
          for (let k = 0; k < Vv.length; k++) Vv[k] = Vt[k];
          r = rt; cost = ct; lambda = Math.max(lambda * 0.5, 1e-9); improved = true; break;
        }
        lambda = Math.min(lambda * 4, 1e9);
      }
      if (!improved) break;
    }
    return cost;
  };

  let cost = phase1(V);

  // Phase 2: find the minimal-(weighted)-movement configuration on the
  // constraint manifold. We solve an augmented least-squares problem that adds
  // soft "stay at seed" rows (weighted by per-coordinate stiffness) on top of
  // the hard constraint rows, seeded FROM the phase-1 solution. The soft rows
  // have small weight so they never perturb the hard constraints noticeably,
  // but they break the tie among the infinitely many feasible configurations of
  // an under-defined sketch in favour of the one closest to where the user drew
  // it — keeping fixed-angle diagonals put (high stiffness) while orthogonal
  // walls absorb the change (unit stiffness). After this we run a final hard
  // cleanup so residuals are exactly zero without disturbing the chosen point.
  const stiff = opts.stiffness || null;
  if (cost < Math.max(tol * 50, 1e-4)) {
    const wScale = opts.seedWeight ?? 2e-3;
    const augResid = (Vv) => {
      const r = residualVector(constraints, Vv);
      for (let k = 0; k < Vv.length; k++) {
        const w = (stiff ? stiff[k] : 1) * wScale;
        r.push(w * (Vv[k] - seed[k]));
      }
      return r;
    };
    const augJac = (Vv) => {
      const J = jacobian(constraints, Vv);
      for (let k = 0; k < Vv.length; k++) {
        const w = (stiff ? stiff[k] : 1) * wScale;
        const row = new Float64Array(Vv.length);
        row[k] = w;
        J.push(row);
      }
      return J;
    };
    let lambda = 1e-3;
    let r = augResid(V);
    let acost = norm(r);
    for (let it = 0; it < maxIter; it++) {
      const J = augJac(V);
      let improved = false;
      for (let tryStep = 0; tryStep < 8; tryStep++) {
        const dx = solveStep(J, r, lambda);
        const Vt = Float64Array.from(V);
        for (let k = 0; k < Vt.length; k++) Vt[k] += dx[k];
        const rt = augResid(Vt);
        const ct = norm(rt);
        if (ct < acost) {
          for (let k = 0; k < V.length; k++) V[k] = Vt[k];
          r = rt; acost = ct; lambda = Math.max(lambda * 0.5, 1e-9); improved = true; break;
        }
        lambda = Math.min(lambda * 4, 1e9);
      }
      if (!improved) break;
    }
    // Final hard cleanup: drive real constraint residuals to ~0 from here.
    cost = phase1(V);
  }

  return { V, converged: cost < Math.max(tol * 50, 1e-4), residualNorm: cost, iterations: maxIter };
}

function norm(arr) {
  let s = 0;
  for (const v of arr) s += v * v;
  return Math.sqrt(s);
}

/* ---- degree-of-freedom analysis ------------------------------------------ */

/* Numeric rank of the constraint Jacobian via Gram–Schmidt with a tolerance.
   This counts the number of INDEPENDENT scalar constraints, which is what
   determines how many DOF are removed. */
export function constraintRank(constraints, V, tol = 1e-7) {
  const J = jacobian(constraints, V);
  return matrixRank(J, tol);
}

function matrixRank(rows, tol) {
  // Gram–Schmidt over the residual-gradient rows; count non-trivial rows.
  const basis = [];
  for (const rowSrc of rows) {
    const row = Float64Array.from(rowSrc);
    for (const b of basis) {
      const dot = dotF(row, b);
      for (let k = 0; k < row.length; k++) row[k] -= dot * b[k];
    }
    const len = Math.sqrt(dotF(row, row));
    if (len > tol) {
      for (let k = 0; k < row.length; k++) row[k] /= len;
      basis.push(row);
    }
  }
  return basis.length;
}

function dotF(a, b) {
  let s = 0;
  for (let k = 0; k < a.length; k++) s += a[k] * b[k];
  return s;
}

/* Full DOF status for a solved system. `groundDof` is the DOF inherently
   removed by anchoring (an anchor contributes 2 independent constraints, but
   we report status relative to the sketch's free motion). */
export function analyzeDOF(system, solved) {
  const V = solved ? solved.V : system.V;
  const totalDof = 2 * system.n;
  const rank = constraintRank(system.constraints, V);
  const remaining = totalDof - rank;
  let status;
  if (!solved || !solved.converged) status = 'over';
  else if (remaining <= 0) status = 'fully';
  else status = 'under';
  return { totalDof, rank, remaining, status };
}

/* ---- incremental constraint addition (SolidWorks conflict behavior) -------
   Test whether adding `candidate` to an already-solved set of constraints is
   admissible. It is a CONFLICT (over-defined) if either:
     (a) it adds no independent information — the Jacobian rank does not rise
         (redundant constraint, e.g. a 0° angle on an already-horizontal line); or
     (b) the system can no longer be solved with all residuals near zero
         (genuinely contradictory, e.g. two different widths on one edge).
   On conflict we DO NOT apply it; the caller keeps the prior geometry and flags
   the candidate red. */
export function tryAddConstraint(baseConstraints, candidate, vertices, opts = {}) {
  const tol = opts.tol ?? 1e-6;
  const sysBefore = buildSystem(vertices, baseConstraints);
  const solvedBefore = solve(sysBefore, opts);
  const rankBefore = constraintRank(baseConstraints, solvedBefore.V, tol);

  const withNew = [...baseConstraints, candidate];
  const sysAfter = buildSystem(vertices, withNew);
  const solvedAfter = solve(sysAfter, opts);
  const rankAfter = constraintRank(withNew, solvedAfter.V, tol);

  const addsInfo = rankAfter > rankBefore;
  const satisfiable = solvedAfter.converged && solvedAfter.residualNorm < Math.max(tol * 100, 1e-3);

  if (!addsInfo) {
    // The candidate adds no new degree of freedom — the geometry it measures is
    // already determined by the existing constraints. Whether that's harmless
    // depends on the VALUE: if the current geometry already matches the
    // requested value it's a benign reference/driven dimension; if it asks for a
    // different value than the locked geometry can take, it's a real conflict.
    const resBefore = constraintResiduals(candidate, solvedBefore.V);
    const agrees = resBefore.every((r) => Math.abs(r) < Math.max(tol * 1000, 1e-2));
    return {
      ok: false,
      conflict: true,
      solved: solvedBefore,
      reason: agrees ? 'redundant' : 'unsatisfiable',
    };
  }
  if (!satisfiable) {
    return { ok: false, conflict: true, solved: solvedBefore, reason: 'unsatisfiable' };
  }
  return { ok: true, conflict: false, solved: solvedAfter };
}

export const __test = { constraintResiduals, jacobian, matrixRank, norm };

/* Build a per-coordinate stiffness array (length 2N). Vertices that are
   endpoints of a fixed-angle (diagonal) edge are made stiff so the solver keeps
   them put when an unrelated edge is resized. Everything else is unit stiffness.
   This encodes the user's rule that undimensioned diagonals stay fixed and only
   axis-aligned/undimensioned orthogonal edges absorb size changes. */
export function buildStiffness(n, constraints, opts = {}) {
  const high = opts.high ?? 1000;
  const s = new Float64Array(2 * n).fill(1);
  for (const c of constraints) {
    if (c.type === 'fixedAngle') {
      for (const v of [c.a, c.b]) { s[2 * v] = high; s[2 * v + 1] = high; }
    }
  }
  return s;
}
