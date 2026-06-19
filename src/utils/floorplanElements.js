// Wall-hosted architectural elements (doors, windows, openings) for the
// Floorplan node. Elements are stored against a host wall by (wall, seg, t,
// width) and resolved against the SOLVED/driven wall chains at evaluation time,
// so they stay glued to their wall as it is drawn, dimensioned, or moved.
//
// Shared by the runtime (src/nodes/floorplan.js) and the overlay
// (src/components/viewport/FloorplanOverlay.jsx).

export const ELEMENT_TYPES = ['door', 'window', 'opening'];

// Sensible default opening widths in WORLD units assume world_per_meter = 100.
// The overlay scales these by the node's actual world_per_meter when placing.
export const DEFAULT_WIDTH_M = { door: 0.9, window: 1.2, opening: 1.0 };

function fmt(n) {
  return Math.round(n * 1000) / 1000;
}

function segLength(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

// Resolve an element to concrete geometry on the given driven chains. Returns
// null if the host segment no longer exists. `clamped` is true when the opening
// had to be shrunk/shifted to fit within its segment (wall too short).
export function resolveElement(el, chains) {
  if (!el || !Array.isArray(chains)) return null;
  const chain = chains[el.wall];
  if (!chain || chain.length < 2) return null;
  const seg = Math.max(0, Math.min(el.seg ?? 0, chain.length - 2));
  const a = chain[seg];
  const b = chain[seg + 1];
  if (!a || !b) return null;

  const length = segLength(a, b);
  if (length < 1e-6) return null;

  const dir = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
  const normal = { x: -dir.y, y: dir.x };

  let width = Math.max(1, el.width ?? 0);
  let clamped = false;
  // The opening cannot exceed the segment length (leave a tiny stub at ends).
  const maxWidth = Math.max(1, length - 2);
  if (width > maxWidth) { width = maxWidth; clamped = true; }

  const half = width / 2;
  // Center distance along the segment from `a`, clamped so the opening stays on
  // the segment.
  let centerDist = (el.t ?? 0.5) * length;
  if (centerDist < half) { centerDist = half; clamped = true; }
  if (centerDist > length - half) { centerDist = length - half; clamped = true; }

  const center = { x: a.x + dir.x * centerDist, y: a.y + dir.y * centerDist };
  const p1 = { x: center.x - dir.x * half, y: center.y - dir.y * half }; // toward a
  const p2 = { x: center.x + dir.x * half, y: center.y + dir.y * half }; // toward b

  return { _wall: el.wall, chain, seg, a, b, length, dir, normal, width, half, center, p1, p2, clamped };
}

// Split chains so each opening leaves a gap. A segment with one opening becomes
// two segments (a..p1) and (p2..b). Multiple openings on one segment are handled
// by sorting their cut intervals along the segment. Returns NEW chains.
export function cutOpeningsFromChains(chains, resolved) {
  // Group cut intervals (by distance-from-start) per "wall:seg".
  const cutsByKey = new Map();
  for (const r of resolved) {
    if (!r) continue;
    const key = `${r._wall}:${r.seg}`;
    const d1 = dot(r.p1, r.a, r.dir);
    const d2 = dot(r.p2, r.a, r.dir);
    const lo = Math.min(d1, d2);
    const hi = Math.max(d1, d2);
    if (!cutsByKey.has(key)) cutsByKey.set(key, []);
    cutsByKey.get(key).push([lo, hi]);
  }

  const out = [];
  for (let wi = 0; wi < chains.length; wi++) {
    const chain = chains[wi];
    if (!chain || chain.length < 2) { if (chain) out.push(chain); continue; }
    // Walk each segment; emit sub-polylines broken at any cut intervals.
    let pending = [chain[0]];
    for (let si = 0; si < chain.length - 1; si++) {
      const a = chain[si];
      const b = chain[si + 1];
      const len = segLength(a, b);
      const dir = len > 1e-6 ? { x: (b.x - a.x) / len, y: (b.y - a.y) / len } : { x: 1, y: 0 };
      const cuts = (cutsByKey.get(`${wi}:${si}`) || [])
        .map(([lo, hi]) => [Math.max(0, lo), Math.min(len, hi)])
        .filter(([lo, hi]) => hi > lo)
        .sort((u, v) => u[0] - v[0]);

      if (cuts.length === 0) {
        pending.push(b);
        continue;
      }
      // There are gaps in this segment: end the current run at the first cut,
      // then resume after each gap.
      let cursor = 0;
      for (const [lo, hi] of cuts) {
        if (lo > cursor + 1e-6) {
          // emit run from cursor..lo
          pending.push(ptAt(a, dir, lo));
          out.push(pending);
        } else {
          // run started inside a gap; drop the degenerate pending start
          if (pending.length >= 2) out.push(pending);
        }
        // start a fresh run at hi
        pending = [ptAt(a, dir, hi)];
        cursor = hi;
      }
      // finish remaining piece up to b
      pending.push(b);
    }
    if (pending.length >= 2) out.push(pending);
  }
  return out.filter((c) => c.length >= 2);
}

function dot(p, origin, dir) {
  return (p.x - origin.x) * dir.x + (p.y - origin.y) * dir.y;
}
function ptAt(origin, dir, d) {
  return { x: origin.x + dir.x * d, y: origin.y + dir.y * d };
}

// Build the SVG symbol pathData for one resolved element. `half` here is the
// wall half-thickness, used to size jambs and the door leaf depth.
export function elementSymbolPaths(el, r, wallHalf) {
  if (!r) return [];
  const { p1, p2, dir, normal, width } = r;
  const out = [];

  // Jamb ticks across the wall thickness at each opening end (both element types
  // get them; they read as the door/window frame).
  const jamb = (p) => {
    const ax = p.x + normal.x * wallHalf, ay = p.y + normal.y * wallHalf;
    const bx = p.x - normal.x * wallHalf, by = p.y - normal.y * wallHalf;
    return `M${fmt(ax)},${fmt(ay)} L${fmt(bx)},${fmt(by)}`;
  };

  if (el.type === 'opening') {
    out.push({ d: `${jamb(p1)} ${jamb(p2)}`, fill: 'none' });
    return out;
  }

  if (el.type === 'window') {
    out.push({ d: `${jamb(p1)} ${jamb(p2)}`, fill: 'none' });
    // Glass: two thin parallel lines spanning the gap, offset to each side of
    // the centerline by a fraction of the wall thickness.
    const off = wallHalf * 0.4;
    const g1a = { x: p1.x + normal.x * off, y: p1.y + normal.y * off };
    const g1b = { x: p2.x + normal.x * off, y: p2.y + normal.y * off };
    const g2a = { x: p1.x - normal.x * off, y: p1.y - normal.y * off };
    const g2b = { x: p2.x - normal.x * off, y: p2.y - normal.y * off };
    out.push({
      d: `M${fmt(g1a.x)},${fmt(g1a.y)} L${fmt(g1b.x)},${fmt(g1b.y)} ` +
         `M${fmt(g2a.x)},${fmt(g2a.y)} L${fmt(g2b.x)},${fmt(g2b.y)}`,
      fill: 'none',
    });
    return out;
  }

  // Door: hinge at one opening end, leaf swings to the swing side.
  const hingeAtP1 = (el.hinge ?? 'left') === 'left';
  const hinge = hingeAtP1 ? p1 : p2;
  const latch = hingeAtP1 ? p2 : p1;
  // Swing side: +normal or -normal.
  const swingSign = (el.swing ?? 'in') === 'in' ? 1 : -1;
  const ns = { x: normal.x * swingSign, y: normal.y * swingSign };

  // Leaf is drawn fully open: from hinge, perpendicular into the room, length =
  // opening width. Arc connects the open leaf tip back to the latch jamb.
  const tip = { x: hinge.x + ns.x * width, y: hinge.y + ns.y * width };

  out.push({ d: `${jamb(p1)} ${jamb(p2)}`, fill: 'none' });
  // Leaf line.
  out.push({ d: `M${fmt(hinge.x)},${fmt(hinge.y)} L${fmt(tip.x)},${fmt(tip.y)}`, fill: 'none' });
  // Swing arc from leaf tip to the latch point (quarter circle, radius = width).
  // Determine sweep flag from the cross product of (leaf dir) x (chord dir).
  const sweep = swingArcSweep(hinge, tip, latch);
  out.push({
    d: `M${fmt(tip.x)},${fmt(tip.y)} A${fmt(width)},${fmt(width)} 0 0 ${sweep} ${fmt(latch.x)},${fmt(latch.y)}`,
    fill: 'none',
    dashed: true,
  });
  return out;
}

// Choose the SVG arc sweep flag so the swing arc bulges toward the swing side.
function swingArcSweep(hinge, tip, latch) {
  // Vector hinge->tip (the open leaf) and hinge->latch (the closed leaf along
  // the wall). The arc goes from tip to latch around the hinge. Sweep flag is 1
  // if the turn is clockwise (cross product sign).
  const v1 = { x: tip.x - hinge.x, y: tip.y - hinge.y };
  const v2 = { x: latch.x - hinge.x, y: latch.y - hinge.y };
  const cross = v1.x * v2.y - v1.y * v2.x;
  return cross > 0 ? 1 : 0;
}
