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

function fbm(x, y, octaves, perm) {
  let val = 0, amp = 1, freq = 1, max = 0;
  for (let i = 0; i < octaves; i++) {
    val += perlin2D(x * freq, y * freq, perm) * amp;
    max += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return val / max;
}

// Resamples a single (non-compound) paper.Path along its arc length and
// displaces each sample by fractal Perlin noise. Returns a new paper.Path.
function deformSinglePath(srcPath, { amplitude, frequency, octaves, samples, perm, perm2 }) {
  const totalLen = srcPath.length;
  const closed = srcPath.closed;
  if (totalLen === 0) return srcPath.clone({ insert: true });

  const result = new paper.Path();
  for (let i = 0; i <= samples; i++) {
    const offset = (i / samples) * totalLen;
    const pt = srcPath.getPointAt(Math.min(offset, totalLen));
    if (!pt) continue;
    const nx = fbm(pt.x * frequency, pt.y * frequency, octaves, perm) * amplitude;
    const ny = fbm(pt.x * frequency + 100, pt.y * frequency + 100, octaves, perm2) * amplitude;
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

  const perm = permutation(seed + 1);
  const perm2 = permutation(seed + 100);
  const noiseParams = { amplitude, frequency, octaves, samples, perm, perm2 };

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
