import paper from 'paper';
import ImageTracer from 'imagetracerjs';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

// Cap the raster resolution we feed to the tracer. Tracing is O(pixels), so we
// downscale very large images before tracing to keep the UI responsive. The
// resulting vectors are scaled back up to the source image's world size.
const MAX_TRACE_DIM = 600;

// Cache traced results so repeated graph evaluations (which run on every
// interaction) don't re-trace the same image with the same options.
const traceCache = new Map();
const CACHE_LIMIT = 12;

const imageElementCache = new Map();
const imageDataCache = new Map();

function getImageData(dataUrl) {
  if (imageDataCache.has(dataUrl)) return imageDataCache.get(dataUrl);
  if (typeof document === 'undefined') return null;

  const img = imageElementCache.get(dataUrl);
  if (!img) {
    // Kick off a load; the import node and viewport already listen for the
    // 'import-image-loaded' event to re-evaluate once images are ready.
    const el = new Image();
    el.onload = () => {
      imageElementCache.set(dataUrl, el);
      window.dispatchEvent(new CustomEvent('import-image-loaded'));
    };
    el.src = dataUrl;
    return null;
  }
  if (!img.complete || img.naturalWidth === 0) return null;

  const natW = img.naturalWidth;
  const natH = img.naturalHeight;
  const scale = Math.min(1, MAX_TRACE_DIM / Math.max(natW, natH));
  const w = Math.max(1, Math.round(natW * scale));
  const h = Math.max(1, Math.round(natH * scale));

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, w, h);
  const imgd = ctx.getImageData(0, 0, w, h);
  const result = { imgd, w, h, natW, natH };
  imageDataCache.set(dataUrl, result);
  return result;
}

function buildOptions(params) {
  const mode = params.mode ?? 'Color';
  const colors = Math.max(2, Math.min(64, Math.round(params.colors ?? 8)));
  const detail = Math.max(1, Math.min(100, params.detail ?? 50));
  const smoothing = Math.max(0, Math.min(100, params.smoothing ?? 30));
  const minArea = Math.max(0, Math.min(100, params.min_area ?? 8));

  // Higher detail -> lower error thresholds -> more control points.
  const ltres = +(10.5 - (detail / 100) * 10.4).toFixed(3);
  // Smoothing relaxes the quadratic spline threshold so curves are rounder.
  const qtres = +(ltres + (smoothing / 100) * 6).toFixed(3);
  // Noise removal: omit short edge-node paths.
  const pathomit = Math.round((minArea / 100) * 30);
  // Optional selective blur for stronger smoothing.
  const blurradius = smoothing >= 60 ? Math.round(((smoothing - 60) / 40) * 5) : 0;

  const options = {
    ltres,
    qtres,
    pathomit,
    rightangleenhance: smoothing < 50,
    colorsampling: mode === 'Black & White' ? 0 : 2,
    numberofcolors: mode === 'Black & White' ? 2 : colors,
    mincolorratio: 0,
    colorquantcycles: 3,
    layering: 0,
    strokewidth: 0,
    linefilter: smoothing >= 30,
    scale: 1,
    roundcoords: 2,
    viewbox: true,
    blurradius,
    blurdelta: 20,
  };

  if (mode === 'Black & White') {
    options.pal = [
      { r: 0, g: 0, b: 0, a: 255 },
      { r: 255, g: 255, b: 255, a: 255 },
    ];
  }

  return options;
}

// Parse the SVG string ImageTracer produces into a flat list of colored paths.
function svgToColoredPaths(svgString) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return [];

  const out = [];
  for (const el of svgEl.querySelectorAll('path')) {
    const d = el.getAttribute('d');
    if (!d) continue;
    const fill = el.getAttribute('fill') || '#000000';
    const opacityAttr = el.getAttribute('fill-opacity') ?? el.getAttribute('opacity');
    const opacity = opacityAttr != null ? parseFloat(opacityAttr) : 1;
    if (opacity === 0) continue;
    out.push({ d, fill, opacity });
  }
  return out;
}

function cacheKey(dataUrl, params) {
  return [
    dataUrl.length, dataUrl.slice(0, 64),
    params.mode, params.colors, params.detail, params.smoothing, params.min_area,
  ].join('|');
}

// Rounds sharp corners of a paper path/compound path in place. `amount` is
// 0..100; higher rounds more aggressively. Works by replacing each sharp
// corner anchor with two anchors pulled back along the adjacent edges plus a
// smooth curve between them (a fillet).
function roundCorners(item, amount) {
  if (amount <= 0) return;
  const children = item instanceof paper.CompoundPath ? item.children : [item];
  const maxRadius = (amount / 100) * 0.5; // fraction of the shorter adjacent edge

  for (const path of children) {
    if (!path.segments || path.segments.length < 3) continue;
    const segs = path.segments;
    const pts = segs.map((s) => s.point.clone());
    const n = pts.length;
    const closed = path.closed;
    const newSegments = [];

    const limitStart = closed ? 0 : 1;
    const limitEnd = closed ? n : n - 1;

    if (!closed) newSegments.push(new paper.Segment(pts[0]));

    for (let i = limitStart; i < limitEnd; i++) {
      const prev = pts[(i - 1 + n) % n];
      const cur = pts[i];
      const next = pts[(i + 1) % n];

      const inVec = cur.subtract(prev);
      const outVec = next.subtract(cur);
      const inLen = inVec.length;
      const outLen = outVec.length;
      if (inLen < 0.01 || outLen < 0.01) { newSegments.push(new paper.Segment(cur)); continue; }

      // Turn angle: ~0 for straight, large for sharp corners.
      const angle = Math.abs(inVec.angle - outVec.angle);
      const turn = Math.min(angle, 360 - angle);
      if (turn < 12) { newSegments.push(new paper.Segment(cur)); continue; }

      const r = Math.min(inLen, outLen) * maxRadius;
      const p1 = cur.subtract(inVec.normalize(r));
      const p2 = cur.add(outVec.normalize(r));

      // Two anchors with handles pointing toward the original corner give a
      // smooth rounded transition.
      const h = r * 0.55;
      const s1 = new paper.Segment(p1, null, cur.subtract(p1).normalize(h));
      const s2 = new paper.Segment(p2, cur.subtract(p2).normalize(h), null);
      newSegments.push(s1, s2);
    }

    if (!closed) newSegments.push(new paper.Segment(pts[n - 1]));

    path.removeSegments();
    path.addSegments(newSegments);
    if (closed) path.closed = true;
  }
}

// Removes sub-paths of a compound path whose absolute area is below
// `minAbsArea` (in world units squared). Preserves holes/sub-shapes that are
// still large enough. Returns the (possibly emptied) item.
function removeSmallSubpaths(item, minAbsArea) {
  if (minAbsArea <= 0) return item;
  if (!(item instanceof paper.CompoundPath)) {
    return Math.abs(item.area) < minAbsArea ? null : item;
  }
  const toRemove = item.children.filter((c) => Math.abs(c.area) < minAbsArea);
  for (const c of toRemove) c.remove();
  return item;
}

export function traceRuntime(params, inputs) {
  ensurePaper();

  const geo = inputs?.geometry_in;
  if (!geo) return null;

  // The Trace node expects an imported raster image as input.
  if (geo.type !== 'image' || !geo.dataUrl) {
    return {
      type: 'error',
      message: 'Trace expects an imported PNG/JPEG/raster image as input.',
    };
  }

  const key = cacheKey(geo.dataUrl, params);
  let traced = traceCache.get(key);

  if (!traced) {
    const data = getImageData(geo.dataUrl);
    if (!data) return null; // image still loading; will re-evaluate on load event

    let svgString;
    try {
      svgString = ImageTracer.imagedataToSVG(data.imgd, buildOptions(params));
    } catch (e) {
      return { type: 'error', message: `Trace failed: ${e.message}` };
    }

    const colored = svgToColoredPaths(svgString);
    traced = { colored, raster: data };

    if (traceCache.size >= CACHE_LIMIT) {
      traceCache.delete(traceCache.keys().next().value);
    }
    traceCache.set(key, traced);
  }

  const { colored, raster } = traced;
  if (!colored || colored.length === 0) return geo;

  // ImageTracer coordinates are in downscaled raster pixel space. Map them to
  // the source image's placed world bounds (x, y, width, height).
  const sx = (geo.width || raster.natW) / raster.w;
  const sy = (geo.height || raster.natH) / raster.h;
  const ox = geo.x || 0;
  const oy = geo.y || 0;

  const minPiece = Math.max(0, Math.min(100, params.min_piece ?? 0));
  const roundAmt = Math.max(0, Math.min(100, params.round_corners ?? 0));

  // "Remove Small Pieces" threshold is an absolute area in world units, derived
  // from the placed image's total area so the slider behaves consistently
  // regardless of image size. Computed once and applied globally across every
  // traced color region (so isolated specks in any layer are removed, not just
  // subpaths that happen to share a compound path with a big shape).
  const imgW = (geo.width || raster.natW);
  const imgH = (geo.height || raster.natH);
  const totalArea = Math.abs(imgW * imgH);
  // Non-linear curve: gentle at the low end, up to ~3% of the image at max.
  const minAbsArea = minPiece > 0 ? Math.pow(minPiece / 100, 2) * 0.03 * totalArea : 0;

  const children = [];
  for (const { d, fill, opacity } of colored) {
    let p = new paper.CompoundPath(d);
    p.scale(sx, sy, new paper.Point(0, 0));
    p.translate(new paper.Point(ox, oy));

    p = removeSmallSubpaths(p, minAbsArea);
    if (!p || (p.children && p.children.length === 0)) { if (p) p.remove(); continue; }

    roundCorners(p, roundAmt);

    const pathData = p.pathData;
    const bounds = p.bounds;
    const area = Math.abs(p.area);
    p.remove();
    if (!pathData) continue;
    // Drop a whole region if its remaining total area is below threshold.
    if (minAbsArea > 0 && area < minAbsArea) continue;
    children.push({
      type: 'booleanResult',
      pathData,
      fill,
      stroke: 'none',
      strokeWidth: 0,
      opacity: opacity != null && opacity < 1 ? opacity : undefined,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    });
  }

  if (children.length === 0) return geo;

  const minX = Math.min(...children.map((c) => c.bounds.x));
  const minY = Math.min(...children.map((c) => c.bounds.y));
  const maxX = Math.max(...children.map((c) => c.bounds.x + c.bounds.width));
  const maxY = Math.max(...children.map((c) => c.bounds.y + c.bounds.height));

  return {
    type: 'group',
    children,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}
