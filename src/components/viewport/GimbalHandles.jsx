import { useState, useCallback } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { useAnimationStore } from '../../store/animationStore';
import { extractPoints } from '../../utils/geometryPoints';

const HANDLE_SIZE = 8;
const HANDLE_COLOR = '#4263eb';
const HANDLE_FILL = '#ffffff';

// Rotate a world-space delta (dx, dy) by -deg so it's expressed in a shape's
// local (unrotated) axes — used so a rotated rectangle/ellipse resizes along its
// own edges rather than the world axes.
function unrotateDelta(dx, dy, deg) {
  if (!deg) return [dx, dy];
  const r = -deg * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return [dx * c - dy * s, dx * s + dy * c];
}

// Rotate a local-frame vector by +deg back into world space.
function rotateVec(dx, dy, deg) {
  if (!deg) return [dx, dy];
  const r = deg * Math.PI / 180;
  const c = Math.cos(r), s = Math.sin(r);
  return [dx * c - dy * s, dx * s + dy * c];
}

export default function GimbalHandles({ geometry, node, definition, screenToSvg, viewBox, snapEnabled = false, snapCandidates = [], worldPerPixel = 1 }) {
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);
  const [dragging, setDragging] = useState(null);
  const [snapMark, setSnapMark] = useState(null);

  const defId = definition.id;

  const startDrag = useCallback((type, e) => {
    e.stopPropagation();
    e.preventDefault();
    // Own snap points of the selected shape, captured at drag start: its vertices
    // PLUS edge midpoints, so the middle of an edge can latch onto a target too
    // (not just the corners). During a move we translate these by (dx,dy) and look
    // for the nearest candidate to latch on.
    const ownPoints = snapEnabled ? withEdgeMidpoints(safeExtractPoints(geometry)) : [];
    const startParams = { ...node.data.params };
    const startX = e.clientX;
    const startY = e.clientY;
    setDragging({ type });
    useGraphStore.getState().beginOperation();

    // Snap radius in world units for a constant ~14px on-screen catch distance.
    const snapDist = (worldPerPixel || 1) * 14;

    const handleMove = (me) => {
      const svgStart = screenToSvg(startX, startY);
      const svgCurrent = screenToSvg(me.clientX, me.clientY);
      let dx = svgCurrent.x - svgStart.x;
      let dy = svgCurrent.y - svgStart.y;
      const mods = { shift: me.shiftKey, alt: me.altKey };

      // Snap-to-points on a plain move (Alt temporarily disables snapping — the
      // usual "free move" escape hatch). Find the shape point closest to any
      // candidate and offset the whole drag so it lands exactly on it.
      if (snapEnabled && type === 'move' && !me.altKey && ownPoints.length && snapCandidates.length) {
        const snap = findSnap(ownPoints, dx, dy, snapCandidates, snapDist);
        if (snap) {
          dx += snap.ox;
          dy += snap.oy;
          setSnapMark({ x: snap.tx, y: snap.ty });
        } else {
          setSnapMark(null);
        }
      } else {
        setSnapMark(null);
      }

      applyDrag(type, dx, dy, startParams, node.id, defId, updateNodeParams, mods, {
        startX: svgStart.x, startY: svgStart.y, curX: svgCurrent.x, curY: svgCurrent.y,
      });
    };

    const handleUp = () => {
      setDragging(null);
      setSnapMark(null);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      useGraphStore.getState().endOperation();
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [node, defId, screenToSvg, updateNodeParams, geometry, snapEnabled, snapCandidates, worldPerPixel]);

  if (!geometry) return null;

  const u = viewBox ? viewBox.w / 800 : 1;
  const snapOverlay = snapMark ? (
    <g pointerEvents="none">
      <circle cx={snapMark.x} cy={snapMark.y} r={6 * u} fill="none" stroke="#e8590c" strokeWidth={1.5 * u} />
      <line x1={snapMark.x - 9 * u} y1={snapMark.y} x2={snapMark.x + 9 * u} y2={snapMark.y} stroke="#e8590c" strokeWidth={1.2 * u} />
      <line x1={snapMark.x} y1={snapMark.y - 9 * u} x2={snapMark.x} y2={snapMark.y + 9 * u} stroke="#e8590c" strokeWidth={1.2 * u} />
    </g>
  ) : null;

  let handles;
  if (defId === 'line') handles = renderLineHandles(geometry, startDrag);
  else if (defId === 'rectangle') {
    const rot = node.data.params.rotation || 0;
    handles = renderBoxHandles(geometry, startDrag, viewBox, rot, rotCenter(node));
  } else if (defId === 'circle') {
    const rot = node.data.params.rotation || 0;
    handles = renderBoxHandles(geometry.bounds, startDrag, viewBox, rot, rotCenter(node));
  } else if (defId === 'polygon') {
    // Polygon's own `rotation` already bakes into its geometry, so its bounding
    // box is axis-aligned in world space — the box gizmo must NOT re-rotate. The
    // rotate handle still edits the `rotation` param.
    handles = renderBoxHandles(geometry.bounds, startDrag, viewBox, 0, rotCenter(node));
  } else if (defId === 'transform') handles = renderTransformHandles(geometry, node, startDrag, viewBox);
  else handles = renderBoundsHandles(geometry, startDrag);

  return (
    <g>
      {handles}
      {snapOverlay}
    </g>
  );
}

// Extract a shape's own vertices without throwing — used to build the moving
// point set for snapping.
function safeExtractPoints(geo) {
  try {
    return extractPoints(geo).map((p) => ({ x: p.x, y: p.y }));
  } catch {
    return [];
  }
}

// Add the midpoint of each edge (consecutive vertex pair, treated as a closed
// loop) so the middle of an edge can snap onto a target, not just corners.
function withEdgeMidpoints(points) {
  if (!points || points.length < 2) return points || [];
  const out = points.slice();
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    out.push({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  }
  return out;
}

// Given the shape's own points and the current drag delta, find the single
// (own point → candidate) pair within `dist` that is closest, and return the
// extra offset (ox, oy) that lands that own point exactly on the candidate,
// plus the candidate location (tx, ty) for the on-screen marker.
function findSnap(ownPoints, dx, dy, candidates, dist) {
  let best = null;
  const d2Max = dist * dist;
  for (const op of ownPoints) {
    const px = op.x + dx;
    const py = op.y + dy;
    for (const c of candidates) {
      const ddx = c.x - px;
      const ddy = c.y - py;
      const d2 = ddx * ddx + ddy * ddy;
      if (d2 <= d2Max && (!best || d2 < best.d2)) {
        best = { d2, ox: ddx, oy: ddy, tx: c.x, ty: c.y };
      }
    }
  }
  return best;
}

// The world-space center a shape rotates about (its x/y position params).
function rotCenter(node) {
  const p = node.data.params || {};
  return { x: p.x || 0, y: p.y || 0 };
}

function applyDrag(type, dx, dy, startParams, nodeId, defId, updateNodeParams, mods = {}, pts = null) {
  const { enabled: animEnabled, currentFrame, keyframes, setKeyframe } = useAnimationStore.getState();
  const nodeKfs = keyframes[nodeId] || {};

  const applyParam = (params) => {
    updateNodeParams(nodeId, params);
    if (animEnabled) {
      for (const [paramId, val] of Object.entries(params)) {
        if (nodeKfs[paramId] && Object.keys(nodeKfs[paramId]).length > 0) {
          setKeyframe(nodeId, paramId, currentFrame, val);
        }
      }
    }
  };

  // Rotation is generic across rectangle/circle/polygon: rotate about the shape
  // center (its x/y params) by the pointer's angular change since drag start.
  if (type === 'rotate' && pts) {
    const cx = startParams.x || 0;
    const cy = startParams.y || 0;
    const a0 = Math.atan2(pts.startY - cy, pts.startX - cx);
    const a1 = Math.atan2(pts.curY - cy, pts.curX - cx);
    let deg = (startParams.rotation || 0) + (a1 - a0) * 180 / Math.PI;
    if (mods.shift) deg = Math.round(deg / 15) * 15; // snap to 15° like Illustrator
    // Normalize to a friendly range and round to a tenth of a degree.
    deg = Math.round(deg * 10) / 10;
    while (deg > 360) deg -= 360;
    while (deg < -360) deg += 360;
    applyParam({ rotation: deg });
    return;
  }

  if (defId === 'line') {
    if (type === 'endpoint') {
      const startLen = startParams.length || 200;
      const startAngle = (startParams.angle || 0) * Math.PI / 180;
      const ex = startLen * Math.cos(startAngle) + dx;
      const ey = startLen * Math.sin(startAngle) + dy;
      const newLen = Math.max(1, Math.sqrt(ex * ex + ey * ey));
      const newAngle = (Math.atan2(ey, ex) * 180) / Math.PI;
      applyParam({ length: Math.round(newLen), angle: Math.round(newAngle * 10) / 10 });
    }
  } else if (defId === 'rectangle') {
    if (type === 'move') {
      applyParam({
        x: Math.round(startParams.x + dx),
        y: Math.round(startParams.y + dy),
      });
    } else {
      // Rotate the world-space drag delta into the shape's local (unrotated)
      // frame so a rotated rectangle still resizes along its own edges.
      const [ldx, ldy] = unrotateDelta(dx, dy, startParams.rotation || 0);
      applyRectResize(type, ldx, ldy, startParams, applyParam, mods, startParams.rotation || 0);
    }
  } else if (defId === 'circle') {
    if (type === 'move') {
      applyParam({ x: Math.round(startParams.x + dx), y: Math.round(startParams.y + dy) });
    } else {
      const [ldx, ldy] = unrotateDelta(dx, dy, startParams.rotation || 0);
      applyCircleResize(type, ldx, ldy, startParams, applyParam, mods, startParams.rotation || 0);
    }
  } else if (defId === 'polygon') {
    if (type === 'move') {
      applyParam({ x: Math.round(startParams.x + dx), y: Math.round(startParams.y + dy) });
    } else {
      applyPolygonResize(type, dx, dy, startParams, applyParam);
    }
  } else if (defId === 'transform') {
    if (type === 'translate') {
      applyParam({
        translate_x: Math.round(startParams.translate_x + dx),
        translate_y: Math.round(startParams.translate_y + dy),
      });
    }
    if (type === 'pivot') {
      applyParam({
        pivot_x: Math.round((startParams.pivot_x || 0) + dx),
        pivot_y: Math.round((startParams.pivot_y || 0) + dy),
      });
    }
  } else {
    if (type === 'move') {
      if (startParams.x !== undefined) {
        applyParam({
          x: Math.round((startParams.x || 0) + dx),
          y: Math.round((startParams.y || 0) + dy),
        });
      }
    }
  }
}

// Illustrator-style corner/edge resize for the rectangle. The handle `type`
// encodes which corner/edge is being dragged (resize-tl/tr/bl/br/t/b/l/r). By
// default the OPPOSITE corner/edge stays pinned (grab a corner, drag it, the far
// corner doesn't move) — the intuitive behavior people expect from vector tools,
// as opposed to the old scale-from-center. Modifiers match Illustrator:
//   • Shift on a corner  -> preserve aspect ratio
//   • Alt/Option         -> resize symmetrically about the center (opposite side
//                           mirrors instead of staying pinned)
// The runtime stores x/y as the CENTER and multiplies width/height by `scale`,
// so we work in world space, then write back width/height (divided by scale)
// plus a re-centered x/y.
function applyRectResize(type, dx, dy, startParams, applyParam, mods, rotDeg = 0) {
  const s = startParams.scale || 1;
  const startX = startParams.x || 0;
  const startY = startParams.y || 0;
  const startW = (startParams.width || 1) * s;   // world-space size
  const startH = (startParams.height || 1) * s;

  // World-space edges at drag start.
  const left = startX - startW / 2;
  const right = startX + startW / 2;
  const top = startY - startH / 2;
  const bottom = startY + startH / 2;

  // Which edges this handle moves: -1 = left/top edge, +1 = right/bottom edge,
  // 0 = that axis is unaffected.
  const H = { tl: [-1, -1], tr: [1, -1], bl: [-1, 1], br: [1, 1],
    t: [0, -1], b: [0, 1], l: [-1, 0], r: [1, 0] };
  const key = type.replace('resize-', '');
  const [ex, ey] = H[key] || [0, 0];

  // New moving edges (the fixed edges stay put).
  let newLeft = left, newRight = right, newTop = top, newBottom = bottom;
  if (ex < 0) newLeft = left + dx;
  else if (ex > 0) newRight = right + dx;
  if (ey < 0) newTop = top + dy;
  else if (ey > 0) newBottom = bottom + dy;

  const MIN = 1; // world-space minimum size
  let newW = Math.max(MIN, newRight - newLeft);
  let newH = Math.max(MIN, newBottom - newTop);

  // Aspect lock (Shift) on corner drags: scale both dims by the larger factor so
  // the shape keeps its proportions while still following the cursor.
  if (mods.shift && ex !== 0 && ey !== 0) {
    const fx = newW / startW;
    const fy = newH / startH;
    const f = Math.max(fx, fy);
    newW = Math.max(MIN, startW * f);
    newH = Math.max(MIN, startH * f);
    // Re-anchor the locked size to the fixed corner.
    if (ex < 0) newLeft = right - newW; else newRight = left + newW;
    if (ey < 0) newTop = bottom - newH; else newBottom = top + newH;
  }

  let cx, cy;
  if (mods.alt) {
    // Resize from center: the center stays put and both sides mirror.
    // Grow the affected axis by twice the moved amount about the start center.
    if (ex !== 0) newW = Math.max(MIN, ex > 0 ? startW + 2 * dx * ex : startW - 2 * dx * ex);
    if (ey !== 0) newH = Math.max(MIN, ey > 0 ? startH + 2 * dy * ey : startH - 2 * dy * ey);
    // Alt + Shift: keep aspect about center too.
    if (mods.shift && ex !== 0 && ey !== 0) {
      const f = Math.max(newW / startW, newH / startH);
      newW = Math.max(MIN, startW * f);
      newH = Math.max(MIN, startH * f);
    }
    cx = startX;
    cy = startY;
  } else {
    // Opposite edge pinned: recenter on the midpoint of the new box.
    cx = (newLeft + newRight) / 2;
    cy = (newTop + newBottom) / 2;
    // For single-axis edge drags the untouched axis center is unchanged.
    if (ex === 0) cx = startX;
    if (ey === 0) cy = startY;
  }

  applyParam({
    width: Math.max(1, Math.round(newW / s)),
    height: Math.max(1, Math.round(newH / s)),
    ...worldCenter(startX, startY, cx, cy, rotDeg),
  });
}

// A resize computes the new center in the shape's LOCAL frame (around its start
// center). When the shape is rotated, that local center-offset must be rotated
// back into world space before writing x/y, so the pinned edge/corner stays
// visually fixed.
function worldCenter(startX, startY, localCx, localCy, rotDeg) {
  const [wx, wy] = rotateVec(localCx - startX, localCy - startY, rotDeg);
  return { x: Math.round(startX + wx), y: Math.round(startY + wy) };
}

// Illustrator-style resize for the circle/ellipse. The runtime stores x/y as the
// CENTER and diameter(s) as the size. We work in world space on the bounding box
// (edges at cx±rx, cy±ry), move the dragged edge/corner, keep the opposite side
// pinned by default, and re-center. Behavior mirrors the rectangle, with two
// circle-specific twists:
//   • Corner drags keep the shape uniform when Separate X/Y is off (write
//     `diameter`); with Shift they lock aspect even when separated.
//   • Edge drags size a single axis, so they flip on Separate X/Y automatically.
//   • Alt/Option resizes symmetrically about the center.
function applyCircleResize(type, dx, dy, startParams, applyParam, mods, rotDeg = 0) {
  const startX = startParams.x || 0;
  const startY = startParams.y || 0;
  const sep = !!startParams.separate_xy;
  const startDx = sep ? (startParams.diameter_x || 100) : (startParams.diameter || 100);
  const startDy = sep ? (startParams.diameter_y || 100) : (startParams.diameter || 100);
  const startW = startDx;
  const startH = startDy;

  const left = startX - startW / 2;
  const right = startX + startW / 2;
  const top = startY - startH / 2;
  const bottom = startY + startH / 2;

  const H = { tl: [-1, -1], tr: [1, -1], bl: [-1, 1], br: [1, 1],
    t: [0, -1], b: [0, 1], l: [-1, 0], r: [1, 0] };
  const key = type.replace('resize-', '');
  const [ex, ey] = H[key] || [0, 0];
  const isCorner = ex !== 0 && ey !== 0;

  let newLeft = left, newRight = right, newTop = top, newBottom = bottom;
  if (ex < 0) newLeft = left + dx; else if (ex > 0) newRight = right + dx;
  if (ey < 0) newTop = top + dy; else if (ey > 0) newBottom = bottom + dy;

  const MIN = 1;
  let newW = Math.max(MIN, newRight - newLeft);
  let newH = Math.max(MIN, newBottom - newTop);

  // Uniform scaling: corner drags stay round unless the shape is already
  // separated, or Shift is held to force aspect lock.
  const keepUniform = isCorner && (!sep || mods.shift);
  if (keepUniform) {
    const f = Math.max(newW / startW, newH / startH);
    newW = Math.max(MIN, startW * f);
    newH = Math.max(MIN, startH * f);
    if (ex < 0) newLeft = right - newW; else newRight = left + newW;
    if (ey < 0) newTop = bottom - newH; else newBottom = top + newH;
  }

  let cx, cy;
  if (mods.alt) {
    if (ex !== 0) newW = Math.max(MIN, startW + 2 * dx * ex);
    if (ey !== 0) newH = Math.max(MIN, startH + 2 * dy * ey);
    if (keepUniform) {
      const f = Math.max(newW / startW, newH / startH);
      newW = Math.max(MIN, startW * f);
      newH = Math.max(MIN, startH * f);
    }
    cx = startX; cy = startY;
  } else {
    cx = (newLeft + newRight) / 2;
    cy = (newTop + newBottom) / 2;
    if (ex === 0) cx = startX;
    if (ey === 0) cy = startY;
  }

  const out = { ...worldCenter(startX, startY, cx, cy, rotDeg) };
  if (keepUniform) {
    // Stays a circle: drive the single uniform diameter.
    const d = Math.max(1, Math.round((newW + newH) / 2));
    if (sep) { out.diameter_x = d; out.diameter_y = d; out.diameter = d; }
    else out.diameter = d;
  } else {
    // Per-axis sizing implies separate X/Y — turn it on and carry current sizes.
    out.separate_xy = true;
    out.diameter_x = Math.max(1, Math.round(ex !== 0 ? newW : startW));
    out.diameter_y = Math.max(1, Math.round(ey !== 0 ? newH : startH));
  }
  applyParam(out);
}

// Resize for the regular polygon. A polygon is uniform (a single `size` = the
// diameter of its circumscribed circle) built around center x/y with a rotation,
// so it can't be squashed per-axis — every handle scales `size` uniformly. To
// feel Illustrator-like we pin the opposite corner of the polygon's (rotation-
// aware) bounding box and grow toward the dragged corner. We compute the bounds
// the same way the runtime does so this stays correct at any rotation.
function polygonBounds(p) {
  const n = Math.max(3, Math.min(16, Math.round(p.sides || 6)));
  const r = (p.size || 100) / 2;
  const cx = p.x || 0;
  const cy = p.y || 0;
  const rot = ((p.rotation || 0) - 90) * Math.PI / 180;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const a = rot + (2 * Math.PI * i) / n;
    const px = cx + r * Math.cos(a);
    const py = cy + r * Math.sin(a);
    if (px < minX) minX = px; if (px > maxX) maxX = px;
    if (py < minY) minY = py; if (py > maxY) maxY = py;
  }
  return { minX, minY, maxX, maxY, cx, cy };
}

function applyPolygonResize(type, dx, dy, startParams, applyParam) {
  const startSize = startParams.size || 100;
  const b = polygonBounds(startParams);
  const halfW = (b.maxX - b.minX) / 2 || 1;
  const halfH = (b.maxY - b.minY) / 2 || 1;

  const H = { tl: [-1, -1], tr: [1, -1], bl: [-1, 1], br: [1, 1],
    t: [0, -1], b: [0, 1], l: [-1, 0], r: [1, 0] };
  const key = type.replace('resize-', '');
  const [ex, ey] = H[key] || [1, 1];

  // Grabbed bounding-box point (start) and its pinned opposite point.
  const grabX0 = b.cx + ex * halfW;
  const grabY0 = b.cy + ey * halfH;
  const anchorX = b.cx - ex * halfW;
  const anchorY = b.cy - ey * halfH;
  const grabX = grabX0 + dx;
  const grabY = grabY0 + dy;

  // Scale factor = new span / old span along the axes this handle spans.
  const oldSpanX = ex !== 0 ? Math.abs(grabX0 - anchorX) : 0;
  const oldSpanY = ey !== 0 ? Math.abs(grabY0 - anchorY) : 0;
  const newSpanX = ex !== 0 ? Math.abs(grabX - anchorX) : 0;
  const newSpanY = ey !== 0 ? Math.abs(grabY - anchorY) : 0;
  const oldSpan = Math.hypot(oldSpanX, oldSpanY) || 1;
  const newSpan = Math.hypot(newSpanX, newSpanY);
  const f = Math.max(0.02, newSpan / oldSpan);

  const newSize = Math.max(2, Math.round(startSize * f));
  // Keep the anchor point fixed: new center = anchor + (grab-anchor direction)
  // scaled to the new half-extent. Simplest correct form: center moves toward the
  // dragged side by the growth in half-extent.
  const cx = anchorX + ex * halfW * f;
  const cy = anchorY + ey * halfH * f;

  applyParam({
    size: newSize,
    x: Math.round(cx),
    y: Math.round(cy),
  });
}

function Handle({ x, y, cursor, onMouseDown, size = HANDLE_SIZE }) {
  const sw = 1.5 * (size / HANDLE_SIZE);
  return (
    <rect
      x={x - size / 2}
      y={y - size / 2}
      width={size}
      height={size}
      fill={HANDLE_FILL}
      stroke={HANDLE_COLOR}
      strokeWidth={sw}
      rx={2 * (size / HANDLE_SIZE)}
      cursor={cursor}
      onMouseDown={onMouseDown}
    />
  );
}

function CircleHandle({ cx, cy, cursor, onMouseDown }) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r={HANDLE_SIZE / 2}
      fill={HANDLE_FILL}
      stroke={HANDLE_COLOR}
      strokeWidth={1.5}
      cursor={cursor}
      onMouseDown={onMouseDown}
    />
  );
}

function renderLineHandles(geo, startDrag) {
  return (
    <g>
      <CircleHandle cx={geo.x1} cy={geo.y1} cursor="crosshair" onMouseDown={(e) => startDrag('origin', e)} />
      <CircleHandle cx={geo.x2} cy={geo.y2} cursor="crosshair" onMouseDown={(e) => startDrag('endpoint', e)} />
    </g>
  );
}

// Shared handle gizmo used by rectangle, circle and polygon. `box` is any
// {x, y, width, height} (top-left origin, in the shape's UNROTATED local frame).
// The whole gizmo is wrapped in an SVG rotate(rotDeg, center) so the 8 resize
// handles, the outline and the move body all follow a rotated shape without any
// per-handle trig. Just OUTSIDE each corner sits an invisible "rotate zone":
// hovering it shows a rotate cursor and dragging spins the shape about `center`
// (Illustrator's hover-just-past-a-corner-to-rotate affordance).
function renderBoxHandles(box, startDrag, viewBox, rotDeg = 0, center = null) {
  if (!box) return null;
  const { x, y, width, height } = box;
  const scale = viewBox ? viewBox.w / 800 : 1;
  const size = HANDLE_SIZE * scale;
  const sw = 1 * scale;
  const rotGap = 14 * scale;   // how far outside a corner the rotate zone sits
  const rotR = 11 * scale;     // rotate-zone hit radius

  const cx = x + width / 2;
  const cy = y + height / 2;
  const right = x + width;
  const bottom = y + height;

  // 8 resize handles: 4 corners (nwse/nesw) + 4 edge midpoints (ew/ns).
  const handles = [
    { hx: x, hy: y, type: 'resize-tl', cursor: 'nwse-resize' },
    { hx: cx, hy: y, type: 'resize-t', cursor: 'ns-resize' },
    { hx: right, hy: y, type: 'resize-tr', cursor: 'nesw-resize' },
    { hx: right, hy: cy, type: 'resize-r', cursor: 'ew-resize' },
    { hx: right, hy: bottom, type: 'resize-br', cursor: 'nwse-resize' },
    { hx: cx, hy: bottom, type: 'resize-b', cursor: 'ns-resize' },
    { hx: x, hy: bottom, type: 'resize-bl', cursor: 'nesw-resize' },
    { hx: x, hy: cy, type: 'resize-l', cursor: 'ew-resize' },
  ];

  // Rotate zones sit diagonally outward from each corner.
  const rotZones = [
    { rx: x - rotGap, ry: y - rotGap },
    { rx: right + rotGap, ry: y - rotGap },
    { rx: right + rotGap, ry: bottom + rotGap },
    { rx: x - rotGap, ry: bottom + rotGap },
  ];

  const rotateStr = rotDeg && center ? `rotate(${rotDeg} ${center.x} ${center.y})` : undefined;

  return (
    <g transform={rotateStr}>
      {/* Rotate zones (drawn first so resize handles sit on top). Invisible but
          hit-testable; the cursor hints at rotation. */}
      {rotZones.map((z, i) => (
        <circle
          key={`rot${i}`}
          cx={z.rx}
          cy={z.ry}
          r={rotR}
          fill="transparent"
          stroke="none"
          cursor="grab"
          onMouseDown={(e) => startDrag('rotate', e)}
        />
      ))}
      {/* Bounding box outline for a clear selection frame. */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="none"
        stroke={HANDLE_COLOR}
        strokeWidth={sw}
        pointerEvents="none"
      />
      {/* Body: drag anywhere inside to move the shape. */}
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill="transparent"
        cursor="move"
        onMouseDown={(e) => startDrag('move', e)}
      />
      {handles.map((h) => (
        <Handle
          key={h.type}
          x={h.hx}
          y={h.hy}
          size={size}
          cursor={h.cursor}
          onMouseDown={(e) => startDrag(h.type, e)}
        />
      ))}
    </g>
  );
}

function renderTransformHandles(geo, node, startDrag, viewBox) {
  const px = node.data.params.pivot_x || 0;
  const py = node.data.params.pivot_y || 0;
  const scale = viewBox ? viewBox.w / 800 : 1;
  const arm = 20 * scale;
  const r = (HANDLE_SIZE / 2) * scale;
  const sw = 1.5 * scale;
  const b = geo.bounds;
  const pad = 4 * scale;
  return (
    <g>
      {/* Invisible hit area over geometry bounds for direct translate dragging */}
      {b && (
        <rect
          x={b.x - pad}
          y={b.y - pad}
          width={b.width + pad * 2}
          height={b.height + pad * 2}
          fill="transparent"
          stroke="none"
          cursor="move"
          onMouseDown={(e) => startDrag('translate', e)}
        />
      )}
      <line x1={px - arm} y1={py} x2={px + arm} y2={py} stroke={HANDLE_COLOR} strokeWidth={sw} />
      <line x1={px} y1={py - arm} x2={px} y2={py + arm} stroke={HANDLE_COLOR} strokeWidth={sw} />
      <circle
        cx={px}
        cy={py}
        r={r}
        fill={HANDLE_FILL}
        stroke={HANDLE_COLOR}
        strokeWidth={sw}
        cursor="move"
        onMouseDown={(e) => startDrag('pivot', e)}
      />
    </g>
  );
}

function renderBoundsHandles(geo, startDrag) {
  if (!geo.bounds) return null;
  const { x, y } = geo.bounds;
  return (
    <g>
      <Handle x={x} y={y} cursor="move" onMouseDown={(e) => startDrag('move', e)} />
    </g>
  );
}
