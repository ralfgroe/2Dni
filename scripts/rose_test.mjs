// Headless test for the planar region splitter using an 8-petal rose curve
// sampled directly as a polyline (no paper.js needed). A rose curve r = cos(k*t)
// with k=4 produces 8 petals that all meet at the origin; resolving its
// self-crossings should yield 8 petal-shaped interior faces.
//
// Run with the paper stub loader:
//   node --import ./scripts/loader.mjs scripts/rose_test.mjs

import { regionsFromPolylines } from '../src/utils/planarRegions.js';

function rosePolyline(k = 4, R = 100, steps = 2000) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    const rad = R * Math.cos(k * t);
    pts.push({ x: rad * Math.cos(t), y: rad * Math.sin(t) });
  }
  return pts;
}

const poly = rosePolyline(4, 100, 2000);
const regions = regionsFromPolylines([poly], { eps: 1.5, minArea: 5 });

const count = regions ? regions.length : 0;
console.log(`Rose (k=4) interior regions: ${count}`);

// 8 petals expected. Allow a small tolerance for the shared-origin junction.
const pass = count >= 7 && count <= 9;
console.log(pass ? `PASS: ~8 petals (${count})` : `FAIL: got ${count}, expected ~8`);
process.exit(pass ? 0 : 1);
