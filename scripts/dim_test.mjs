// Comprehensive headless tests for the REAL dimension runtime. Run with:
//   node --experimental-loader ./scripts/loader.mjs scripts/dim_test.mjs
import paper from 'paper';

// The app modules call paper.setup(document.createElement('canvas')) guarded by
// `typeof document !== 'undefined'`. Provide a no-op document so that guard is
// satisfied, then ensure a real project exists for path math.
globalThis.document = { createElement: () => ({ getContext: () => null }) };
paper.setup(new paper.Size(2000, 2000));

const dim = await import('../src/nodes/dimension.js');
const { extractPoints } = await import('../src/utils/geometryPoints.js');
const { driveGeometry, measureDimension, dimensionRuntime } = dim;

let failures = 0;
const near = (a, b, tol = 0.5) => Math.abs(a - b) <= tol;
function check(name, cond, extra) {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}`, extra ?? ''); }
}

const L = () => ({
  type: 'booleanResult',
  pathData: 'M0,0 L254,0 L254,103 L103,103 L103,257 L0,257 Z',
  fill: '#fff', stroke: '#000', strokeWidth: 2,
  bounds: { x: 0, y: 0, width: 254, height: 257 },
});
const RECT = () => ({
  type: 'rect', x: 0, y: 0, width: 100, height: 60,
  fill: '#fff', stroke: '#000', strokeWidth: 2,
  bounds: { x: 0, y: 0, width: 100, height: 60 },
});
const CIRCLE = () => ({
  type: 'ellipse', cx: 50, cy: 50, rx: 30, ry: 30,
  fill: '#fff', stroke: '#000', strokeWidth: 2,
  bounds: { x: 20, y: 20, width: 60, height: 60 },
});

function vertsOf(geo) {
  const g = geo.type === 'group' ? geo.children[0] : geo;
  return extractPoints(g);
}
function isVertical(pa, pb) { return Math.abs(pa.x - pb.x) < 0.5; }
function isHorizontal(pa, pb) { return Math.abs(pa.y - pb.y) < 0.5; }

console.log('TEST 1: rectangle horizontal width 100 -> 150 (rigid, stays a rect)');
{
  const d = { id: 'd1', kind: 'linear', axis: 'horizontal', value: 150, a: 0, b: 1, ax: 0, ay: 0, bx: 100, by: 0 };
  const out = driveGeometry(RECT(), [d]);
  const v = vertsOf(out);
  check('measured width = 150', near(measureDimension(out, d), 150), measureDimension(out, d));
  // All four corners present, still axis-aligned rectangle of width 150 x 60.
  const xs = v.map((p) => p.x).sort((a, b) => a - b);
  const ys = v.map((p) => p.y).sort((a, b) => a - b);
  check('width spans 0..150', near(xs[0], 0) && near(xs[xs.length - 1], 150), xs);
  check('height still 0..60', near(ys[0], 0) && near(ys[ys.length - 1], 60), ys);
}

console.log('\nTEST 2: L-shape top wall 254 -> 300 (walls stay orthogonal)');
{
  const d = { id: 'd1', kind: 'linear', axis: 'horizontal', value: 300, a: 0, b: 1, ax: 0, ay: 0, bx: 254, by: 0 };
  const out = driveGeometry(L(), [d]);
  const v = vertsOf(out);
  console.log('  verts:', v.map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' '));
  check('measured top wall = 300', near(measureDimension(out, d), 300), measureDimension(out, d));
  // Right wall = v[1]->v[2] must stay vertical (the warp bug made it diagonal).
  check('right wall vertical (no warp)', isVertical(v[1], v[2]), `${JSON.stringify(v[1])} ${JSON.stringify(v[2])}`);
  check('top wall horizontal', isHorizontal(v[0], v[1]));
  check('6 vertices preserved', v.length === 6, v.length);
}

console.log('\nTEST 3: L-shape two dims compose (top 300, then right wall vertical 103 -> 150)');
{
  const d1 = { id: 'd1', kind: 'linear', axis: 'horizontal', value: 300, a: 0, b: 1, ax: 0, ay: 0, bx: 254, by: 0 };
  // After d1, vertex 1 and 2 moved to x=300. The right wall is verts 1->2.
  const d2 = { id: 'd2', kind: 'linear', axis: 'vertical', value: 150, a: 1, b: 2, ax: 300, ay: 0, bx: 300, by: 103 };
  const out = driveGeometry(L(), [d1, d2]);
  const v = vertsOf(out);
  console.log('  verts:', v.map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' '));
  check('top wall still 300', near(measureDimension(out, d1), 300), measureDimension(out, d1));
  check('right wall = 150', near(measureDimension(out, d2), 150), measureDimension(out, d2));
  check('right wall still vertical', isVertical(v[1], v[2]));
  check('top wall still horizontal', isHorizontal(v[0], v[1]));
}

console.log('\nTEST 4: circle -> ellipse via two linear dims');
{
  const dh = { id: 'dh', kind: 'linear', axis: 'horizontal', value: 100, a: 0, b: 1, ax: 20, ay: 50, bx: 80, by: 50 };
  const dv = { id: 'dv', kind: 'linear', axis: 'vertical', value: 80, a: 0, b: 1, ax: 50, ay: 20, bx: 50, by: 80 };
  const out = driveGeometry(CIRCLE(), [dh, dv]);
  const g = out.type === 'group' ? out.children[0] : out;
  const b = g.bounds;
  check('ellipse width ~100', near(b.width, 100, 2), b.width);
  check('ellipse height ~80', near(b.height, 80, 2), b.height);
}

console.log('\nTEST 5: angle drive updates + annotation matches (corner of L, 90 -> 120)');
{
  // Inner corner of the L at (103,103): arms go to (254,103) and (103,257).
  const d = {
    id: 'da', kind: 'angle', value: 120,
    v: 3, a: 2, b: 4,
    vx: 103, vy: 103, ax: 254, ay: 103, bx: 103, by: 257,
  };
  const out = driveGeometry(L(), [d]);
  const measured = measureDimension(out, d);
  check('measured angle = 120', near(measured, 120, 0.5), measured);
  // Idempotency: re-driving with value already met shouldn't keep rotating.
  const out2 = driveGeometry(out, [{ ...d }]);
  check('angle stable on re-drive', near(measureDimension(out2, d), 120, 0.5), measureDimension(out2, d));
}

console.log('\nTEST 6: full runtime returns a group with driven geo + annotation');
{
  const params = { dimensions: JSON.stringify([
    { id: 'd1', kind: 'linear', axis: 'horizontal', value: 300, a: 0, b: 1, ax: 0, ay: 0, bx: 254, by: 0 },
  ]), show_dimensions: true };
  const out = dimensionRuntime(params, { geometry_in: L() });
  check('runtime returns group', out && out.type === 'group', out?.type);
  check('group has driven geo + 1 annotation', out.children.length === 2, out.children.length);
  const ann = out.children[1];
  check('annotation has dimension lines', ann.type === 'dimAnnotation' && ann.lines.length >= 3, ann.lines?.length);
  // Witness line endpoints should sit on the driven corners (x=0 and x=300).
  const xsTouch = ann.lines.flatMap((l) => [l[0], l[2]]);
  check('witness touches x=0', xsTouch.some((x) => near(x, 0)), xsTouch);
  check('witness touches x=300', xsTouch.some((x) => near(x, 300)), xsTouch);
}

console.log('\nTEST 7: vertical relation locks a tilted edge upright');
{
  // A slanted quad: top edge from (0,0) to (100,20). Lock the right edge
  // (100,20)->(100,80)?? Instead lock the top-left wall vertical.
  const tilted = {
    type: 'booleanResult',
    pathData: 'M0,0 L100,20 L130,120 L0,100 Z',
    fill: '#fff', stroke: '#000', strokeWidth: 2,
    bounds: { x: 0, y: 0, width: 130, height: 120 },
  };
  // Lock the right edge v1(100,20)->v2(130,120) to vertical.
  const rel = { id: 'r1', kind: 'relation', relation: 'vertical', a: 1, b: 2, ax: 100, ay: 20, bx: 130, by: 120 };
  const out = driveGeometry(tilted, [rel]);
  const v = vertsOf(out);
  console.log('  verts:', v.map((p) => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(' '));
  check('right edge now vertical', isVertical(v[1], v[2]), `${JSON.stringify(v[1])} ${JSON.stringify(v[2])}`);
  check('relation residual ~0', near(measureDimension(out, rel), 0, 1), measureDimension(out, rel));
}

console.log('\nTEST 8: conflicting dims flagged (two widths that disagree)');
{
  const d1 = { id: 'w1', kind: 'linear', axis: 'horizontal', value: 150, a: 0, b: 1, ax: 0, ay: 0, bx: 100, by: 0 };
  // Second dim on the SAME top edge demanding a different width -> conflict.
  const d2 = { id: 'w2', kind: 'linear', axis: 'horizontal', value: 250, a: 0, b: 1, ax: 0, ay: 0, bx: 100, by: 0 };
  const res = dim.solveDimensions(RECT(), [d1, d2]);
  // d2 is applied last so it wins (width 250); d1 (150) can't be satisfied.
  console.log('  conflicts:', [...res.conflicts]);
  check('exactly one conflict flagged', res.conflicts.size === 1, [...res.conflicts]);
  check('the unsatisfied dim (w1) is flagged', res.conflicts.has('w1'), [...res.conflicts]);
}

console.log('\nTEST 9: consistent dims produce NO conflicts');
{
  const d1 = { id: 'a1', kind: 'linear', axis: 'horizontal', value: 300, a: 0, b: 1, ax: 0, ay: 0, bx: 254, by: 0 };
  const d2 = { id: 'a2', kind: 'linear', axis: 'vertical', value: 150, a: 1, b: 2, ax: 300, ay: 0, bx: 300, by: 103 };
  const res = dim.solveDimensions(L(), [d1, d2]);
  console.log('  conflicts:', [...res.conflicts]);
  check('no conflicts for compatible dims', res.conflicts.size === 0, [...res.conflicts]);
}

console.log('');
if (failures === 0) console.log('ALL TESTS PASSED');
else { console.log(`${failures} TEST(S) FAILED`); process.exit(1); }
