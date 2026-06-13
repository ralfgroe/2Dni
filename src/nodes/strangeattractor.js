// Strange Attractor generator: De Jong, Clifford (2D maps) and Lorenz (3D ODE
// projected to 2D). Outputs a dense point cloud or a connected polyline.
//
// For performance the iteration loop is paper.js-free: we compute raw points,
// then build the SVG path data string directly. Creating tens of thousands of
// paper.Path objects would be far too slow for live parameter tweaking.
//
// Presets (Classic, Swirl, Wings, ...) are applied in the parameter panel,
// which writes the coefficient values into the a/b/c/d params. That way the
// sliders reflect the preset and stay editable. See ATTRACTOR_PRESETS in
// src/components/parameters/ParameterPanel.jsx.

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

  // Coefficients come straight from the params. Presets are applied in the UI
  // (they write their values into a/b/c/d), so editing a slider after picking a
  // preset works as expected instead of being overridden here.
  const a = params.a ?? 1.4;
  const b = params.b ?? -2.3;
  const c = params.c ?? 2.4;
  const d = params.d ?? -2.1;

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
