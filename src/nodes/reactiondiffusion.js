// Reaction-Diffusion (Gray-Scott) node.
//
// Runs a small Gray-Scott reaction-diffusion simulation on a grid, then runs
// marching squares on the resulting chemical concentration field to extract
// smooth iso-contours as vector paths. Produces classic Turing patterns:
// spots, stripes, coral / mazes, mitosis, etc.
//
// The reaction can be confined to an input geometry (or a soft disc) so the
// pattern runs out organically instead of filling a hard rectangle. Render as
// thin outlines or as a bold filled region (the classic "coral" look).
//
// The sim is the heavy part. We keep the grid modest (default 120x120) and the
// step count bounded so live tweaking stays responsive. The math is plain
// typed arrays for speed; paper.js is only used to rasterize an input shape
// into a mask.

import paper from 'paper';
import { geoToPaperPath } from '../utils/geoPathUtils';

let paperReady = false;
const rdCanvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperReady && rdCanvas) { paper.setup(rdCanvas); paperReady = true; }
}

// ---- Gray-Scott simulation ---------------------------------------------------

// One simulation producing a Float32Array of V concentrations (the "pattern"
// chemical), normalized roughly to 0..1.
//
// `mask` (optional Float32Array, same size) confines the reaction: cells where
// mask <= 0 are held inert (V forced to 0). Diffusion uses no-flux (Neumann)
// boundaries — clamped neighbours — so the pattern does NOT wrap/tile into a
// hard rectangle the way toroidal boundaries do; it runs out at the edges.
function simulate(width, height, opts) {
  const { feed, kill, dU, dV, steps, seed, seedDensity, mask } = opts;
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

  const inMask = (idx) => !mask || mask[idx] > 0;

  // Seed: scatter small square blobs of V to kick the reaction off. Blob count
  // scales with grid area so patterns reliably fill the region regardless of
  // resolution. Seeds are only placed inside the mask.
  const blobs = Math.max(8, Math.round((size / 700) * seedDensity));
  let placed = 0;
  let attempts = 0;
  while (placed < blobs && attempts < blobs * 40) {
    attempts++;
    const bx = Math.floor(rand() * width);
    const by = Math.floor(rand() * height);
    if (!inMask(by * width + bx)) continue;
    const r = 3 + Math.floor(rand() * 4);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const x = bx + dx;
        const y = by + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const idx = y * width + x;
        if (!inMask(idx)) continue;
        u[idx] = 0.5;
        v[idx] = 0.25;
      }
    }
    placed++;
  }

  const dt = 1.0;

  for (let step = 0; step < steps; step++) {
    for (let y = 0; y < height; y++) {
      // No-flux boundaries: clamp neighbour indices at the edges.
      const yUp = y === 0 ? 0 : y - 1;
      const yDn = y === height - 1 ? height - 1 : y + 1;
      const rowC = y * width;
      const rowU = yUp * width;
      const rowD = yDn * width;
      for (let x = 0; x < width; x++) {
        const i = rowC + x;
        if (!inMask(i)) { u2[i] = 1; v2[i] = 0; continue; }

        const xL = x === 0 ? 0 : x - 1;
        const xR = x === width - 1 ? width - 1 : x + 1;

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

// Build a mask grid from an input geometry's paper.js path. Cells whose center
// falls inside the path are 1, outside 0. The path is in world coords; we map
// each grid cell to world space using the same transform the contours use.
function buildMaskFromPath(path, width, height, scale, ox, oy, halfW, halfH) {
  const mask = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const wx = ox + x * scale - halfW;
      const wy = oy + y * scale - halfH;
      mask[y * width + x] = path.contains({ x: wx, y: wy }) ? 1 : 0;
    }
  }
  return mask;
}

// Radial falloff mask: a soft disc that fades the reaction out toward the grid
// edges so the pattern "runs out" organically instead of hitting a hard square.
function buildRadialMask(width, height, strength) {
  const mask = new Float32Array(width * height);
  const cx = (width - 1) / 2;
  const cy = (height - 1) / 2;
  const maxR = Math.min(width, height) / 2;
  // strength 0 -> full square (no falloff); 1 -> tight disc.
  const radius = maxR * (1 - 0.45 * strength);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x - cx, y - cy);
      mask[y * width + x] = d <= radius ? 1 : 0;
    }
  }
  return mask;
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
// than faceted line segments. `tension` (0..1) controls how loose/round the
// curve is: low values hug the points tightly, high values round them off.
function catmullRomPath(pts, closed, mapPt, tension) {
  const n = pts.length;
  if (n < 3) return '';

  // Convert Catmull-Rom to cubic Bézier control points. `t` scales the tangent
  // length; 1/6 reproduces the standard uniform Catmull-Rom.
  const t = tension;
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

export function reactiondiffusionRuntime(params, inputs) {
  ensurePaper();

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
  const edgeFalloff = Math.max(0, Math.min(1, params.edge_falloff ?? 0));

  // Curve Tension (0..1, UI): how round/loose the fitted Bezier curves are.
  const tensionUI = Math.max(0, Math.min(1, params.tension ?? 0.5));
  const tension = 0.04 + tensionUI * 0.26;

  // Detail (0..1, UI): higher keeps more points (finer); lower decimates harder.
  const detailUI = Math.max(0, Math.min(1, params.detail ?? 0.5));
  const decimateDist = 2.2 - detailUI * 2.0; // ~2.2 (coarse) .. ~0.2 (fine)

  const renderMode = params.render ?? 'Filled';
  const filled = renderMode === 'Filled';
  const color = params.color ?? '#000000';
  const fillColor = params.fill_color ?? '#111111';
  const strokeWidth = params.stroke_width ?? 1.5;

  const ox = params.x ?? 0;
  const oy = params.y ?? 0;

  // If geometry is connected we run the reaction *inside* it; otherwise the
  // pattern fills the configured Size (optionally inside a soft disc falloff).
  const inputGeo = inputs?.geometry_in;
  let boundaryPath = null;
  let worldSize = Math.max(10, params.size ?? 400);
  let cox = ox, coy = oy;

  if (inputGeo) {
    const bp = geoToPaperPath(inputGeo);
    if (bp) {
      boundaryPath = bp;
      const b = bp.bounds;
      // Fit the grid over the shape's bounding box (square, padded a touch) and
      // center it on the shape so the mask lines up with the geometry.
      worldSize = Math.max(b.width, b.height) * 1.04;
      cox = ox + b.x + b.width / 2;
      coy = oy + b.y + b.height / 2;
    }
  }

  const scale = worldSize / Math.max(width, height);
  const halfW = (width * scale) / 2;
  const halfH = (height * scale) / 2;

  // Build the confinement mask.
  let mask = null;
  if (boundaryPath) {
    mask = buildMaskFromPath(boundaryPath, width, height, scale, cox, coy, halfW, halfH);
    boundaryPath.remove();
  } else if (edgeFalloff > 0) {
    mask = buildRadialMask(width, height, edgeFalloff);
  }

  const field = simulate(width, height, { feed, kill, dU, dV, steps, seed, seedDensity, mask });

  let polylines = marchingSquares(field, width, height, threshold);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  const round = (v) => Math.round(v * 100) / 100;
  const mapPt = (p) => {
    const px = cox + p.x * scale - halfW;
    const py = coy + p.y * scale - halfH;
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
    line = decimate(line, closed, decimateDist);

    // Reject tiny specks below the minimum perimeter (in grid units).
    let perim = 0;
    const segs = closed ? line.length : line.length - 1;
    for (let i = 0; i < segs; i++) {
      const a = line[i], b = line[(i + 1) % line.length];
      perim += Math.hypot(b.x - a.x, b.y - a.y);
    }
    if (perim < minPerimeter) continue;

    const d = catmullRomPath(line, closed, mapPt, tension);
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
    fill: filled ? fillColor : 'none',
    stroke: filled ? 'none' : color,
    strokeWidth: filled ? 0 : strokeWidth,
    strokeLinejoin: 'round',
    strokeLinecap: 'round',
    fillRule: 'evenodd',
    bounds: {
      x: minX,
      y: minY,
      width: maxX - minX || 1,
      height: maxY - minY || 1,
    },
  };
}
