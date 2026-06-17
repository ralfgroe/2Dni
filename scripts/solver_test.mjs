// Headless tests for the geometric constraint solver. Run:
//   node scripts/solver_test.mjs
// These exercise the SolidWorks-style behavior directly on {vertices,constraints}
// so the core is proven before any UI touches it.

import { buildSystem, solve, analyzeDOF, tryAddConstraint, buildStiffness } from '../src/nodes/constraintSolver.js';

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  ok   ${name}`);
  else { console.log(`  FAIL ${name}${detail !== undefined ? `  (${JSON.stringify(detail)})` : ''}`); failures++; }
}
function near(a, b, tol = 0.5) { return Math.abs(a - b) <= tol; }
function vx(V, i) { return V[2 * i]; }
function vy(V, i) { return V[2 * i + 1]; }

// Implicit per-edge relations: every edge gets H, V, or fixedAngle based on how
// it was drawn. This mirrors what dimension.js will auto-generate.
function implicitRelations(verts, edges) {
  const out = [];
  for (const [a, b] of edges) {
    const dx = verts[b].x - verts[a].x;
    const dy = verts[b].y - verts[a].y;
    if (Math.abs(dy) < 1e-6 && Math.abs(dx) > 1e-6) out.push({ type: 'horizontal', a, b, _edge: [a, b], _implicit: true });
    else if (Math.abs(dx) < 1e-6 && Math.abs(dy) > 1e-6) out.push({ type: 'vertical', a, b, _edge: [a, b], _implicit: true });
    else out.push({ type: 'fixedAngle', a, b, theta0: Math.atan2(dy, dx), _edge: [a, b], _implicit: true });
  }
  return out;
}

// Drop the implicit DIRECTION relation for an edge only when an explicit
// directional relation (H/V/angle) governs it. Distance dims never supersede.
function supersede(implicit, explicitEdges) {
  const keyset = new Set(explicitEdges.map(([a, b]) => `${Math.min(a, b)}-${Math.max(a, b)}`));
  return implicit.filter((r) => !keyset.has(`${Math.min(r._edge[0], r._edge[1])}-${Math.max(r._edge[0], r._edge[1])}`));
}
void supersede;

console.log('TEST 1: rectangle width 100 -> 150 stays a rectangle');
{
  const verts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
  const imp = implicitRelations(verts, edges);
  const cons = [
    { type: 'anchor', v: 0, x: 0, y: 0 },
    ...imp,
    { type: 'distance', a: 0, b: 1, axis: 'horizontal', value: 150 },
  ];
  const sys = buildSystem(verts, cons);
  const s = solve(sys);
  check('converged', s.converged, s.residualNorm);
  check('width = 150', near(vx(s.V, 1) - vx(s.V, 0), 150), vx(s.V, 1) - vx(s.V, 0));
  check('height still 60', near(vy(s.V, 3) - vy(s.V, 0), 60), vy(s.V, 3) - vy(s.V, 0));
  check('top edge horizontal', near(vy(s.V, 0), vy(s.V, 1), 0.1));
  check('right edge vertical', near(vx(s.V, 1), vx(s.V, 2), 0.1));
}

console.log('\nTEST 2: L-shape top wall set, walls stay orthogonal');
{
  // 6-vertex L
  const verts = [
    { x: 0, y: 0 }, { x: 254, y: 0 }, { x: 254, y: 103 },
    { x: 103, y: 103 }, { x: 103, y: 257 }, { x: 0, y: 257 },
  ];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]];
  const imp = implicitRelations(verts, edges);
  const cons = [
    { type: 'anchor', v: 0, x: 0, y: 0 },
    ...imp,
    { type: 'distance', a: 0, b: 1, axis: 'horizontal', value: 300 },
  ];
  const sys = buildSystem(verts, cons);
  const s = solve(sys);
  check('converged', s.converged, s.residualNorm);
  check('top wall = 300', near(vx(s.V, 1) - vx(s.V, 0), 300), vx(s.V, 1) - vx(s.V, 0));
  check('right wall vertical', near(vx(s.V, 1), vx(s.V, 2), 0.1), [vx(s.V, 1), vx(s.V, 2)]);
  check('top wall horizontal', near(vy(s.V, 0), vy(s.V, 1), 0.1));
}

console.log('\nTEST 3: NOTCH + DIAGONAL — the bug that beat us');
{
  // TL(0,0) TR(500,0) diagonal->(700,300) step-left(250,300) down(250,400) BL(0,400)
  const verts = [
    { x: 0, y: 0 }, { x: 500, y: 0 }, { x: 700, y: 300 },
    { x: 250, y: 300 }, { x: 250, y: 400 }, { x: 0, y: 400 },
  ];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 0]];
  const imp = implicitRelations(verts, edges);
  // Distance dims do NOT remove direction relations (a dimensioned horizontal
  // wall is still horizontal). Only explicit H/V/angle relations supersede.
  const cons = [
    { type: 'anchor', v: 0, x: 0, y: 0 },
    ...imp,
    { type: 'distance', a: 0, b: 1, axis: 'horizontal', value: 500 },
    { type: 'distance', a: 2, b: 3, axis: 'horizontal', value: 300 },
  ];
  const sys = buildSystem(verts, cons);
  const s = solve(sys, { stiffness: buildStiffness(verts.length, cons) });
  check('converged', s.converged, s.residualNorm);
  // The diagonal endpoint v2 must NOT move (its angle is implicitly fixed and
  // it is not dimensioned). The step width should change via the bottom wall.
  check('diagonal top v1 fixed (500,0)', near(vx(s.V, 1), 500, 1) && near(vy(s.V, 1), 0, 1), [vx(s.V, 1), vy(s.V, 1)]);
  check('diagonal bottom v2 fixed (700,300)', near(vx(s.V, 2), 700, 1) && near(vy(s.V, 2), 300, 1), [vx(s.V, 2), vy(s.V, 2)]);
  check('step width = 300', near(vx(s.V, 2) - vx(s.V, 3), 300, 1), vx(s.V, 2) - vx(s.V, 3));
  check('top width = 500', near(vx(s.V, 1) - vx(s.V, 0), 500, 1), vx(s.V, 1) - vx(s.V, 0));
}

console.log('\nTEST 4: over-defined — second conflicting width on same edge flagged');
{
  const verts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
  const imp = implicitRelations(verts, edges);
  const base = [
    { type: 'anchor', v: 0, x: 0, y: 0 },
    ...imp,
    { type: 'distance', a: 0, b: 1, axis: 'horizontal', value: 150 },
  ];
  // Add a SECOND, different width on the same edge -> contradiction.
  const candidate = { type: 'distance', a: 0, b: 1, axis: 'horizontal', value: 200 };
  const res = tryAddConstraint(base, candidate, verts);
  check('second width flagged as conflict', res.conflict === true, res.reason);
  // The kept (prior) geometry should still satisfy the first width.
  check('first width still 150', near(vx(res.solved.V, 1) - vx(res.solved.V, 0), 150), vx(res.solved.V, 1) - vx(res.solved.V, 0));
}

console.log('\nTEST 5: redundant relation (0° on horizontal edge) flagged');
{
  const verts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
  const imp = implicitRelations(verts, edges);
  const base = [{ type: 'anchor', v: 0, x: 0, y: 0 }, ...imp];
  // Adding an explicit 'horizontal' on edge 0-1 (already implicitly horizontal)
  // adds no independent info.
  const candidate = { type: 'horizontal', a: 0, b: 1 };
  const res = tryAddConstraint(base, candidate, verts);
  check('redundant horizontal flagged', res.conflict === true, res.reason);
}

console.log('\nTEST 6: DOF status — under vs fully defined');
{
  const verts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 60 }, { x: 0, y: 60 }];
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0]];
  const imp = implicitRelations(verts, edges);
  // Anchor + all H/V relations but NO size dim -> still free to scale -> under.
  const under = [{ type: 'anchor', v: 0, x: 0, y: 0 }, ...imp];
  const sysU = buildSystem(verts, under);
  const sU = solve(sysU);
  const dofU = analyzeDOF(sysU, sU);
  check('under-defined reports under', dofU.status === 'under', dofU);
  // Add width + height -> fully defined.
  const full = [...under,
    { type: 'distance', a: 0, b: 1, axis: 'horizontal', value: 100 },
    { type: 'distance', a: 1, b: 2, axis: 'vertical', value: 60 }];
  const sysF = buildSystem(verts, full);
  const sF = solve(sysF);
  const dofF = analyzeDOF(sysF, sF);
  check('fully-constrained reports fully', dofF.status === 'fully', dofF);
}

console.log('\nTEST 7: angle dim opens corner without translating the whole shape');
{
  // Right angle at v1; arms v1->v0 and v1->v2. Open to 120°.
  const verts = [{ x: 0, y: 100 }, { x: 0, y: 0 }, { x: 100, y: 0 }];
  const cons = [
    { type: 'anchor', v: 1, x: 0, y: 0 },
    { type: 'fixedAngle', a: 1, b: 0, theta0: Math.atan2(100, 0) }, // arm A reference (up)
    { type: 'distance', a: 1, b: 0, axis: 'aligned', value: 100 },
    { type: 'distance', a: 1, b: 2, axis: 'aligned', value: 100 },
    { type: 'angle', v: 1, a: 0, b: 2, value: 120 },
  ];
  const sys = buildSystem(verts, cons);
  const s = solve(sys);
  check('converged', s.converged, s.residualNorm);
  const a1 = Math.atan2(vy(s.V, 0) - vy(s.V, 1), vx(s.V, 0) - vx(s.V, 1));
  const a2 = Math.atan2(vy(s.V, 2) - vy(s.V, 1), vx(s.V, 2) - vx(s.V, 1));
  let deg = Math.abs((a2 - a1) * 180 / Math.PI);
  if (deg > 180) deg = 360 - deg;
  check('angle now 120°', near(deg, 120, 1), deg);
  check('vertex v1 stayed at origin', near(vx(s.V, 1), 0, 0.5) && near(vy(s.V, 1), 0, 0.5));
}

console.log('');
if (failures === 0) console.log('ALL TESTS PASSED');
else { console.log(`${failures} TEST(S) FAILED`); process.exit(1); }
