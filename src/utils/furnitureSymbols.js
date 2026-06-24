// Standard-sized furniture symbols for the Furniture node.
//
// Each symbol is authored in LOCAL METER coordinates, centered on the origin,
// "facing" +Y (toward the bottom of the footprint by convention). A symbol is a
// list of strokes; each stroke is an SVG path string in meters plus a `fill`
// flag (closed/fillable outlines vs. open detail lines).
//
// The runtime scales these by world_per_meter, then rotates and translates them
// into place. Keeping authoring in meters means a queen bed is always 1.53 m
// wide regardless of the drawing scale — it lines up with the Floorplan node,
// which uses the same world_per_meter convention.

import paper from 'paper';

// Dedicated, isolated paper.js project so transforming furniture paths never
// disturbs the active project the renderer relies on (same pattern as the
// floorplan band-union helper).
let furnProject = null;
function ensureFurnProject() {
  try {
    if (!furnProject) {
      const prev = paper.project;
      const canvas =
        typeof document !== 'undefined' ? document.createElement('canvas') : null;
      if (canvas) paper.setup(canvas);
      else paper.setup(new paper.Size(1, 1));
      furnProject = paper.project;
      if (prev) prev.activate();
    }
    return furnProject;
  } catch {
    return null;
  }
}


export const FURNITURE_TYPES = [
  // --- Beds (bedroom) ---------------------------------------------------------
  { id: 'bed_single', label: 'Single Bed', cat: 'Beds', w: 0.99, h: 1.91 },
  { id: 'bed_double', label: 'Double Bed', cat: 'Beds', w: 1.37, h: 1.91 },
  { id: 'bed_queen', label: 'Queen Bed', cat: 'Beds', w: 1.53, h: 2.03 },
  { id: 'bed_king', label: 'King Bed', cat: 'Beds', w: 1.93, h: 2.03 },
  { id: 'nightstand', label: 'Nightstand', cat: 'Beds', w: 0.45, h: 0.4 },
  { id: 'wardrobe', label: 'Wardrobe', cat: 'Beds', w: 1.2, h: 0.6 },

  // --- Bathroom ---------------------------------------------------------------
  { id: 'toilet', label: 'Toilet', cat: 'Bath', w: 0.45, h: 0.72 },
  { id: 'sink', label: 'Vanity Sink', cat: 'Bath', w: 0.55, h: 0.46 },
  { id: 'pedestal_sink', label: 'Pedestal Sink', cat: 'Bath', w: 0.5, h: 0.42 },
  { id: 'bathtub', label: 'Bathtub', cat: 'Bath', w: 0.75, h: 1.7 },
  { id: 'shower', label: 'Shower', cat: 'Bath', w: 0.9, h: 0.9 },

  // --- Living -----------------------------------------------------------------
  { id: 'sofa_3', label: 'Sofa (3-seat)', cat: 'Living', w: 2.1, h: 0.9 },
  { id: 'loveseat', label: 'Loveseat', cat: 'Living', w: 1.5, h: 0.9 },
  { id: 'armchair', label: 'Armchair', cat: 'Living', w: 0.85, h: 0.85 },
  { id: 'coffee_table', label: 'Coffee Table', cat: 'Living', w: 1.2, h: 0.6 },
  { id: 'tv_unit', label: 'TV Unit', cat: 'Living', w: 1.6, h: 0.4 },

  // --- Dining -----------------------------------------------------------------
  { id: 'dining_4', label: 'Dining Table (4)', cat: 'Dining', w: 1.9, h: 1.9 },
  { id: 'dining_6', label: 'Dining Table (6)', cat: 'Dining', w: 2.0, h: 1.0 },

  // --- Kitchen ----------------------------------------------------------------
  { id: 'range', label: 'Range / Stove', cat: 'Kitchen', w: 0.76, h: 0.66 },
  { id: 'fridge', label: 'Refrigerator', cat: 'Kitchen', w: 0.91, h: 0.74 },
  { id: 'kitchen_sink', label: 'Kitchen Sink', cat: 'Kitchen', w: 0.8, h: 0.55 },
  { id: 'island', label: 'Kitchen Island', cat: 'Kitchen', w: 2.0, h: 1.0 },

  // --- Laundry / utility ------------------------------------------------------
  { id: 'washer', label: 'Washer', cat: 'Laundry', w: 0.6, h: 0.6 },
  { id: 'dryer', label: 'Dryer', cat: 'Laundry', w: 0.6, h: 0.6 },
  { id: 'water_heater', label: 'Water Heater', cat: 'Laundry', w: 0.6, h: 0.6 },
];

// Distinct categories in declaration order, for grouped UI.
export const FURNITURE_CATEGORIES = FURNITURE_TYPES.reduce((acc, t) => {
  if (!acc.includes(t.cat)) acc.push(t.cat);
  return acc;
}, []);

export const FURNITURE_LABELS = Object.fromEntries(
  FURNITURE_TYPES.map((t) => [t.id, t.label])
);

export function furnitureFootprint(type) {
  const t = FURNITURE_TYPES.find((f) => f.id === type);
  return t ? { w: t.w, h: t.h } : { w: 1, h: 1 };
}

function n(v) {
  return Math.round(v * 10000) / 10000;
}

// Axis-aligned rounded rectangle centered at (cx,cy) with size (w,h) and corner
// radius r. Returns a closed SVG path string (meters).
function roundRect(cx, cy, w, h, r) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  const rr = Math.min(r, w / 2, h / 2);
  return (
    `M${n(x + rr)},${n(y)} ` +
    `L${n(x + w - rr)},${n(y)} ` +
    `A${n(rr)},${n(rr)} 0 0 1 ${n(x + w)},${n(y + rr)} ` +
    `L${n(x + w)},${n(y + h - rr)} ` +
    `A${n(rr)},${n(rr)} 0 0 1 ${n(x + w - rr)},${n(y + h)} ` +
    `L${n(x + rr)},${n(y + h)} ` +
    `A${n(rr)},${n(rr)} 0 0 1 ${n(x)},${n(y + h - rr)} ` +
    `L${n(x)},${n(y + rr)} ` +
    `A${n(rr)},${n(rr)} 0 0 1 ${n(x + rr)},${n(y)} Z`
  );
}

function rect(cx, cy, w, h) {
  const x = cx - w / 2;
  const y = cy - h / 2;
  return `M${n(x)},${n(y)} L${n(x + w)},${n(y)} L${n(x + w)},${n(y + h)} L${n(x)},${n(y + h)} Z`;
}

function ellipse(cx, cy, rx, ry) {
  return (
    `M${n(cx - rx)},${n(cy)} ` +
    `A${n(rx)},${n(ry)} 0 0 1 ${n(cx + rx)},${n(cy)} ` +
    `A${n(rx)},${n(ry)} 0 0 1 ${n(cx - rx)},${n(cy)} Z`
  );
}

function line(x1, y1, x2, y2) {
  return `M${n(x1)},${n(y1)} L${n(x2)},${n(y2)}`;
}

// --- Individual pieces -------------------------------------------------------

// A single chair (seat + back bar) facing +Y, centered at origin, returned as
// strokes carrying their own local rot/translate so callers can place several.
function chairStrokes(cx, cy, side, chairW = 0.46, chairD = 0.46) {
  const seat = roundRect(0, 0, chairW, chairD, 0.05);
  const backBar = rect(0, -chairD / 2 + 0.04, chairW, 0.06);
  const rot = side * 90;
  return [
    { d: seat, fill: true, rot, tx: cx, ty: cy },
    { d: backBar, fill: true, rot, tx: cx, ty: cy },
  ];
}

function bed(w, h) {
  const strokes = [];
  // Mattress outline.
  strokes.push({ d: roundRect(0, 0, w, h, 0.06), fill: true });
  const headY = -h / 2 + 0.12;
  const pillowH = 0.34;
  // Single/twin beds get one pillow; wider beds get two.
  if (w < 1.15) {
    const pillowW = w - 0.18;
    strokes.push({ d: roundRect(0, headY + pillowH / 2, pillowW, pillowH, 0.04), fill: true });
  } else {
    const pillowW = (w - 0.18) / 2 - 0.04;
    strokes.push({ d: roundRect(-w / 4 - 0.01, headY + pillowH / 2, pillowW, pillowH, 0.04), fill: true });
    strokes.push({ d: roundRect(w / 4 + 0.01, headY + pillowH / 2, pillowW, pillowH, 0.04), fill: true });
  }
  // Blanket fold line across the bed.
  const foldY = -h / 2 + 0.62;
  strokes.push({ d: line(-w / 2, foldY, w / 2, foldY), fill: false });
  return strokes;
}

function nightstand(w, h) {
  return [
    { d: rect(0, 0, w, h), fill: true },
    { d: rect(0, 0, w - 0.1, h - 0.1), fill: false }, // drawer inset
  ];
}

function wardrobe(w, h) {
  const strokes = [{ d: rect(0, 0, w, h), fill: true }];
  // Two doors with a center split and a diagonal swing hint.
  strokes.push({ d: line(0, -h / 2, 0, h / 2), fill: false });
  strokes.push({ d: line(-w / 2, -h / 2, -0.02, h / 2 - 0.02), fill: false });
  strokes.push({ d: line(w / 2, -h / 2, 0.02, h / 2 - 0.02), fill: false });
  return strokes;
}

function toilet(w, h) {
  const strokes = [];
  // Tank at the back (top).
  const tankH = h * 0.28;
  strokes.push({ d: roundRect(0, -h / 2 + tankH / 2, w, tankH, 0.03), fill: true });
  // Bowl: an oval below the tank.
  const bowlCy = -h / 2 + tankH + (h - tankH) / 2;
  strokes.push({ d: ellipse(0, bowlCy, w / 2 - 0.02, (h - tankH) / 2 - 0.02), fill: true });
  // Seat opening (inner oval).
  strokes.push({ d: ellipse(0, bowlCy, w / 2 - 0.09, (h - tankH) / 2 - 0.09), fill: false });
  return strokes;
}

function sink(w, h) {
  const strokes = [];
  // Counter / vanity outline.
  strokes.push({ d: rect(0, 0, w, h), fill: true });
  // Basin (rounded rect inset).
  strokes.push({ d: roundRect(0, 0.03, w - 0.14, h - 0.16, 0.05), fill: false });
  // Faucet + two taps along the back edge.
  const backY = -h / 2 + 0.05;
  strokes.push({ d: ellipse(0, backY, 0.03, 0.03), fill: false });
  strokes.push({ d: ellipse(-0.1, backY, 0.02, 0.02), fill: false });
  strokes.push({ d: ellipse(0.1, backY, 0.02, 0.02), fill: false });
  return strokes;
}

// Wall-hung / pedestal sink: rounded basin with a small pedestal foot.
function pedestalSink(w, h) {
  const strokes = [];
  strokes.push({ d: roundRect(0, -0.02, w, h - 0.04, 0.08), fill: true });
  strokes.push({ d: ellipse(0, 0, w / 2 - 0.07, (h - 0.04) / 2 - 0.07), fill: false }); // basin
  strokes.push({ d: ellipse(0, -h / 2 + 0.06, 0.025, 0.025), fill: false }); // faucet
  strokes.push({ d: rect(0, h / 2 - 0.08, 0.16, 0.12), fill: false }); // pedestal foot
  return strokes;
}

function bathtub(w, h) {
  const strokes = [];
  // Outer tub deck.
  strokes.push({ d: roundRect(0, 0, w, h, 0.06), fill: true });
  // Inner basin (offset toward the foot end, leaving a deck at the head).
  const basinW = w - 0.14;
  const basinH = h - 0.28;
  strokes.push({ d: roundRect(0, 0.05, basinW, basinH, 0.18), fill: false });
  // Drain + faucet at the head end (top).
  strokes.push({ d: ellipse(0, -h / 2 + 0.1, 0.03, 0.03), fill: false });
  return strokes;
}

function shower(w, h) {
  const strokes = [];
  strokes.push({ d: rect(0, 0, w, h), fill: true });
  // Drain in the center + diagonal "glass" hint to a corner.
  strokes.push({ d: ellipse(0, 0, 0.04, 0.04), fill: false });
  strokes.push({ d: line(-w / 2, -h / 2, w / 2, h / 2), fill: false });
  return strokes;
}

// Upholstered sofa facing +Y (seat opening toward the bottom). `seats` controls
// how many seat-cushion divisions are drawn.
function sofa(w, h, seats) {
  const strokes = [];
  const armW = 0.18;
  const backH = 0.2;
  // Body.
  strokes.push({ d: roundRect(0, 0, w, h, 0.08), fill: true });
  // Backrest (top band).
  strokes.push({ d: line(-w / 2 + 0.02, -h / 2 + backH, w / 2 - 0.02, -h / 2 + backH), fill: false });
  // Arms (left & right vertical lines).
  strokes.push({ d: line(-w / 2 + armW, -h / 2 + backH, -w / 2 + armW, h / 2 - 0.02), fill: false });
  strokes.push({ d: line(w / 2 - armW, -h / 2 + backH, w / 2 - armW, h / 2 - 0.02), fill: false });
  // Seat cushion divisions.
  const innerW = w - 2 * armW;
  for (let i = 1; i < seats; i++) {
    const x = -innerW / 2 + (innerW / seats) * i;
    strokes.push({ d: line(x, -h / 2 + backH, x, h / 2 - 0.04), fill: false });
  }
  return strokes;
}

function armchair(w, h) {
  const strokes = [];
  strokes.push({ d: roundRect(0, 0, w, h, 0.08), fill: true });
  const armW = 0.16;
  const backH = 0.2;
  strokes.push({ d: line(-w / 2 + 0.02, -h / 2 + backH, w / 2 - 0.02, -h / 2 + backH), fill: false });
  strokes.push({ d: line(-w / 2 + armW, -h / 2 + backH, -w / 2 + armW, h / 2 - 0.02), fill: false });
  strokes.push({ d: line(w / 2 - armW, -h / 2 + backH, w / 2 - armW, h / 2 - 0.02), fill: false });
  return strokes;
}

function coffeeTable(w, h) {
  return [
    { d: roundRect(0, 0, w, h, 0.04), fill: true },
    { d: roundRect(0, 0, w - 0.12, h - 0.12, 0.03), fill: false },
  ];
}

function tvUnit(w, h) {
  const strokes = [{ d: rect(0, 0, w, h), fill: true }];
  // Door splits.
  strokes.push({ d: line(-w / 6, -h / 2, -w / 6, h / 2), fill: false });
  strokes.push({ d: line(w / 6, -h / 2, w / 6, h / 2), fill: false });
  return strokes;
}

// Square dining table with one chair on each side.
function dining4() {
  const strokes = [];
  const tableW = 1.0;
  const chairD = 0.46;
  const gap = 0.06;
  strokes.push({ d: rect(0, 0, tableW, tableW), fill: true });
  const off = tableW / 2 + gap + chairD / 2;
  strokes.push(...chairStrokes(0, -off, 2));
  strokes.push(...chairStrokes(0, off, 0));
  strokes.push(...chairStrokes(-off, 0, 1));
  strokes.push(...chairStrokes(off, 0, 3));
  return strokes;
}

// Rectangular dining table with three chairs on each long side.
function dining6(w, h) {
  const strokes = [];
  const tableW = w - 0.6; // leave room for chairs at the ends
  const tableH = h - 0.0;
  const tableD = Math.min(tableH, 0.9);
  strokes.push({ d: roundRect(0, 0, tableW, tableD, 0.04), fill: true });
  const chairD = 0.46;
  const off = tableD / 2 + 0.06 + chairD / 2;
  const xs = [-tableW / 2 + tableW / 6, 0, tableW / 2 - tableW / 6];
  for (const x of xs) {
    strokes.push(...chairStrokes(x, -off, 2)); // top row
    strokes.push(...chairStrokes(x, off, 0)); // bottom row
  }
  return strokes;
}

// 4-burner range / cooktop.
function range(w, h) {
  const strokes = [{ d: rect(0, 0, w, h), fill: true }];
  const bx = w / 4, by = h / 4;
  const br = Math.min(w, h) * 0.18;
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      strokes.push({ d: ellipse(sx * bx, sy * by, br, br), fill: false });
    }
  }
  return strokes;
}

function fridge(w, h) {
  const strokes = [{ d: rect(0, 0, w, h), fill: true }];
  // Freezer/fridge split + a handle hint.
  strokes.push({ d: line(-w / 2, -h / 2 + h * 0.35, w / 2, -h / 2 + h * 0.35), fill: false });
  strokes.push({ d: line(w / 2 - 0.06, -h / 2 + h * 0.45, w / 2 - 0.06, h / 2 - 0.06), fill: false });
  return strokes;
}

// Double-basin kitchen sink set in a counter run.
function kitchenSink(w, h) {
  const strokes = [{ d: rect(0, 0, w, h), fill: true }];
  const basinW = w / 2 - 0.1;
  const basinH = h - 0.16;
  strokes.push({ d: roundRect(-w / 4, 0.02, basinW, basinH, 0.04), fill: false });
  strokes.push({ d: roundRect(w / 4, 0.02, basinW, basinH, 0.04), fill: false });
  strokes.push({ d: ellipse(0, -h / 2 + 0.06, 0.03, 0.03), fill: false }); // faucet
  return strokes;
}

// Kitchen island with bar stools along one long side.
function island(w, h) {
  const strokes = [];
  const counterH = Math.min(h - 0.5, 0.7);
  strokes.push({ d: rect(0, -0.18, w, counterH), fill: true });
  // Stools along the bottom edge of the counter.
  const stoolR = 0.18;
  const n = Math.max(2, Math.floor((w - 0.2) / 0.5));
  const stoolY = -0.18 + counterH / 2 + 0.06 + stoolR;
  for (let i = 0; i < n; i++) {
    const x = -w / 2 + (w / (n + 1)) * (i + 1);
    strokes.push({ d: ellipse(x, stoolY, stoolR, stoolR), fill: false });
  }
  return strokes;
}

function applianceBox(w, h, round) {
  const strokes = [{ d: rect(0, 0, w, h), fill: true }];
  // Circular door / drum.
  strokes.push({ d: ellipse(0, 0.03, Math.min(w, h) / 2 - 0.08, Math.min(w, h) / 2 - 0.08), fill: false });
  // Control panel band at the back.
  strokes.push({ d: line(-w / 2, -h / 2 + 0.1, w / 2, -h / 2 + 0.1), fill: false });
  if (round) strokes.push({ d: ellipse(-w / 2 + 0.08, -h / 2 + 0.05, 0.02, 0.02), fill: false });
  return strokes;
}

function waterHeater(w, h) {
  const r = Math.min(w, h) / 2;
  return [
    { d: ellipse(0, 0, r, r), fill: true },
    { d: ellipse(0, 0, r - 0.05, r - 0.05), fill: false },
  ];
}

// Return the local-space strokes for a furniture type. Each stroke: { d, fill,
// and optional local rot/tx/ty applied to that stroke only }.
export function furnitureSymbol(type) {
  const { w, h } = furnitureFootprint(type);
  switch (type) {
    case 'bed_single':
    case 'bed_double':
    case 'bed_queen':
    case 'bed_king':
      return bed(w, h);
    case 'nightstand':
      return nightstand(w, h);
    case 'wardrobe':
      return wardrobe(w, h);
    case 'toilet':
      return toilet(w, h);
    case 'sink':
      return sink(w, h);
    case 'pedestal_sink':
      return pedestalSink(w, h);
    case 'bathtub':
      return bathtub(w, h);
    case 'shower':
      return shower(w, h);
    case 'sofa_3':
      return sofa(w, h, 3);
    case 'loveseat':
      return sofa(w, h, 2);
    case 'armchair':
      return armchair(w, h);
    case 'coffee_table':
      return coffeeTable(w, h);
    case 'tv_unit':
      return tvUnit(w, h);
    case 'dining_4':
      return dining4();
    case 'dining_6':
      return dining6(w, h);
    case 'range':
      return range(w, h);
    case 'fridge':
      return fridge(w, h);
    case 'kitchen_sink':
      return kitchenSink(w, h);
    case 'island':
      return island(w, h);
    case 'washer':
      return applianceBox(w, h, false);
    case 'dryer':
      return applianceBox(w, h, true);
    case 'water_heater':
      return waterHeater(w, h);
    default:
      return [{ d: rect(0, 0, w, h), fill: true }];
  }
}

// Resolve a furniture ITEM into world-space strokes ready to render.
//   item: { type, x, y, rot (deg), scale }   — x,y are WORLD-unit center.
//   worldPerMeter: meters -> world units multiplier.
// Returns { strokes: [{ d, fill }], bounds } in world coordinates, or null.
export function resolveFurniture(item, worldPerMeter) {
  if (!item || !item.type) return null;
  const proj = ensureFurnProject();
  if (!proj) return null;

  const wpm = worldPerMeter > 0 ? worldPerMeter : 100;
  const userScale = Number(item.scale) > 0 ? Number(item.scale) : 1;
  const s = wpm * userScale;          // meters -> world units (incl. user scale)
  const rot = Number(item.rot) || 0;  // degrees
  const tx = Number(item.x) || 0;
  const ty = Number(item.y) || 0;

  const local = furnitureSymbol(item.type);
  const prev = paper.project;
  proj.activate();
  try {
    const outStrokes = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const stroke of local) {
      const path = new paper.Path(stroke.d);
      // Per-stroke local transform (used by composite pieces like the chairs).
      if (stroke.rot) path.rotate(stroke.rot, new paper.Point(0, 0));
      if (stroke.tx || stroke.ty) path.translate(new paper.Point(stroke.tx || 0, stroke.ty || 0));
      // Item transform: scale (meters->world), rotate, translate to position.
      path.scale(s, new paper.Point(0, 0));
      if (rot) path.rotate(rot, new paper.Point(0, 0));
      path.translate(new paper.Point(tx, ty));

      const d = path.pathData;
      const b = path.bounds;
      if (b) {
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width); maxY = Math.max(maxY, b.y + b.height);
      }
      path.remove();
      if (d) outStrokes.push({ d, fill: !!stroke.fill });
    }
    proj.activeLayer.removeChildren();
    if (outStrokes.length === 0) return null;
    return {
      strokes: outStrokes,
      bounds: isFinite(minX)
        ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
        : undefined,
    };
  } catch {
    return null;
  } finally {
    if (prev) prev.activate();
  }
}

// Lightweight world-space footprint (axis-aligned, ignoring rotation) used by
// the overlay for hit-testing and the rotate-handle placement.
export function furnitureWorldFootprint(item, worldPerMeter) {
  const { w, h } = furnitureFootprint(item.type);
  const wpm = worldPerMeter > 0 ? worldPerMeter : 100;
  const s = wpm * (Number(item.scale) > 0 ? Number(item.scale) : 1);
  return { w: w * s, h: h * s };
}
