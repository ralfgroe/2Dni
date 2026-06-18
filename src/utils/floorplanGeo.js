// Shared geometry helpers for the Floorplan node, used by both the runtime
// (src/nodes/floorplan.js) and the viewport overlay
// (src/components/viewport/FloorplanOverlay.jsx) so that the centerline vertex
// order is identical on both sides — this is what keeps dimension pick indices
// and solved-vertex indices in agreement.

export function parseChains(raw) {
  let chains;
  try {
    chains = JSON.parse(raw ?? '[]');
  } catch {
    return [];
  }
  if (!Array.isArray(chains)) return [];
  return chains
    .filter((c) => Array.isArray(c))
    .map((c) => c.filter((p) => p && typeof p.x === 'number' && typeof p.y === 'number'));
}

export function validChains(chains) {
  return chains.filter((c) => c.length >= 2);
}

function num(n) {
  return Math.round(n * 1000) / 1000;
}

// Centerline: one open "M.. L.." run per chain, runs joined by spaces. This is
// the canonical dimensionable form — the multi-subpath order matches geoToSketch.
export function chainsToCenterlinePathData(chains) {
  const runs = [];
  for (const chain of chains) {
    if (chain.length < 2) continue;
    const cmds = [`M${num(chain[0].x)},${num(chain[0].y)}`];
    for (let i = 1; i < chain.length; i++) {
      cmds.push(`L${num(chain[i].x)},${num(chain[i].y)}`);
    }
    runs.push(cmds.join(' '));
  }
  return runs.join(' ');
}

// Parse a multi-subpath SVG path back into chains of absolute points. Handles
// the absolute and relative line/move commands that paper.js emits (M/m, L/l,
// H/h, V/v, Z/z). Floorplan walls are pure polylines, so curve commands aren't
// expected; if present, their endpoints are still captured.
export function pathDataToChains(pathData) {
  if (!pathData || typeof pathData !== 'string') return [];
  const chains = [];
  let current = null;
  let cx = 0, cy = 0;          // current point
  let startX = 0, startY = 0;  // subpath start (for Z)

  // Tokenize: command letters and numbers (incl. signs / exponents / decimals).
  const tokens = pathData.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!tokens) return [];

  let i = 0;
  let cmd = null;
  const num = () => parseFloat(tokens[i++]);
  const isCmd = (t) => /^[a-zA-Z]$/.test(t);

  while (i < tokens.length) {
    if (isCmd(tokens[i])) { cmd = tokens[i++]; }
    else if (cmd == null) { i++; continue; }

    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();

    if (C === 'M') {
      let x = num(), y = num();
      if (rel) { x += cx; y += cy; }
      cx = x; cy = y; startX = x; startY = y;
      current = [{ x, y }];
      chains.push(current);
      // Subsequent implicit pairs after M are treated as L.
      cmd = rel ? 'l' : 'L';
    } else if (C === 'L') {
      let x = num(), y = num();
      if (rel) { x += cx; y += cy; }
      cx = x; cy = y;
      if (current) current.push({ x, y });
    } else if (C === 'H') {
      let x = num();
      if (rel) x += cx;
      cx = x;
      if (current) current.push({ x: cx, y: cy });
    } else if (C === 'V') {
      let y = num();
      if (rel) y += cy;
      cy = y;
      if (current) current.push({ x: cx, y: cy });
    } else if (C === 'Z') {
      cx = startX; cy = startY;
      // Close: don't append (the band/centerline builders handle closure); a
      // closed wall keeps its existing points.
    } else if (C === 'C') {
      // Cubic bezier: skip control points, take the endpoint.
      num(); num(); num(); num();
      let x = num(), y = num();
      if (rel) { x += cx; y += cy; }
      cx = x; cy = y;
      if (current) current.push({ x, y });
    } else if (C === 'Q') {
      num(); num();
      let x = num(), y = num();
      if (rel) { x += cx; y += cy; }
      cx = x; cy = y;
      if (current) current.push({ x, y });
    } else {
      // Unknown command token — bail to avoid an infinite loop.
      i++;
    }
  }
  return chains.filter((c) => c.length >= 2);
}

export function chainsBounds(chains) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const chain of chains) {
    for (const p of chain) {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
  }
  return { minX, minY, maxX, maxY };
}

// Offset one side of a polyline by `dist` using simple miter joins. `dist` may
// be negative for the other side.
function offsetSide(pts, dist) {
  const n = pts.length;
  const out = [];
  const normals = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1].x - pts[i].x;
    const dy = pts[i + 1].y - pts[i].y;
    const len = Math.hypot(dx, dy) || 1;
    normals.push({ x: -dy / len, y: dx / len });
  }
  for (let i = 0; i < n; i++) {
    if (i === 0) {
      out.push({ x: pts[i].x + normals[0].x * dist, y: pts[i].y + normals[0].y * dist });
    } else if (i === n - 1) {
      const nm = normals[n - 2];
      out.push({ x: pts[i].x + nm.x * dist, y: pts[i].y + nm.y * dist });
    } else {
      const a = normals[i - 1];
      const b = normals[i];
      let mx = a.x + b.x;
      let my = a.y + b.y;
      const mlen = Math.hypot(mx, my);
      if (mlen < 1e-6) {
        mx = b.x; my = b.y;
      } else {
        mx /= mlen; my /= mlen;
      }
      const cos = mx * a.x + my * a.y;
      const scale = Math.abs(cos) > 0.2 ? 1 / cos : 5;
      out.push({ x: pts[i].x + mx * dist * scale, y: pts[i].y + my * dist * scale });
    }
  }
  return out;
}

// Closed filled band around an open centerline polyline (double-line wall).
export function bandPathForChain(chain, half) {
  if (chain.length < 2) return null;
  const left = offsetSide(chain, half);
  const right = offsetSide(chain, -half);
  const ring = [...left, ...right.slice().reverse()];
  const cmds = [`M${num(ring[0].x)},${num(ring[0].y)}`];
  for (let i = 1; i < ring.length; i++) {
    cmds.push(`L${num(ring[i].x)},${num(ring[i].y)}`);
  }
  cmds.push('Z');
  return cmds.join(' ');
}
