// Headless test of the planar face-tracing core, independent of paper.js.
// We hand-build the planar graph for a pentagram (5-point star) which, when
// its self-crossings are resolved, encloses 1 central pentagon + 5 triangular
// points = 6 interior faces. This validates the cycle-tracing + outer-face
// rejection logic used by splitIntoRegions().

function signedArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

function traceFaces(verts, edges) {
  const adj = verts.map(() => []);
  for (const [a, b] of edges) { adj[a].push(b); adj[b].push(a); }
  const angleOf = (from, to) =>
    Math.atan2(verts[to].y - verts[from].y, verts[to].x - verts[from].x);
  const visited = new Set();
  const faces = [];
  for (const [a, b] of edges) {
    for (const [u0, v0] of [[a, b], [b, a]]) {
      if (visited.has(`${u0}->${v0}`)) continue;
      const face = [];
      let u = u0, v = v0, guard = 0;
      const maxSteps = edges.length * 4 + 10;
      while (guard++ < maxSteps) {
        visited.add(`${u}->${v}`);
        face.push(u);
        const incoming = angleOf(v, u);
        let best = null, bestTurn = Infinity;
        for (const w of adj[v]) {
          if (w === u && adj[v].length > 1) continue;
          const out = angleOf(v, w);
          let turn = incoming - out;
          while (turn <= 0) turn += Math.PI * 2;
          while (turn > Math.PI * 2) turn -= Math.PI * 2;
          if (turn < bestTurn) { bestTurn = turn; best = w; }
        }
        if (best === null) best = u;
        u = v; v = best;
        if (u === u0 && v === v0) break;
      }
      if (face.length >= 3) faces.push(face);
    }
  }
  return faces;
}

// Build a pentagram's resolved planar graph.
// Outer points P0..P4 (star tips) and inner pentagon points I0..I4.
function pentagramGraph() {
  const R = 100, r = 38.2; // tip radius and inner-pentagon radius
  const verts = [];
  const tips = [], inner = [];
  for (let i = 0; i < 5; i++) {
    const aTip = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
    tips.push(verts.length);
    verts.push({ x: R * Math.cos(aTip), y: R * Math.sin(aTip) });
  }
  for (let i = 0; i < 5; i++) {
    const aIn = -Math.PI / 2 + Math.PI / 5 + (i * 2 * Math.PI) / 5;
    inner.push(verts.length);
    verts.push({ x: r * Math.cos(aIn), y: r * Math.sin(aIn) });
  }
  // Each tip connects to its two adjacent inner vertices; inner vertices form
  // the central pentagon by being shared between tips.
  const edges = [];
  for (let i = 0; i < 5; i++) {
    edges.push([tips[i], inner[i]]);
    edges.push([tips[i], inner[(i + 4) % 5]]);
  }
  // central pentagon edges (between consecutive inner vertices)
  for (let i = 0; i < 5; i++) edges.push([inner[i], inner[(i + 1) % 5]]);
  return { verts, edges };
}

const { verts, edges } = pentagramGraph();
const faces = traceFaces(verts, edges);

const interior = faces
  .map((f) => ({ f, area: signedArea(f.map((id) => verts[id])) }))
  .filter((o) => Math.abs(o.area) > 1 && o.area > 0);

console.log(`Total traced faces: ${faces.length}`);
console.log(`Interior (positively-oriented) faces: ${interior.length}`);
const sizes = interior.map((o) => o.f.length).sort();
console.log(`Interior face vertex counts: [${sizes.join(', ')}]`);

const pentagons = sizes.filter((n) => n === 5).length;
const triangles = sizes.filter((n) => n === 3).length;
const pass = pentagons === 1 && triangles === 5;
console.log(pass ? 'PASS: 1 pentagon + 5 triangles' : `FAIL: pentagons=${pentagons} triangles=${triangles}`);
process.exit(pass ? 0 : 1);
