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

// Parse a multi-subpath "M.. L.. M.. L.." pathData back into chains of points.
// Used to turn the solved skeleton (a booleanResult) back into wall chains so we
// can apply the Wall Style to the DRIVEN geometry.
export function pathDataToChains(pathData) {
  if (!pathData || typeof pathData !== 'string') return [];
  const chains = [];
  let current = null;
  // Tokenize into command letters and number pairs.
  const re = /([MLZ])|(-?\d*\.?\d+)/gi;
  let m;
  const nums = [];
  let cmd = null;
  const flush = () => {
    if (cmd === 'M' || cmd === 'L') {
      for (let i = 0; i + 1 < nums.length; i += 2) {
        const pt = { x: nums[i], y: nums[i + 1] };
        if (cmd === 'M' && i === 0) {
          current = [pt];
          chains.push(current);
        } else if (current) {
          current.push(pt);
        }
      }
    }
    nums.length = 0;
  };
  while ((m = re.exec(pathData)) !== null) {
    if (m[1]) {
      flush();
      cmd = m[1].toUpperCase();
      if (cmd === 'Z') {
        cmd = null;
      }
    } else if (m[2] != null) {
      nums.push(parseFloat(m[2]));
    }
  }
  flush();
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
