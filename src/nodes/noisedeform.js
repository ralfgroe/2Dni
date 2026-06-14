import paper from 'paper';
import { geoToPaperPath } from '../utils/geoPathUtils';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

function seededRandom(seed) {
  let s = ((seed | 0) + 1) || 1;
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
}

function permutation(seed) {
  const rand = seededRandom(seed);
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return [...p, ...p];
}

function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
function lerp(a, b, t) { return a + t * (b - a); }

// ---------------------------------------------------------------------------
// Noise primitives. Each returns a value in roughly [-1, 1].
// ---------------------------------------------------------------------------

function grad(hash, x, y) {
  const h = hash & 3;
  const u = h < 2 ? x : y;
  const v = h < 2 ? y : x;
  return ((h & 1) ? -u : u) + ((h & 2) ? -v : v);
}

function perlin2D(x, y, perm) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const xf = x - Math.floor(x);
  const yf = y - Math.floor(y);
  const u = fade(xf);
  const v = fade(yf);

  const aa = perm[perm[X] + Y];
  const ab = perm[perm[X] + Y + 1];
  const ba = perm[perm[X + 1] + Y];
  const bb = perm[perm[X + 1] + Y + 1];

  return lerp(
    lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
    lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
    v
  );
}

// Value noise: interpolates hashed random values at lattice points. Blockier /
// rounder character than Perlin.
function hashValue(perm, x, y) {
  return (perm[(perm[x & 255] + (y & 255)) & 511] / 255) * 2 - 1;
}

function value2D(x, y, perm) {
  const X = Math.floor(x);
  const Y = Math.floor(y);
  const xf = x - X;
  const yf = y - Y;
  const u = fade(xf);
  const v = fade(yf);
  const v00 = hashValue(perm, X, Y);
  const v10 = hashValue(perm, X + 1, Y);
  const v01 = hashValue(perm, X, Y + 1);
  const v11 = hashValue(perm, X + 1, Y + 1);
  return lerp(lerp(v00, v10, u), lerp(v01, v11, u), v);
}

// Simplex noise (2D). Smoother and free of the axis-aligned artifacts Perlin
// can show. Classic Stefan Gustavson formulation.
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GRAD3 = [
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [1, 0], [-1, 0], [1, 0], [-1, 0],
  [0, 1], [0, -1], [0, 1], [0, -1],
];
function simplex2D(xin, yin, perm) {
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);
  let i1, j1;
  if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  const ii = i & 255;
  const jj = j & 255;
  const gi0 = perm[ii + perm[jj]] % 12;
  const gi1 = perm[ii + i1 + perm[jj + j1]] % 12;
  const gi2 = perm[ii + 1 + perm[jj + 1]] % 12;
  let n0 = 0, n1 = 0, n2 = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 >= 0) { t0 *= t0; n0 = t0 * t0 * (GRAD3[gi0][0] * x0 + GRAD3[gi0][1] * y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 >= 0) { t1 *= t1; n1 = t1 * t1 * (GRAD3[gi1][0] * x1 + GRAD3[gi1][1] * y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 >= 0) { t2 *= t2; n2 = t2 * t2 * (GRAD3[gi2][0] * x2 + GRAD3[gi2][1] * y2); }
  return 70 * (n0 + n1 + n2);
}

// Worley / cellular noise: distance to the nearest feature point in a jittered
// grid. Produces organic, blobby, cell-like distortion (F2 - F1 gives ridges).
function featurePoint(perm, cx, cy) {
  const h = perm[(perm[cx & 255] + (cy & 255)) & 511];
  const h2 = perm[(h + 37) & 511];
  return [(h / 255), (h2 / 255)];
}
function worley2D(x, y, perm) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = Infinity;
  let f2 = Infinity;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const cx = xi + ox;
      const cy = yi + oy;
      const [fx, fy] = featurePoint(perm, cx, cy);
      const px = cx + fx;
      const py = cy + fy;
      const dx = px - x;
      const dy = py - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < f1) { f2 = f1; f1 = d; } else if (d < f2) { f2 = d; }
    }
  }
  // F2 - F1 emphasizes cell borders; map to ~[-1, 1].
  return (f2 - f1) * 2 - 1;
}

// Base sampler dispatch by noise type.
function baseNoise(type, x, y, perm) {
  switch (type) {
    case 'Simplex': return simplex2D(x, y, perm);
    case 'Value': return value2D(x, y, perm);
    case 'Worley': return worley2D(x, y, perm);
    case 'Perlin':
    case 'Ridged':
    default: return perlin2D(x, y, perm);
  }
}

// Fractal sum (fBm). For "Ridged" we fold each octave to create sharp ridges.
function fractal(type, x, y, octaves, perm) {
  let val = 0, amp = 1, freq = 1, max = 0;
  for (let i = 0; i < octaves; i++) {
    let n = baseNoise(type === 'Ridged' ? 'Perlin' : type, x * freq, y * freq, perm);
    if (type === 'Ridged') {
      n = 1 - Math.abs(n);
      n = n * n;
      val += (n * 2 - 1) * amp;
    } else {
      val += n * amp;
    }
    max += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return val / max;
}

// Curl noise: divergence-free vector field derived from the gradient of a
// scalar noise field, rotated 90 degrees. Gives flowing, swirling distortion.
function curlNoise(type, x, y, octaves, perm, perm2) {
  const eps = 0.5;
  // Use a single scalar potential built from both perm tables for variation.
  const potential = (px, py) =>
    fractal(type === 'Ridged' ? 'Perlin' : type, px, py, octaves, perm) +
    fractal(type === 'Ridged' ? 'Perlin' : type, px + 31.4, py - 17.2, octaves, perm2);
  const dpdy = (potential(x, y + eps) - potential(x, y - eps)) / (2 * eps);
  const dpdx = (potential(x + eps, y) - potential(x - eps, y)) / (2 * eps);
  // (dP/dy, -dP/dx) is divergence-free.
  return [dpdy, -dpdx];
}

// Resamples a single (non-compound) paper.Path along its arc length and
// displaces each sample by the chosen fractal noise. Returns a new paper.Path.
function deformSinglePath(srcPath, opts) {
  const { amplitude, frequency, octaves, samples, noiseType, perm, perm2 } = opts;
  const totalLen = srcPath.length;
  const closed = srcPath.closed;
  if (totalLen === 0) return srcPath.clone({ insert: true });

  const result = new paper.Path();
  for (let i = 0; i <= samples; i++) {
    const offset = (i / samples) * totalLen;
    const pt = srcPath.getPointAt(Math.min(offset, totalLen));
    if (!pt) continue;

    let nx, ny;
    if (noiseType === 'Curl') {
      const [vx, vy] = curlNoise(noiseType, pt.x * frequency, pt.y * frequency, octaves, perm, perm2);
      nx = vx * amplitude;
      ny = vy * amplitude;
    } else {
      nx = fractal(noiseType, pt.x * frequency, pt.y * frequency, octaves, perm) * amplitude;
      ny = fractal(noiseType, pt.x * frequency + 100, pt.y * frequency + 100, octaves, perm2) * amplitude;
    }
    result.add(new paper.Point(pt.x + nx, pt.y + ny));
  }
  if (closed) result.closePath();
  return result;
}

export function noisedeformRuntime(params, inputs) {
  ensurePaper();

  const geo = inputs?.geometry_in;
  if (!geo) return null;

  const amplitude = params.amplitude ?? 10;
  const frequency = params.frequency ?? 0.02;
  const octaves = Math.max(1, Math.min(6, Math.round(params.octaves ?? 2)));
  const seed = params.seed ?? 0;
  const samples = Math.max(20, Math.min(500, Math.round(params.samples ?? 100)));
  const noiseType = params.noise_type ?? 'Perlin';

  const perm = permutation(seed + 1);
  const perm2 = permutation(seed + 100);
  const noiseParams = { amplitude, frequency, octaves, samples, noiseType, perm, perm2 };

  // A group (e.g. from Trace/Select, or multi-layer geometry) keeps its
  // structure: deform each child independently.
  if ((geo.type === 'group' || geo.type === 'boolean') && Array.isArray(geo.children)) {
    const children = geo.children
      .map((child) => noisedeformRuntime(params, { geometry_in: child }))
      .filter(Boolean);
    if (children.length === 0) return geo;
    const bs = children.map((c) => c.bounds).filter(Boolean);
    const minX = bs.length ? Math.min(...bs.map((b) => b.x)) : 0;
    const minY = bs.length ? Math.min(...bs.map((b) => b.y)) : 0;
    const maxX = bs.length ? Math.max(...bs.map((b) => b.x + b.width)) : 0;
    const maxY = bs.length ? Math.max(...bs.map((b) => b.y + b.height)) : 0;
    return {
      type: 'group',
      children,
      bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    };
  }

  const paperPath = geoToPaperPath(geo);
  if (!paperPath) return geo;

  // Text and other multi-subpath geometry come back as a CompoundPath. Deform
  // every subpath (letters, holes) independently so the shapes are preserved
  // instead of being collapsed into one tangled open polyline.
  let outPath;
  if (paperPath instanceof paper.CompoundPath) {
    const deformedChildren = paperPath.children.map((child) =>
      deformSinglePath(child, noiseParams)
    );
    outPath = new paper.CompoundPath({ children: deformedChildren });
  } else {
    outPath = deformSinglePath(paperPath, noiseParams);
  }

  const pathData = outPath.pathData;
  const bounds = outPath.bounds;
  outPath.remove();
  paperPath.remove();

  return {
    type: 'booleanResult',
    pathData,
    fill: geo.fill || 'none',
    stroke: geo.stroke || '#000000',
    strokeWidth: geo.strokeWidth ?? 1,
    opacity: geo.opacity,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}
