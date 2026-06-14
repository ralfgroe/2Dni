// Reaction-Diffusion (Gray-Scott) node.
//
// Runs a small Gray-Scott reaction-diffusion simulation on a grid, then runs
// marching squares on the resulting chemical concentration field to extract
// smooth iso-contours as vector paths. Produces classic Turing patterns:
// spots, stripes, coral / mazes, mitosis, etc.
//
// The sim is the heavy part. We keep the grid modest (default 120x120) and the
// step count bounded so live tweaking stays responsive. Everything here is
// plain typed-array math (no paper.js) for speed; we only build SVG path data
// strings at the end.

// ---- Gray-Scott simulation ---------------------------------------------------

// One simulation producing a Float32Array of V concentrations (the "pattern"
// chemical), normalized roughly to 0..1.
function simulate(width, height, opts) {
  const { feed, kill, dU, dV, steps, seed, seedDensity } = opts;
  const size = width * height;

  let u = new Float32Array(size);
  let v = new Float32Array(size);
  let u2 = new Float32Array(size);
  let v2 = new Float32Array(size);

  u.fill(1);
  // v stays 0 everywhere except the seed.

  // Deterministic PRNG so a given seed value reproduces the same pattern.
  let s = (seed | 0) * 1973 + 9277;
  const rand = () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };

  // Seed: scatter small square blobs of V across the whole grid to kick the
  // reaction off. Blob count scales with grid area so patterns reliably fill
  // the canvas regardless of resolution.
  const blobs = Math.max(8, Math.round((size / 700) * seedDensity));
  for (let bcount = 0; bcount < blobs; bcount++) {
    const bx = Math.floor(rand() * width);
    const by = Math.floor(rand() * height);
    const r = 3 + Math.floor(rand() * 4);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = bx + dx;
        const y = by + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const idx = y * width + x;
        u[idx] = 0.5;
        v[idx] = 0.25;
      }
    }
  }

  const dt = 1.0;

  for (let step = 0; step < steps; step++) {
    for (let y = 0; y < height; y++) {
      const yUp = y === 0 ? height - 1 : y - 1;
      const yDn = y === height - 1 ? 0 : y + 1;
      const rowC = y * width;
      const rowU = yUp * width;
      const rowD = yDn * width;
      for (let x = 0; x < width; x++) {
        const xL = x === 0 ? width - 1 : x - 1;
        const xR = x === width - 1 ? 0 : x + 1;
        const i = rowC + x;

        // 9-point Laplacian (with the standard Gray-Scott weights).
        const uVal = u[i];
        const vVal = v[i];

        const lapU =
          u[rowU + x] * 0.2 +
          u[rowD + x] * 0.2 +
          u[rowC + xL] * 0.2 +
          u[rowC + xR] * 0.2 +
          u[rowU + xL] * 0.05 +
          u[rowU + xR] * 0.05 +
          u[rowD + xL] * 0.05 +
          u[rowD + xR] * 0.05 -
          uVal;

        const lapV =
          v[rowU + x] * 0.2 +
          v[rowD + x] * 0.2 +
          v[rowC + xL] * 0.2 +
          v[rowC + xR] * 0.2 +
          v[rowU + xL] * 0.05 +
          v[rowU + xR] * 0.05 +
          v[rowD + xL] * 0.05 +
          v[rowD + xR] * 0.05 -
          vVal;

        const uvv = uVal * vVal * vVal;
        u2[i] = uVal + (dU * lapU - uvv + feed * (1 - uVal)) * dt;
        v2[i] = vVal + (dV * lapV + uvv - (kill + feed) * vVal) * dt;
      }
    }
    // Swap buffers.
    let t = u; u = u2; u2 = t;
    t = v; v = v2; v2 = t;
  }

  return v;
}

// ---- Marching squares --------------------------------------------------------

// Extract iso-contour line segments from the scalar field at `threshold`, then
// stitch them into connected polylines. Returns an array of point arrays
// (each [{x,y}, ...]); closed loops repeat the first point implicitly.
function marchingSquares(field, width, height, threshold) {
  const segments = [];

  // Linear interpolation of the crossing point between two grid samples.
  const lerp = (a, b) => (threshold - a) / (b - a || 1e-6);

  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width - 1; x++) {
      const tl = field[y * width + x];
      const tr = field[y * width + x + 1];
      const br = field[(y + 1) * width + x + 1];
      const bl = field[(y + 1) * width + x];

      let code = 0;
      if (tl > threshold) code |= 8;
      if (tr > threshold) code |= 4;
      if (br > threshold) code |= 2;
      if (bl > threshold) code |= 1;
      if (code === 0 || code === 15) continue;

      // Edge crossing points (cell-local coords).
      const top = { x: x + lerp(tl, tr), y };
      const right = { x: x + 1, y: y + lerp(tr, br) };
      const bottom = { x: x + lerp(bl, br), y: y + 1 };
      const left = { x, y: y + lerp(tl, bl) };

      const push = (a, b) => segments.push([a, b]);

      switch (code) {
        case 1: push(left, bottom); break;
        case 2: push(bottom, right); break;
        case 3: push(left, right); break;
        case 4: push(top, right); break;
        case 5: push(left, top); push(bottom, right); break; // saddle
        case 6: push(top, bottom); break;
        case 7: push(left, top); break;
        case 8: push(top, left); break;
        case 9: push(top, bottom); break;
        case 10: push(top, right); push(left, bottom); break; // saddle
        case 11: push(top, right); break;
        case 12: push(right, left); break;
        case 13: push(right, bottom); break;
        case 14: push(bottom, left); break;
        default: break;
      }
    }
  }

  return stitch(segments);
}

// Stitch unordered line segments into connected polylines by matching shared
// endpoints. Uses a spatial hash keyed on quantized coordinates.
function stitch(segments) {
  if (segments.length === 0) return [];
  const q = 1000; // quantization for endpoint matching
  const key = (p) => `${Math.round(p.x * q)},${Math.round(p.y * q)}`;

  // Map each endpoint key -> list of segment indices that touch it.
  const endpoints = new Map();
  segments.forEach((seg, i) => {
    for (const p of seg) {
      const k = key(p);
      if (!endpoints.has(k)) endpoints.set(k, []);
      endpoints.get(k).push(i);
    }
  });

  const used = new Array(segments.length).fill(false);
  const polylines = [];

  for (let i = 0; i < segments.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const [a, b] = segments[i];
    const line = [a, b];

    // Extend forward from the tail.
    let grew = true;
    while (grew) {
      grew = false;
      const tail = line[line.length - 1];
      const candidates = endpoints.get(key(tail)) || [];
      for (const ci of candidates) {
        if (used[ci]) continue;
        const [ca, cb] = segments[ci];
        if (key(ca) === key(tail)) { line.push(cb); used[ci] = true; grew = true; break; }
        if (key(cb) === key(tail)) { line.push(ca); used[ci] = true; grew = true; break; }
      }
    }

    // Extend backward from the head.
    grew = true;
    while (grew) {
      grew = false;
      const head = line[0];
      const candidates = endpoints.get(key(head)) || [];
      for (const ci of candidates) {
        if (used[ci]) continue;
        const [ca, cb] = segments[ci];
        if (key(ca) === key(head)) { line.unshift(cb); used[ci] = true; grew = true; break; }
        if (key(cb) === key(head)) { line.unshift(ca); used[ci] = true; grew = true; break; }
      }
    }

    polylines.push(line);
  }

  return polylines;
}

// ---- Path building -----------------------------------------------------------

// Chaikin corner-cutting smoothing for nicer organic contours. Used as a light
// pre-pass to relax the blocky marching-squares staircase before we fit curves.
function smoothPolyline(pts, closed, iterations) {
  let line = pts;
  for (let it = 0; it < iterations; it++) {
    const out = [];
    const n = line.length;
    if (n < 3) return line;
    if (!closed) out.push(line[0]);
    const limit = closed ? n : n - 1;
    for (let i = 0; i < limit; i++) {
      const p0 = line[i];
      const p1 = line[(i + 1) % n];
      out.push({ x: p0.x * 0.75 + p1.x * 0.25, y: p0.y * 0.75 + p1.y * 0.25 });
      out.push({ x: p0.x * 0.25 + p1.x * 0.75, y: p0.y * 0.25 + p1.y * 0.75 });
    }
    if (!closed) out.push(line[n - 1]);
    line = out;
  }
  return line;
}

// Drop points that are closer than `minDist` to the previously kept point.
// Reduces over-tessellation so the curve fit is clean and the path data small.
function decimate(line, closed, minDist) {
  if (minDist <= 0 || line.length < 3) return line;
  const md2 = minDist * minDist;
  const out = [line[0]];
  for (let i = 1; i < line.length; i++) {
    const p = line[i];
    const q = out[out.length - 1];
    const dx = p.x - q.x, dy = p.y - q.y;
    if (dx * dx + dy * dy >= md2) out.push(p);
  }
  // Keep at least a triangle.
  if (out.length < 3) return line;
  return out;
}

// Build smooth cubic-Bézier SVG path data through `pts` using a centripetal
// Catmull-Rom spline (tension-controlled). The spline passes through every
// point, so the result hugs the contour while rendering as true curves rather
// than faceted line segments.
function catmullRomPath(pts, closed, mapPt) {
  const n = pts.length;
  if (n < 3) return '';

  // Catmull-Rom -> cubic Bézier control points. `t` is tension (1/6 = uniform).
  const t = 1 / 6;
  const at = (i) => {
    if (closed) return pts[(i % n + n) % n];
    return pts[Math.max(0, Math.min(n - 1, i))];
  };

  const m0 = mapPt(pts[0]);
  let d = `M${m0.x} ${m0.y}`;

  const segCount = closed ? n : n - 1;
  for (let i = 0; i < segCount; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);

    const c1 = mapPt({ x: p1.x + (p2.x - p0.x) * t, y: p1.y + (p2.y - p0.y) * t });
    const c2 = mapPt({ x: p2.x - (p3.x - p1.x) * t, y: p2.y - (p3.y - p1.y) * t });
    const e = mapPt(p2);
    d += `C${c1.x} ${c1.y} ${c2.x} ${c2.y} ${e.x} ${e.y}`;
  }
  if (closed) d += 'Z';
  return d;
}

export function reactiondiffusionRuntime(params) {
  const resolution = Math.max(40, Math.min(220, Math.round(params.resolution ?? 120)));
  const width = resolution;
  const height = resolution;

  const feed = params.feed ?? 0.0367;
  const kill = params.kill ?? 0.0649;
  const dU = params.diffuse_u ?? 0.16;
  const dV = params.diffuse_v ?? 0.08;
  const steps = Math.max(100, Math.min(8000, Math.round(params.steps ?? 3000)));
  const seed = Math.round(params.seed ?? 1);
  const seedDensity = Math.max(0.2, params.seed_density ?? 1);
  const threshold = Math.max(0.05, Math.min(0.9, params.threshold ?? 0.25));
  const smoothing = Math.max(0, Math.min(4, Math.round(params.smoothing ?? 2)));
  const minPerimeter = Math.max(0, params.min_size ?? 4);

  const worldSize = Math.max(10, params.size ?? 400);
  const ox = params.x ?? 0;
  const oy = params.y ?? 0;

  const fillContours = params.fill ?? false;
  const color = params.color ?? '#000000';
  const fillColor = params.fill_color ?? '#000000';
  const strokeWidth = params.stroke_width ?? 1;

  const field = simulate(width, height, { feed, kill, dU, dV, steps, seed, seedDensity });

  let polylines = marchingSquares(field, width, height, threshold);

  // Scale from grid space to world space and recenter on (ox, oy).
  const scale = worldSize / Math.max(width, height);
  const halfW = (width * scale) / 2;
  const halfH = (height * scale) / 2;

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const round = (v) => Math.round(v * 100) / 100;
  const mapPt = (p) => {
    const px = ox + p.x * scale - halfW;
    const py = oy + p.y * scale - halfH;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
    return { x: round(px), y: round(py) };
  };

  const pathParts = [];

  for (let line of polylines) {
    if (line.length < 3) continue;

    // A polyline is "closed" if its endpoints coincide.
    const first = line[0];
    const last = line[line.length - 1];
    const dx = first.x - last.x;
    const dy = first.y - last.y;
    const closed = dx * dx + dy * dy < 1e-4;

    // For closed loops the duplicated endpoint would confuse the spline wrap.
    if (closed && line.length > 1) line = line.slice(0, -1);

    // Light Chaikin pre-pass relaxes the staircase, then thin the points and
    // fit a smooth Catmull-Rom spline so the output is genuine curves.
    if (smoothing > 0) line = smoothPolyline(line, closed, smoothing);
    line = decimate(line, closed, 0.9);

    // Reject tiny specks below the minimum perimeter (in grid units).
    let perim = 0;
    const segs = closed ? line.length : line.length - 1;
    for (let i = 0; i < segs; i++) {
      const a = line[i], b = line[(i + 1) % line.length];
      perim += Math.hypot(b.x - a.x, b.y - a.y);
    }
    if (perim < minPerimeter) continue;

    const d = catmullRomPath(line, closed, mapPt);
    if (d) pathParts.push(d);
  }

  if (pathParts.length === 0) {
    return {
      type: 'error',
      message: 'No contours found — try lowering the Threshold, adding more Steps, or changing the Pattern preset.',
    };
  }

  return {
    type: 'booleanResult',
    pathData: pathParts.join(' '),
    fill: fillContours ? fillColor : 'none',
    stroke: color,
    strokeWidth,
    fillRule: 'evenodd',
    bounds: {
      x: minX,
      y: minY,
      width: maxX - minX || 1,
      height: maxY - minY || 1,
    },
  };
}
