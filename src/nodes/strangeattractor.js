// Strange Attractor generator: De Jong, Clifford (2D maps) and Lorenz (3D ODE
// projected to 2D). Outputs a dense point cloud or a connected polyline.
//
// For performance the iteration loop is paper.js-free: we compute raw points,
// then build the SVG path data string directly. Creating tens of thousands of
// paper.Path objects would be far too slow for live parameter tweaking.

const PRESETS = {
  'De Jong': {
    Classic: { a: 1.4, b: -2.3, c: 2.4, d: -2.1 },
    Swirl: { a: -2.0, b: -2.0, c: -1.2, d: 2.0 },
    Wings: { a: 1.641, b: 1.902, c: 0.316, d: 1.525 },
    Web: { a: -2.7, b: -0.09, c: -0.65, d: -2.2 },
    Ribbon: { a: 2.01, b: -2.53, c: 1.61, d: -0.33 },
  },
  Clifford: {
    Classic: { a: -1.4, b: 1.6, c: 1.0, d: 0.7 },
    Swirl: { a: -1.7, b: 1.8, c: -1.9, d: -0.4 },
    Wings: { a: 1.5, b: -1.8, c: 1.6, d: 0.9 },
    Web: { a: -1.8, b: -2.0, c: -0.5, d: -0.9 },
    Ribbon: { a: -1.244, b: -1.251, c: -1.815, d: -1.908 },
  },
  Lorenz: {
    // a = sigma, b = rho, c = beta
    Classic: { a: 10, b: 28, c: 2.6667 },
    Swirl: { a: 10, b: 99.96, c: 2.6667 },
    Wings: { a: 14, b: 28, c: 2.6667 },
    Web: { a: 10, b: 28, c: 1.5 },
    Ribbon: { a: 16, b: 45.92, c: 4 },
  },
};

// De Jong map.
function iterateDeJong(a, b, c, d, n) {
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let x = 0.1, y = 0.1;
  for (let i = 0; i < n; i++) {
    const nx = Math.sin(a * y) - Math.cos(b * x);
    const ny = Math.sin(c * x) - Math.cos(d * y);
    x = nx; y = ny;
    xs[i] = x; ys[i] = y;
  }
  return { xs, ys };
}

// Clifford map.
function iterateClifford(a, b, c, d, n) {
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let x = 0.1, y = 0.1;
  for (let i = 0; i < n; i++) {
    const nx = Math.sin(a * y) + c * Math.cos(a * x);
    const ny = Math.sin(b * x) + d * Math.cos(b * y);
    x = nx; y = ny;
    xs[i] = x; ys[i] = y;
  }
  return { xs, ys };
}

// Lorenz system integrated with RK4, projected onto the X/Z plane (the classic
// butterfly view). Coordinates are normalized to roughly the unit-ish range so
// the shared Scale parameter behaves like the 2D maps.
function iterateLorenz(sigma, rho, beta, n) {
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  let x = 0.1, y = 0, z = 0;
  const dt = 0.005;
  const f = (s, r, bt, px, py, pz) => [
    s * (py - px),
    px * (r - pz) - py,
    px * py - bt * pz,
  ];
  for (let i = 0; i < n; i++) {
    const k1 = f(sigma, rho, beta, x, y, z);
    const k2 = f(sigma, rho, beta, x + (dt / 2) * k1[0], y + (dt / 2) * k1[1], z + (dt / 2) * k1[2]);
    const k3 = f(sigma, rho, beta, x + (dt / 2) * k2[0], y + (dt / 2) * k2[1], z + (dt / 2) * k2[2]);
    const k4 = f(sigma, rho, beta, x + dt * k3[0], y + dt * k3[1], z + dt * k3[2]);
    x += (dt / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    y += (dt / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    z += (dt / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
    // Project to X/Z, recenter Z, and scale down to ~unit range.
    xs[i] = x / 25;
    ys[i] = (z - rho) / 25;
  }
  return { xs, ys };
}

export function strangeAttractorRuntime(params) {
  const type = params.type ?? 'De Jong';
  const preset = params.preset ?? 'Custom';

  let a = params.a ?? 1.4;
  let b = params.b ?? -2.3;
  let c = params.c ?? 2.4;
  let d = params.d ?? -2.1;

  if (preset !== 'Custom' && PRESETS[type] && PRESETS[type][preset]) {
    const p = PRESETS[type][preset];
    a = p.a; b = p.b; c = p.c;
    if (p.d != null) d = p.d;
  }

  const n = Math.max(500, Math.min(100000, Math.round(params.iterations ?? 20000)));
  const render = params.render ?? 'Points';
  const dotSize = Math.max(0.05, params.dot_size ?? 0.6);
  const scale = params.scale ?? 180;
  const ox = params.x ?? 0;
  const oy = params.y ?? 0;
  const color = params.color ?? '#000000';
  const strokeWidth = params.stroke_width ?? 0.5;

  let pts;
  if (type === 'Clifford') pts = iterateClifford(a, b, c, d, n);
  else if (type === 'Lorenz') pts = iterateLorenz(a, b, c, n);
  else pts = iterateDeJong(a, b, c, d, n);

  const { xs, ys } = pts;

  // Map normalized coordinates to world space and track bounds. NaN/Inf can
  // occur for divergent coefficient combos; skip those points.
  const wx = new Float64Array(n);
  const wy = new Float64Array(n);
  let count = 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const px = ox + x * scale;
    const py = oy + y * scale;
    wx[count] = px;
    wy[count] = py;
    count++;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }

  if (count === 0) {
    return { type: 'error', message: 'Attractor diverged — try a preset or smaller coefficients.' };
  }

  // Build SVG path data directly for speed.
  let pathData;
  const round = (v) => Math.round(v * 100) / 100;

  if (render === 'Lines') {
    const parts = new Array(count);
    parts[0] = `M${round(wx[0])} ${round(wy[0])}`;
    for (let i = 1; i < count; i++) {
      parts[i] = `L${round(wx[i])} ${round(wy[i])}`;
    }
    pathData = parts.join('');
  } else {
    // Points: render each point as a filled circle centered on it. A full
    // circle in path data is two semicircle arcs. Dot Size is the diameter.
    const r = round(dotSize / 2);
    const r2 = round(dotSize);
    const parts = new Array(count);
    for (let i = 0; i < count; i++) {
      const cy = round(wy[i]);
      const left = round(wx[i] - dotSize / 2);
      // Start at the left edge, arc to the right edge, then back to the start.
      parts[i] = `M${left} ${cy}a${r} ${r} 0 1 0 ${r2} 0a${r} ${r} 0 1 0 ${-r2} 0Z`;
    }
    pathData = parts.join('');
  }

  const isPoints = render === 'Points';

  return {
    type: 'booleanResult',
    pathData,
    fill: isPoints ? color : 'none',
    stroke: isPoints ? 'none' : color,
    strokeWidth: isPoints ? 0 : strokeWidth,
    bounds: {
      x: minX,
      y: minY,
      width: maxX - minX || 1,
      height: maxY - minY || 1,
    },
  };
}
