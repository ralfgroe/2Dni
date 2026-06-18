import { extractParts } from './select';
import { splitIntoRegions } from '../utils/planarRegions';

export function colorRuntime(params, inputs) {
  const {
    show_fill = true,
    fill_color = '#ffffff',
    random_fill = false,
    random_split_regions = false,
    random_seed = 1,
    random_hue = 0,
    random_hue_range = 360,
    random_saturation = 60,
    random_lightness = 65,
    show_stroke = true,
    stroke_color = '#000000',
    stroke_width = 1,
    opacity = 100,
  } = params;

  const inputGeo = inputs.geometry_in;
  if (!inputGeo) return null;

  const opacityValue = Math.max(0, Math.min(100, opacity)) / 100;
  const stroke = show_stroke ? stroke_color : 'none';
  const strokeWidth = show_stroke ? stroke_width : 0;

  if (show_fill && random_fill) {
    return applyRandomColors(inputGeo, {
      seed: random_seed,
      splitRegions: random_split_regions,
      hue: random_hue,
      hueRange: random_hue_range,
      saturation: random_saturation,
      lightness: random_lightness,
      stroke,
      strokeWidth,
      opacity: opacityValue,
    });
  }

  const fill = show_fill ? fill_color : 'none';
  return applyColor(inputGeo, fill, stroke, strokeWidth, opacityValue);
}

// Splits the geometry into separate islands and gives each its own random
// fill color. Islands come from extractParts (group children or the subpaths
// of a compound path such as Voronoi cells). A seeded PRNG keeps the palette
// stable across re-evaluations and lets the user shuffle via the seed param.
function applyRandomColors(geo, opts) {
  const parts = opts.splitRegions ? regionParts(geo) : extractParts(geo);
  const rand = mulberry32((opts.seed | 0) * 2654435761 >>> 0 || 1);
  const sat = Math.max(0, Math.min(100, opts.saturation));
  const light = Math.max(0, Math.min(100, opts.lightness));
  const baseHue = ((opts.hue % 360) + 360) % 360;
  const range = Math.max(0, Math.min(360, opts.hueRange));

  const children = parts.map(({ geo: part }) => {
    // Center the random spread on the base hue, then wrap into 0..360.
    const hue = ((baseHue + (rand() - 0.5) * range) % 360 + 360) % 360;
    const fill = hslToHex(hue, sat, light);
    return applyColor(part, fill, opts.stroke, opts.strokeWidth, opts.opacity);
  });

  if (children.length === 0) return null;
  if (children.length === 1) return children[0];

  const bs = children.map((c) => c && c.bounds).filter(Boolean);
  const bounds = bs.length
    ? (() => {
        const minX = Math.min(...bs.map((b) => b.x));
        const minY = Math.min(...bs.map((b) => b.y));
        const maxX = Math.max(...bs.map((b) => b.x + b.width));
        const maxY = Math.max(...bs.map((b) => b.y + b.height));
        return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
      })()
    : undefined;

  return { type: 'group', children, ...(bounds ? { bounds } : {}) };
}

// Collects the path data of every path in the geometry, subdivides each into
// the enclosed regions formed by its self-intersections, and returns those
// regions as colorable parts. Falls back to extractParts when nothing
// subdivides (e.g. a non-overlapping shape).
function regionParts(geo) {
  const pathDatas = [];
  collectPathData(geo, pathDatas);

  const template = firstStyleSource(geo);
  const regions = [];
  for (const pd of pathDatas) {
    const cells = splitIntoRegions(pd);
    if (cells && cells.length > 1) {
      for (const cellPathData of cells) {
        regions.push({
          geo: {
            type: 'booleanResult',
            pathData: cellPathData,
            fill: template.fill ?? '#000000',
            stroke: template.stroke ?? 'none',
            strokeWidth: template.strokeWidth ?? 0,
            opacity: template.opacity,
            bounds: pathDataBounds(cellPathData),
          },
        });
      }
    }
  }

  if (regions.length > 1) return regions;
  return extractParts(geo);
}

function collectPathData(geo, out) {
  if (!geo) return;
  if (geo.pathData) out.push(geo.pathData);
  if (Array.isArray(geo.children)) for (const c of geo.children) collectPathData(c, out);
}

function firstStyleSource(geo) {
  if (!geo) return {};
  if (geo.pathData || geo.fill || geo.stroke) return geo;
  if (Array.isArray(geo.children) && geo.children.length) return firstStyleSource(geo.children[0]);
  return {};
}

// Cheap bounds from an "M x y L x y ... Z" polygon pathData.
function pathDataBounds(pathData) {
  const nums = pathData.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return undefined;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < nums.length; i += 2) {
    const x = parseFloat(nums[i]);
    const y = parseFloat(nums[i + 1]);
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

// Small, fast, deterministic PRNG seeded from an integer.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const color = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return Math.round(255 * color)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

function applyColor(geo, fill, stroke, strokeWidth, opacity) {
  if (!geo) return null;

  switch (geo.type) {
    case 'group':
      return {
        ...geo,
        children: (geo.children || []).map(c => applyColor(c, fill, stroke, strokeWidth, opacity)),
      };

    case 'boolean':
      return {
        ...geo,
        children: (geo.children || []).map(c => applyColor(c, fill, stroke, strokeWidth, opacity)),
      };

    default:
      // Only override color/width. Preserve any stroke styling the geometry
      // already carries (e.g. round caps on Dashes pieces) by leaving
      // strokeLinecap / strokeDasharray untouched via the spread.
      return {
        ...geo,
        fill,
        stroke,
        strokeWidth,
        opacity,
      };
  }
}
