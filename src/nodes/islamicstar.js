import paper from 'paper';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

function ensurePaper() {
  if (!paperInitialized && canvas) {
    paper.setup(canvas);
    paperInitialized = true;
  }
}

const PRESETS = {
  '6-Fold':  { points: 6,  star_depth: 0.45, grid_type: 'Hexagonal' },
  '8-Fold':  { points: 8,  star_depth: 0.42, grid_type: 'Square' },
  '10-Fold': { points: 10, star_depth: 0.38, grid_type: 'Square' },
  '12-Fold': { points: 12, star_depth: 0.35, grid_type: 'Hexagonal' },
};

function resolveParams(params) {
  const preset = PRESETS[params.preset];
  if (preset && params.preset !== 'Custom') {
    return {
      ...params,
      points: preset.points,
      star_depth: params.star_depth !== undefined ? params.star_depth : preset.star_depth,
      grid_type: preset.grid_type,
    };
  }
  return params;
}

function circlePoints(cx, cy, radius, n, rotationOffset = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const angle = rotationOffset + (2 * Math.PI * i) / n;
    pts.push(new paper.Point(
      cx + radius * Math.cos(angle),
      cy + radius * Math.sin(angle)
    ));
  }
  return pts;
}

function lineIntersection(p1, p2, p3, p4) {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const denom = d1x * d2y - d1y * d2x;
  if (Math.abs(denom) < 1e-10) return null;
  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / denom;
  return new paper.Point(p1.x + t * d1x, p1.y + t * d1y);
}

/**
 * Build the main star outline: a clean star polygon with outer tips
 * and inner vertices, no construction lines passing through center.
 */
function buildStarOutline(cx, cy, n, outerRadius, depth) {
  const outerPts = circlePoints(cx, cy, outerRadius, n);
  const innerRadius = outerRadius * (1 - depth);
  const innerPts = circlePoints(cx, cy, innerRadius, n, -Math.PI / 2 + Math.PI / n);

  const starPath = new paper.Path();
  for (let i = 0; i < n; i++) {
    starPath.add(outerPts[i]);
    starPath.add(innerPts[i]);
  }
  starPath.closePath();
  return starPath;
}

/**
 * Build the inner polygon formed by connecting inner vertices.
 */
function buildInnerPolygon(cx, cy, n, outerRadius, depth) {
  const innerRadius = outerRadius * (1 - depth);
  const innerPts = circlePoints(cx, cy, innerRadius, n, -Math.PI / 2 + Math.PI / n);

  const path = new paper.Path();
  for (const pt of innerPts) path.add(pt);
  path.closePath();
  return path;
}

/**
 * Build individual star arm segments as separate paths (outer tip to
 * adjacent inner vertices). These are the clean "petal" shapes.
 */
function buildStarArms(cx, cy, n, outerRadius, depth) {
  const outerPts = circlePoints(cx, cy, outerRadius, n);
  const innerRadius = outerRadius * (1 - depth);
  const innerPts = circlePoints(cx, cy, innerRadius, n, -Math.PI / 2 + Math.PI / n);
  const center = new paper.Point(cx, cy);

  const arms = [];
  for (let i = 0; i < n; i++) {
    const prevInner = innerPts[(i - 1 + n) % n];
    const tip = outerPts[i];
    const nextInner = innerPts[i];

    const arm = new paper.Path();
    arm.add(prevInner);
    arm.add(tip);
    arm.add(nextInner);
    arms.push(arm);
  }
  return arms;
}

/**
 * Build rosette: kite-shaped regions between star arms that connect
 * inner vertices to a mid-ring, creating the classic infill pattern.
 */
function buildRosette(cx, cy, n, outerRadius, depth) {
  const outerPts = circlePoints(cx, cy, outerRadius, n);
  const innerRadius = outerRadius * (1 - depth);
  const innerPts = circlePoints(cx, cy, innerRadius, n, -Math.PI / 2 + Math.PI / n);

  const midRadius = (outerRadius + innerRadius) / 2;
  const midPts = circlePoints(cx, cy, midRadius, n);

  const paths = [];
  for (let i = 0; i < n; i++) {
    const nextI = (i + 1) % n;

    const kite = new paper.Path();
    kite.add(innerPts[i]);
    kite.add(midPts[nextI]);
    kite.add(innerPts[nextI]);
    kite.closePath();
    paths.push(kite);
  }

  return paths;
}

/**
 * Build extended construction lines that connect every k-th outer point,
 * clipped to only the segments between adjacent intersection points.
 * This produces the characteristic interlocking line pattern without
 * lines converging through the center.
 */
function buildClippedConstruction(cx, cy, n, outerRadius, depth) {
  const outerPts = circlePoints(cx, cy, outerRadius, n);

  const skip = Math.max(2, Math.round(n * depth * 0.5 + 1));
  if (skip >= n) return [];

  const edges = [];
  for (let i = 0; i < n; i++) {
    edges.push({ from: outerPts[i], to: outerPts[(i + skip) % n] });
  }

  const clippedSegments = [];
  for (let i = 0; i < n; i++) {
    const e = edges[i];
    const intersections = [];

    for (let j = 0; j < n; j++) {
      if (j === i) continue;
      const pt = lineIntersection(e.from, e.to, edges[j].from, edges[j].to);
      if (!pt) continue;

      const t = (e.to.x - e.from.x) !== 0
        ? (pt.x - e.from.x) / (e.to.x - e.from.x)
        : (pt.y - e.from.y) / (e.to.y - e.from.y);

      if (t > 0.01 && t < 0.99) {
        intersections.push({ pt, t });
      }
    }

    intersections.sort((a, b) => a.t - b.t);

    const allPts = [
      { pt: e.from, t: 0 },
      ...intersections,
      { pt: e.to, t: 1 },
    ];

    for (let k = 0; k < allPts.length - 1; k++) {
      const seg = new paper.Path();
      seg.add(allPts[k].pt);
      seg.add(allPts[k + 1].pt);
      clippedSegments.push(seg);
    }
  }

  return clippedSegments;
}

/**
 * Build a second layer of construction using a different skip value,
 * adding visual complexity.
 */
function buildSecondaryConstruction(cx, cy, n, outerRadius, depth) {
  if (n < 8) return [];

  const innerRadius = outerRadius * (1 - depth);
  const innerPts = circlePoints(cx, cy, innerRadius, n, -Math.PI / 2 + Math.PI / n);

  const paths = [];
  for (let i = 0; i < n; i++) {
    const skip2 = Math.max(2, Math.floor(n / 3));
    const j = (i + skip2) % n;
    const seg = new paper.Path();
    seg.add(innerPts[i]);
    seg.add(innerPts[j]);
    paths.push(seg);
  }

  return paths;
}

function tileOnGrid(unitPaths, gridType, rings, radius) {
  if (rings <= 0) return unitPaths;

  const allPaths = [...unitPaths];
  const spacing = radius * 2;

  if (gridType === 'Square') {
    for (let row = -rings; row <= rings; row++) {
      for (let col = -rings; col <= rings; col++) {
        if (row === 0 && col === 0) continue;
        const dx = col * spacing;
        const dy = row * spacing;
        for (const p of unitPaths) {
          const copy = p.clone();
          copy.translate(new paper.Point(dx, dy));
          allPaths.push(copy);
        }
      }
    }
  } else {
    const rowH = spacing * Math.sqrt(3) / 2;
    for (let row = -rings; row <= rings; row++) {
      for (let col = -rings; col <= rings; col++) {
        if (row === 0 && col === 0) continue;
        const dx = col * spacing + (Math.abs(row) % 2 !== 0 ? spacing / 2 : 0);
        const dy = row * rowH;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > spacing * (rings + 0.5)) continue;
        for (const p of unitPaths) {
          const copy = p.clone();
          copy.translate(new paper.Point(dx, dy));
          allPaths.push(copy);
        }
      }
    }
  }

  return allPaths;
}

export function geometricstarRuntime(params) {
  ensurePaper();

  const resolved = resolveParams(params);
  const n = Math.max(3, Math.min(24, Math.round(resolved.points)));
  const radius = resolved.radius || 100;
  const depth = Math.max(0.1, Math.min(0.9, resolved.star_depth || 0.45));
  const showRosette = resolved.show_rosette !== false;
  const shouldTile = resolved.tile === true;
  const gridType = resolved.grid_type || 'Square';
  const rings = Math.max(0, Math.min(5, Math.round(resolved.rings || 0)));
  const cx = resolved.x || 0;
  const cy = resolved.y || 0;
  const strokeWidth = resolved.stroke_width ?? 1;

  let unitPaths = [];

  const starOutline = buildStarOutline(cx, cy, n, radius, depth);
  unitPaths.push(starOutline);

  const innerPoly = buildInnerPolygon(cx, cy, n, radius, depth);
  unitPaths.push(innerPoly);

  const arms = buildStarArms(cx, cy, n, radius, depth);
  unitPaths = unitPaths.concat(arms);

  const construction = buildClippedConstruction(cx, cy, n, radius, depth);
  unitPaths = unitPaths.concat(construction);

  if (showRosette) {
    const rosettePaths = buildRosette(cx, cy, n, radius, depth);
    unitPaths = unitPaths.concat(rosettePaths);

    const secondary = buildSecondaryConstruction(cx, cy, n, radius, depth);
    unitPaths = unitPaths.concat(secondary);
  }

  let allPaths;
  if (shouldTile && rings > 0) {
    allPaths = tileOnGrid(unitPaths, gridType, rings, radius);
  } else {
    allPaths = unitPaths;
  }

  if (allPaths.length === 0) return null;

  const compound = new paper.CompoundPath({ children: allPaths });
  const pathData = compound.pathData;
  const bounds = compound.bounds;
  compound.remove();

  return {
    type: 'booleanResult',
    pathData,
    fill: 'none',
    stroke: '#000000',
    strokeWidth,
    bounds: {
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
    },
  };
}
