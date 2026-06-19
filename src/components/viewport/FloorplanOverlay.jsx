import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useGraphStore } from '../../store/graphStore';
import { extractPoints } from '../../utils/geometryPoints';
import {
  getDimensionLabelPoint,
  measureDimension,
  solveDimensions,
} from '../../nodes/dimension';
import { chainsToCenterlinePathData, chainsBounds, pathDataToChains } from '../../utils/floorplanGeo';
import {
  resolveElement,
  DEFAULT_WIDTH_M,
} from '../../utils/floorplanElements';

const SNAP_DISTANCE = 10;

function extractSnapPoints(results, excludeNodeId) {
  const snapPts = [];
  for (const [nodeId, geo] of results) {
    if (nodeId === excludeNodeId || !geo) continue;
    collectPoints(geo, snapPts);
  }
  return snapPts;
}

function collectPoints(geo, out) {
  if (!geo) return;
  switch (geo.type) {
    case 'line':
      out.push({ x: geo.x1, y: geo.y1 });
      out.push({ x: geo.x2, y: geo.y2 });
      break;
    case 'booleanResult':
      if (geo.pathData) {
        const coords = geo.pathData.match(/[-+]?[0-9]*\.?[0-9]+/g);
        if (coords && coords.length >= 2) {
          for (let i = 0; i < coords.length - 1; i += 2) {
            out.push({ x: parseFloat(coords[i]), y: parseFloat(coords[i + 1]) });
          }
        }
      }
      break;
    case 'rect':
    case 'roundedRect':
      out.push({ x: geo.x, y: geo.y });
      out.push({ x: geo.x + geo.width, y: geo.y });
      out.push({ x: geo.x + geo.width, y: geo.y + geo.height });
      out.push({ x: geo.x, y: geo.y + geo.height });
      break;
    case 'group':
      if (geo.children) geo.children.forEach((c) => collectPoints(c, out));
      break;
    default:
      break;
  }
}

function findSnapTarget(cursor, snapPoints, threshold) {
  let best = null;
  let bestDist = threshold;
  for (const pt of snapPoints) {
    const dx = cursor.x - pt.x;
    const dy = cursor.y - pt.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < bestDist) {
      bestDist = d;
      best = pt;
    }
  }
  return best;
}

// Normalize loaded chains: ensure an array of arrays of {x,y}.
function parseChains(raw) {
  try {
    const data = JSON.parse(raw || '[]');
    if (!Array.isArray(data)) return [];
    return data
      .filter((c) => Array.isArray(c))
      .map((c) => c.filter((p) => p && typeof p.x === 'number' && typeof p.y === 'number'));
  } catch {
    return [];
  }
}

function parseJSON(str, fallback) {
  try { const v = JSON.parse(str); return v ?? fallback; } catch { return fallback; }
}

let idCounter = 0;
function newDimId() { return `d${Date.now().toString(36)}${(idCounter++).toString(36)}`; }
function newElemId() { return `e${Date.now().toString(36)}${(idCounter++).toString(36)}`; }

// Project a point onto a segment, returning the foot point, the t parameter
// (0..1, clamped), and the squared distance.
function projectOntoSegment(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (len2 < 1e-9) return { x: a.x, y: a.y, t: 0, dist2: (p.x - a.x) ** 2 + (p.y - a.y) ** 2 };
  let t = ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2;
  t = Math.max(0, Math.min(1, t));
  const fx = a.x + vx * t, fy = a.y + vy * t;
  return { x: fx, y: fy, t, dist2: (p.x - fx) ** 2 + (p.y - fy) ** 2 };
}

// Find the nearest wall segment across all chains to the cursor point.
function nearestWallSegment(p, chains) {
  let best = null;
  for (let wi = 0; wi < chains.length; wi++) {
    const chain = chains[wi];
    if (!chain || chain.length < 2) continue;
    for (let si = 0; si < chain.length - 1; si++) {
      const proj = projectOntoSegment(p, chain[si], chain[si + 1]);
      if (!best || proj.dist2 < best.dist2) {
        best = { wall: wi, seg: si, ...proj };
      }
    }
  }
  return best;
}

const ELEMENT_KINDS = [
  { id: 'door', label: 'Door' },
  { id: 'window', label: 'Window' },
  { id: 'opening', label: 'Opening' },
];

// Decide how a two-point linear dimension is measured/drawn from the picked edge.
function inferAxis(a, b) {
  if (!a || !b) return 'aligned';
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx <= 1e-6 && dy <= 1e-6) return 'aligned';
  if (dy >= dx * 3) return 'vertical';
  if (dx >= dy * 3) return 'horizontal';
  return 'aligned';
}

const DIM_MODES = [
  { id: 'linear', label: 'Linear' },
  { id: 'angle', label: 'Angle' },
  { id: 'relation', label: 'Relation' },
];

const STATUS = {
  under: { color: '#1366d6', label: 'Under-defined' },
  fully: { color: '#1a1a1a', label: 'Fully defined' },
  over: { color: '#e03131', label: 'Over-defined' },
};

export default function FloorplanOverlay({ nodeId, screenToSvg, results, gridSize = 50, viewBox }) {
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === nodeId));
  const params = node?.data?.params || {};

  const chains = useMemo(
    () => parseChains(node?.data?.params?.chains_data),
    [node?.data?.params?.chains_data]
  );

  // Top-level tool: drawing walls vs. dimensioning them.
  const [tool, setTool] = useState('draw');
  const toolRef = useRef(tool);
  toolRef.current = tool;

  // The active chain is the last chain when drawing. We start drawing into a
  // fresh chain whenever the current geometry is empty.
  const [isDrawing, setIsDrawing] = useState(() => {
    const c = parseChains(node?.data?.params?.chains_data);
    return c.length === 0;
  });
  const isDrawingRef = useRef(isDrawing);
  isDrawingRef.current = isDrawing;

  const [preview, setPreview] = useState(null);
  const [snapTarget, setSnapTarget] = useState(null);
  const [closeSnap, setCloseSnap] = useState(false);

  // Dragging is addressed by a flat point id "chainIdx:ptIdx".
  const [dragId, setDragId] = useState(null);
  const dragIdRef = useRef(dragId);
  dragIdRef.current = dragId;
  const dragRef = useRef(null);
  const justFinishedDrag = useRef(false);
  // When true, the next click starts a brand-new (disconnected) wall run rather
  // than extending the last chain. Set after finishing a run with Enter/dbl-click.
  const pendingNewRun = useRef(false);
  // Latest cursor position in SVG space, so finishing a run can leave the
  // floating preview dot under the cursor (a cue that a new wall can begin).
  const lastCursor = useRef(null);

  const snapPoints = useMemo(() => extractSnapPoints(results, nodeId), [results, nodeId]);

  const orthoLock = node?.data?.params?.ortho_lock === true;
  const snapGrid = node?.data?.params?.snap_grid === true;

  const snapToGrid = useCallback(
    (pt) => {
      if (!snapGrid || !gridSize) return pt;
      return {
        x: Math.round(pt.x / gridSize) * gridSize,
        y: Math.round(pt.y / gridSize) * gridSize,
      };
    },
    [snapGrid, gridSize]
  );

  const constrainToAxis = useCallback(
    (prev, current, shiftKey) => {
      if (!(shiftKey || orthoLock) || !prev) return current;
      const dx = Math.abs(current.x - prev.x);
      const dy = Math.abs(current.y - prev.y);
      if (dx >= dy) {
        return { x: current.x, y: prev.y };
      }
      return { x: prev.x, y: current.y };
    },
    [orthoLock]
  );

  const saveChains = useCallback(
    (newChains) => {
      updateNodeParams(nodeId, { chains_data: JSON.stringify(newChains) });
    },
    [nodeId, updateNodeParams]
  );

  // The chain currently being extended. Empty when we're between runs (either
  // nothing drawn yet, or we just finished a run and are waiting to start a new
  // one) so the rubber-band preview never connects to a finished wall.
  const activeChain =
    isDrawing && !pendingNewRun.current && chains.length > 0
      ? chains[chains.length - 1]
      : [];

  // Finish the current wall run but STAY in drawing mode so the next click
  // begins a fresh, disconnected wall. Returns false if there was nothing to
  // finish (so callers can decide to exit instead).
  const finishRun = useCallback(() => {
    let next = chains;
    const last = next.length > 0 ? next[next.length - 1] : null;
    const hadRun = !!last && last.length >= 2;
    // Drop a degenerate active chain (< 2 points) so it doesn't linger.
    if (last && last.length < 2) {
      next = next.slice(0, -1);
      saveChains(next);
    }
    // Keep the floating preview dot under the cursor as a cue that another wall
    // can be started right away (rather than blanking it until the next move).
    setPreview(lastCursor.current ? snapToGrid(lastCursor.current) : null);
    setSnapTarget(null);
    setCloseSnap(false);
    pendingNewRun.current = true;
    return hadRun;
  }, [chains, saveChains, snapToGrid]);

  // ============================================================================
  // DIMENSION MODE
  // ============================================================================
  const worldPerMeter = Number(params.world_per_meter) > 0 ? Number(params.world_per_meter) : 100;

  const dims = useMemo(() => parseJSON(params.dimensions || '[]', []), [params.dimensions]);

  const dimStyle = useMemo(() => ({
    color: params.dim_color ?? '#1366d6',
    textSize: params.text_size ?? 14,
    arrowSize: params.arrow_size ?? 8,
    decimals: params.decimals ?? 2,
    units: params.units ?? 'm',
    valueScale: worldPerMeter,
  }), [params.dim_color, params.text_size, params.arrow_size, params.decimals, params.units, worldPerMeter]);

  // Build the dimensionable centerline geometry locally from the drawn chains —
  // the Floorplan node has no geometry_in, so the overlay synthesizes the same
  // path the runtime feeds the solver (shared helper keeps vertex order aligned).
  const centerlineGeo = useMemo(() => {
    const valid = chains.filter((c) => c.length >= 2);
    if (valid.length === 0) return null;
    const pathData = chainsToCenterlinePathData(valid);
    if (!pathData) return null;
    const { minX, minY, maxX, maxY } = chainsBounds(valid);
    return {
      type: 'booleanResult',
      pathData,
      fill: 'none',
      stroke: '#333333',
      strokeWidth: 1,
      bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
    };
  }, [chains]);

  const solved = useMemo(
    () => (centerlineGeo ? solveDimensions(centerlineGeo, dims) : null),
    [centerlineGeo, dims]
  );
  const skeletonGeo = solved ? solved.skeleton : null;
  const dimConflicts = solved ? solved.conflicts : null;
  const dimStatus = solved ? solved.status : 'under';
  const statusInfo = STATUS[dimStatus] || STATUS.under;

  const dimPoints = useMemo(
    () => (skeletonGeo ? extractPoints(skeletonGeo) : []),
    [skeletonGeo]
  );

  const [dimMode, setDimMode] = useState('linear');
  const [relationKind, setRelationKind] = useState('horizontal');
  const [pending, setPending] = useState([]);
  const [editing, setEditing] = useState(null);
  const dimInputRef = useRef(null);
  const dragLabelRef = useRef(null);

  const persistDims = useCallback((nextDims) => {
    const { beginOperation, endOperation } = useGraphStore.getState();
    beginOperation();
    updateNodeParams(nodeId, { dimensions: JSON.stringify(nextDims) });
    endOperation();
  }, [nodeId, updateNodeParams]);

  // Values are stored in WORLD units; the user works in meters. measureDimension
  // returns world units, so we keep it as-is for new dims (display divides by
  // worldPerMeter); typed edits multiply the meters back into world units.
  const commitDimension = useCallback((partial) => {
    if (partial.kind === 'relation') {
      persistDims([...dims, { id: newDimId(), ...partial }]);
      setPending([]);
      return;
    }
    const measured = measureDimension(skeletonGeo, partial);
    const dim = { id: newDimId(), value: measured != null ? Math.round(measured * 100) / 100 : null, ...partial };
    persistDims([...dims, dim]);
    setPending([]);
  }, [skeletonGeo, dims, persistDims]);

  const handleDimPointClick = useCallback((idx) => {
    const next = [...pending, idx];
    if (dimMode === 'relation') {
      if (next.length === 2) {
        const pa = dimPoints[next[0]], pb = dimPoints[next[1]];
        commitDimension({
          kind: 'relation', relation: relationKind, a: next[0], b: next[1],
          ax: pa?.x, ay: pa?.y, bx: pb?.x, by: pb?.y, labelOffset: 24,
        });
      } else {
        setPending(next);
      }
    } else if (dimMode === 'linear') {
      if (next.length === 2) {
        const pa = dimPoints[next[0]], pb = dimPoints[next[1]];
        const axis = inferAxis(pa, pb);
        commitDimension({
          kind: 'linear', a: next[0], b: next[1], axis, labelOffset: 30,
          ax: pa?.x, ay: pa?.y, bx: pb?.x, by: pb?.y,
        });
      } else {
        setPending(next);
      }
    } else if (dimMode === 'angle') {
      if (next.length === 3) {
        const pv = dimPoints[next[0]], pa = dimPoints[next[1]], pb = dimPoints[next[2]];
        commitDimension({
          kind: 'angle', v: next[0], a: next[1], b: next[2], labelOffset: 40,
          vx: pv?.x, vy: pv?.y, ax: pa?.x, ay: pa?.y, bx: pb?.x, by: pb?.y,
        });
      } else {
        setPending(next);
      }
    }
  }, [dimMode, relationKind, pending, commitDimension, dimPoints]);

  // Edit: input is meters; store back as world units (meters * worldPerMeter).
  const startDimEdit = useCallback((dim) => {
    if (dim.kind === 'arcRadius' || dim.kind === 'relation') return;
    const isAngle = dim.kind === 'angle';
    const shown = dim.value == null ? '' :
      isAngle ? String(dim.value) : String(Math.round((dim.value / worldPerMeter) * 1e6) / 1e6);
    setEditing({ id: dim.id, value: shown });
    setTimeout(() => { dimInputRef.current?.focus(); dimInputRef.current?.select(); }, 0);
  }, [worldPerMeter]);

  const commitDimEdit = useCallback(() => {
    if (!editing) return;
    const typed = parseFloat(editing.value);
    const next = dims.map((d) => {
      if (d.id !== editing.id) return d;
      const isAngle = d.kind === 'angle';
      const valid = isFinite(typed) && (isAngle || typed > 0);
      if (!valid) return d;
      // Angles stay in degrees; lengths convert meters -> world units.
      const stored = isAngle ? typed : typed * worldPerMeter;
      return { ...d, value: stored };
    });
    persistDims(next);
    setEditing(null);
  }, [editing, dims, persistDims, worldPerMeter]);

  const deleteDim = useCallback((id) => {
    persistDims(dims.filter((d) => d.id !== id));
  }, [dims, persistDims]);

  const beginLabelDrag = useCallback((e, dim) => {
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    dragLabelRef.current = { id: dim.id, moved: false, startX, startY };
    const onMove = (ev) => {
      const d = dragLabelRef.current;
      if (!d) return;
      if (!d.moved) {
        if (Math.abs(ev.clientX - d.startX) < 4 && Math.abs(ev.clientY - d.startY) < 4) return;
        d.moved = true;
      }
      const p = screenToSvg(ev.clientX, ev.clientY);
      const nextDims = parseJSON(node?.data?.params?.dimensions || '[]', []).map((dd) =>
        dd.id === d.id ? { ...dd, labelPos: { x: p.x, y: p.y } } : dd
      );
      updateNodeParams(nodeId, { dimensions: JSON.stringify(nextDims) });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const d = dragLabelRef.current;
      dragLabelRef.current = null;
      if (d && d.moved) {
        const { beginOperation, endOperation } = useGraphStore.getState();
        beginOperation();
        endOperation();
      }
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [screenToSvg, nodeId, node, updateNodeParams]);

  const resetLabelPos = useCallback((dim) => {
    persistDims(dims.map((d) => (d.id === dim.id ? { ...d, labelPos: undefined } : d)));
  }, [dims, persistDims]);

  // ============================================================================
  // ELEMENTS MODE (wall-hosted doors / windows / openings)
  // ============================================================================
  const elements = useMemo(() => parseJSON(params.elements_data || '[]', []), [params.elements_data]);

  // Wall chains for hosting elements must match the runtime's solved chains so
  // that (wall, seg, t) indices agree. Rebuild them from the solved skeleton via
  // the same pipeline the runtime uses.
  const elementChains = useMemo(() => {
    if (skeletonGeo && skeletonGeo.pathData) {
      const c = pathDataToChains(skeletonGeo.pathData).filter((ch) => ch.length >= 2);
      if (c.length > 0) return c;
    }
    return chains.filter((c) => c.length >= 2);
  }, [skeletonGeo, chains]);

  const wallHalf = Math.max(0.25, (Number(params.wall_thickness) || 12) / 2);
  const resolvedElements = useMemo(
    () => elements.map((el) => ({ el, r: resolveElement(el, elementChains) })).filter((x) => x.r),
    [elements, elementChains]
  );

  const [elemKind, setElemKind] = useState('door');
  const [elemHover, setElemHover] = useState(null); // { wall, seg, t, x, y }
  const [elemEdit, setElemEdit] = useState(null);    // { id, value } width edit (meters)
  // 'width' (default) or 'offset' — what the inline numeric field edits.
  const [elemEditField, setElemEditField] = useState('width');
  const elemInputRef = useRef(null);
  const elemDragRef = useRef(null);
  // Set briefly after a drag/handle interaction so the trailing background click
  // doesn't drop a brand-new element on top of the one we just moved.
  const elemJustInteracted = useRef(false);

  const persistElements = useCallback((nextEls) => {
    const { beginOperation, endOperation } = useGraphStore.getState();
    beginOperation();
    updateNodeParams(nodeId, { elements_data: JSON.stringify(nextEls) });
    endOperation();
  }, [nodeId, updateNodeParams]);

  // Place a new element at the hovered wall position.
  const placeElement = useCallback((hit) => {
    if (!hit) return;
    const widthWorld = (DEFAULT_WIDTH_M[elemKind] ?? 1) * worldPerMeter;
    const el = {
      id: newElemId(),
      type: elemKind,
      wall: hit.wall,
      seg: hit.seg,
      t: Math.round(hit.t * 1000) / 1000,
      width: Math.round(widthWorld * 100) / 100,
    };
    if (elemKind === 'door') { el.hinge = 'left'; el.swing = 'in'; }
    persistElements([...elements, el]);
  }, [elemKind, worldPerMeter, elements, persistElements]);

  const deleteElement = useCallback((id) => {
    persistElements(elements.filter((e) => e.id !== id));
  }, [elements, persistElements]);

  const startElemWidthEdit = useCallback((el) => {
    const meters = Math.round((el.width / worldPerMeter) * 1e6) / 1e6;
    setElemEditField('width');
    setElemEdit({ id: el.id, value: String(meters) });
    setTimeout(() => { elemInputRef.current?.focus(); elemInputRef.current?.select(); }, 0);
  }, [worldPerMeter]);

  // Edit the door's locating distance: from the nearest wall corner to the
  // nearest door edge (jamb), matching what the on-canvas dimension shows.
  const startElemOffsetEdit = useCallback((el, r) => {
    const a = r.chain[r.seg];
    const b = r.chain[r.seg + 1];
    const dA = Math.hypot(r.center.x - a.x, r.center.y - a.y);
    const dB = b ? Math.hypot(r.center.x - b.x, r.center.y - b.y) : Infinity;
    const corner = dB < dA ? b : a;
    const edge = dB < dA ? r.p2 : r.p1;
    const distWorld = Math.hypot(edge.x - corner.x, edge.y - corner.y);
    const meters = Math.round((distWorld / worldPerMeter) * 1e6) / 1e6;
    setElemEditField('offset');
    setElemEdit({ id: el.id, value: String(meters) });
    setTimeout(() => { elemInputRef.current?.focus(); elemInputRef.current?.select(); }, 0);
  }, [worldPerMeter]);

  const commitElemEdit = useCallback(() => {
    if (!elemEdit) return;
    const typed = parseFloat(elemEdit.value);
    const next = elements.map((e) => {
      if (e.id !== elemEdit.id) return e;
      if (!isFinite(typed) || typed <= 0) return e;
      if (elemEditField === 'offset') {
        // The typed value is the distance from the nearest wall corner to the
        // near door edge (jamb). Convert it back into a center-`t` along the
        // host segment using the segment's solved length and door half-width.
        const r = resolveElement(e, elementChains);
        if (!r) return e;
        const segLen = r.length;
        if (segLen < 1e-6) return e;
        const dEdge = typed * worldPerMeter;          // corner -> near jamb
        const half = r.half;
        // Decide which corner the user is dimensioning from, based on where the
        // opening currently sits (same rule as the on-canvas label).
        const dA = Math.hypot(r.center.x - r.a.x, r.center.y - r.a.y);
        const dB = Math.hypot(r.center.x - r.b.x, r.center.y - r.b.y);
        const fromStart = dA <= dB;
        // Center distance from segment start `a`.
        const centerDist = fromStart ? dEdge + half : segLen - (dEdge + half);
        const t = Math.max(0, Math.min(1, centerDist / segLen));
        return { ...e, t: Math.round(t * 1000) / 1000 };
      }
      return { ...e, width: Math.round(typed * worldPerMeter * 100) / 100 };
    });
    persistElements(next);
    setElemEdit(null);
  }, [elemEdit, elemEditField, elements, persistElements, worldPerMeter, elementChains]);

  // Cycle door hinge/swing on click of the rotate affordance.
  const cycleDoor = useCallback((el) => {
    const order = [
      { hinge: 'left', swing: 'in' },
      { hinge: 'left', swing: 'out' },
      { hinge: 'right', swing: 'in' },
      { hinge: 'right', swing: 'out' },
    ];
    const cur = order.findIndex((o) => o.hinge === (el.hinge ?? 'left') && o.swing === (el.swing ?? 'in'));
    const nextCfg = order[(cur + 1) % order.length];
    persistElements(elements.map((e) => (e.id === el.id ? { ...e, ...nextCfg } : e)));
  }, [elements, persistElements]);

  // Drag an element along its wall (and hop to adjacent segments) to update t/seg.
  const beginElemDrag = useCallback((e, el) => {
    e.stopPropagation();
    e.preventDefault();
    useGraphStore.getState().beginOperation();
    elemDragRef.current = { id: el.id, moved: false, startX: e.clientX, startY: e.clientY };
    const onMove = (ev) => {
      const d = elemDragRef.current;
      if (!d) return;
      if (!d.moved) {
        if (Math.abs(ev.clientX - d.startX) < 3 && Math.abs(ev.clientY - d.startY) < 3) return;
        d.moved = true;
      }
      const p = screenToSvg(ev.clientX, ev.clientY);
      const hit = nearestWallSegment(p, elementChains);
      if (!hit) return;
      const cur = parseJSON(node?.data?.params?.elements_data || '[]', []);
      const next = cur.map((x) => (x.id === d.id ? { ...x, wall: hit.wall, seg: hit.seg, t: Math.round(hit.t * 1000) / 1000 } : x));
      updateNodeParams(nodeId, { elements_data: JSON.stringify(next) });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const d = elemDragRef.current;
      elemDragRef.current = null;
      useGraphStore.getState().endOperation();
      // Block the trailing background click (which would otherwise place a new
      // element where we just dropped this one).
      elemJustInteracted.current = true;
      setTimeout(() => { elemJustInteracted.current = false; }, 220);
      void d;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [screenToSvg, elementChains, nodeId, node, updateNodeParams]);

  // Drag an element's locating dimension in/out (perpendicular to the wall) to
  // tidy the layout, like the wall dimensions. Stores `dimOff` in world units as
  // the perpendicular distance from the wall centerline, on the dimension side.
  const beginElemDimDrag = useCallback((e, el, r) => {
    e.stopPropagation();
    e.preventDefault();
    // Dimension side direction (same logic as renderElemDim): away from a door's
    // swing, +normal otherwise.
    const swingSign = el.type === 'door' ? ((el.swing ?? 'in') === 'in' ? 1 : -1) : 1;
    const side = el.type === 'door' ? -swingSign : 1;
    const nrm = { x: r.normal.x * side, y: r.normal.y * side };
    const anchor = r.center;
    useGraphStore.getState().beginOperation();
    let moved = false;
    const startX = e.clientX, startY = e.clientY;
    const onMove = (ev) => {
      if (!moved) {
        if (Math.abs(ev.clientX - startX) < 3 && Math.abs(ev.clientY - startY) < 3) return;
        moved = true;
      }
      const p = screenToSvg(ev.clientX, ev.clientY);
      // Project cursor offset from the wall onto the dimension normal.
      const proj = (p.x - anchor.x) * nrm.x + (p.y - anchor.y) * nrm.y;
      const dimOff = Math.max(wallHalf + 1, Math.round(proj * 100) / 100);
      const cur = parseJSON(node?.data?.params?.elements_data || '[]', []);
      const next = cur.map((x) => (x.id === el.id ? { ...x, dimOff } : x));
      updateNodeParams(nodeId, { elements_data: JSON.stringify(next) });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      useGraphStore.getState().endOperation();
      elemJustInteracted.current = true;
      setTimeout(() => { elemJustInteracted.current = false; }, 220);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [screenToSvg, wallHalf, nodeId, node, updateNodeParams]);


  // --- Drawing mode handlers ---
  const handleDrawClick = useCallback(
    (e) => {
      if (e.button !== 0 || e.altKey) return;
      e.stopPropagation();

      const svgPt = screenToSvg(e.clientX, e.clientY);

      let working = chains;
      let active = working.length > 0 ? working[working.length - 1] : null;
      // Start a fresh chain if we have no active chain, the last one is empty,
      // or we're flagged to begin a new disconnected run.
      const startingNewRun = pendingNewRun.current || !active || active.length === 0;
      if (startingNewRun) {
        working = [...working, []];
        active = working[working.length - 1];
        pendingNewRun.current = false;
      }

      const lastPt = active.length > 0 ? active[active.length - 1] : null;
      let pt = constrainToAxis(lastPt, svgPt, e.shiftKey);
      pt = snapToGrid(pt);

      // Close the current run as a loop if near its own start (needs >= 3 pts).
      if (active.length >= 3) {
        const start = active[0];
        const dx = pt.x - start.x;
        const dy = pt.y - start.y;
        if (Math.sqrt(dx * dx + dy * dy) < SNAP_DISTANCE) {
          const closedChain = [...active, { x: start.x, y: start.y }];
          const newChains = [...working.slice(0, -1), closedChain];
          saveChains(newChains);
          setPreview(null);
          setSnapTarget(null);
          setCloseSnap(false);
          pendingNewRun.current = true;
          return;
        }
      }

      const snap = findSnapTarget(pt, snapPoints, SNAP_DISTANCE);
      if (snap) pt = snap;

      const rounded = {
        x: Math.round(pt.x * 100) / 100,
        y: Math.round(pt.y * 100) / 100,
      };

      const newActive = [...active, rounded];
      const newChains = [...working.slice(0, -1), newActive];
      saveChains(newChains);
    },
    [chains, screenToSvg, constrainToAxis, snapToGrid, snapPoints, saveChains]
  );

  const handleDrawMove = useCallback(
    (e) => {
      const svgPt = screenToSvg(e.clientX, e.clientY);
      lastCursor.current = svgPt;
      const active =
        !pendingNewRun.current && chains.length > 0 ? chains[chains.length - 1] : [];
      const lastPt = active.length > 0 ? active[active.length - 1] : null;
      let pt = constrainToAxis(lastPt, svgPt, e.shiftKey);
      pt = snapToGrid(pt);

      if (active.length >= 3) {
        const start = active[0];
        const dx = pt.x - start.x;
        const dy = pt.y - start.y;
        if (Math.sqrt(dx * dx + dy * dy) < SNAP_DISTANCE) {
          setCloseSnap(true);
          setSnapTarget(null);
          setPreview({ x: start.x, y: start.y });
          return;
        }
      }
      setCloseSnap(false);

      const snap = findSnapTarget(pt, snapPoints, SNAP_DISTANCE);
      if (snap) {
        pt = snap;
        setSnapTarget(snap);
      } else {
        setSnapTarget(null);
      }
      setPreview(pt);
    },
    [chains, screenToSvg, constrainToAxis, snapToGrid, snapPoints]
  );

  // --- Point dragging handlers ---
  const handlePointDown = useCallback((e, chainIdx, ptIdx) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    useGraphStore.getState().beginOperation();
    const id = `${chainIdx}:${ptIdx}`;
    setDragId(id);
    dragRef.current = { chainIdx, ptIdx };
  }, []);

  useEffect(() => {
    if (dragId === null) return;
    const { chainIdx, ptIdx } = dragRef.current || {};

    const handleDragMove = (e) => {
      const svgPt = screenToSvg(e.clientX, e.clientY);
      let pt = snapToGrid(svgPt);

      const snap = findSnapTarget(pt, snapPoints, SNAP_DISTANCE);
      if (snap) {
        pt = snap;
        setSnapTarget(snap);
      } else {
        setSnapTarget(null);
      }

      const rounded = {
        x: Math.round(pt.x * 100) / 100,
        y: Math.round(pt.y * 100) / 100,
      };

      const newChains = chains.map((c, ci) =>
        ci === chainIdx ? c.map((p, pi) => (pi === ptIdx ? rounded : p)) : c
      );
      saveChains(newChains);
    };

    const handleDragUp = () => {
      setDragId(null);
      setSnapTarget(null);
      dragRef.current = null;
      useGraphStore.getState().endOperation();

      justFinishedDrag.current = true;
      setTimeout(() => {
        justFinishedDrag.current = false;
      }, 200);
    };

    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragUp);
    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragUp);
    };
  }, [dragId, chains, saveChains, screenToSvg, snapToGrid, snapPoints]);

  // --- Keyboard handlers ---
  const handleKeyDown = useCallback(
    (e) => {
      if (toolRef.current === 'dimension') {
        if (e.key === 'Escape' && pending.length > 0) setPending([]);
        return;
      }
      if (toolRef.current === 'elements') {
        if (e.key === 'Escape') { setElemEdit(null); setElemHover(null); }
        return;
      }
      if (e.key === 'Enter') {
        if (isDrawingRef.current) {
          e.preventDefault();
          // Finish this wall but stay in drawing mode for the next one.
          finishRun();
        }
      } else if (e.key === 'Escape') {
        if (dragIdRef.current !== null) {
          setDragId(null);
          dragRef.current = null;
        } else if (isDrawingRef.current) {
          // First Escape finishes the current wall but stays in drawing mode so
          // the floating point keeps hovering, ready for another wall. A second
          // Escape (nothing left being drawn) exits drawing entirely.
          const hadRun = finishRun();
          if (!hadRun) setIsDrawing(false);
        }
      }
    },
    [finishRun, pending]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleBackgroundMouseDown = useCallback((e) => {
    e.stopPropagation();
  }, []);

  const handleBackgroundClick = useCallback(
    (e) => {
      e.stopPropagation();
      if (tool === 'elements') {
        if (e.button !== 0 || e.altKey) return;
        if (elemJustInteracted.current) return;
        const p = screenToSvg(e.clientX, e.clientY);
        // Don't drop a new element right on top of an existing one — that area
        // belongs to the existing element's handle (drag to move it instead).
        const nearExisting = resolvedElements.some(({ r }) => {
          const dx = p.x - r.center.x, dy = p.y - r.center.y;
          return Math.hypot(dx, dy) <= Math.max(r.half, 12);
        });
        if (nearExisting) return;
        const hit = nearestWallSegment(p, elementChains);
        if (hit) placeElement(hit);
        return;
      }
      if (tool !== 'draw') return;
      if (e.button !== 0 || e.altKey) return;

      if (isDrawing) {
        handleDrawClick(e);
      } else if (dragId === null && !justFinishedDrag.current) {
        // Resume drawing: the click both re-enters drawing mode and places the
        // first point of a new, disconnected wall run.
        pendingNewRun.current = true;
        setIsDrawing(true);
        handleDrawClick(e);
      }
    },
    [tool, isDrawing, dragId, handleDrawClick, screenToSvg, elementChains, placeElement, resolvedElements]
  );

  const handleBackgroundDblClick = useCallback(
    (e) => {
      e.stopPropagation();
      if (tool === 'draw' && isDrawing) {
        finishRun();
      }
    },
    [tool, isDrawing, finishRun]
  );

  const handleBackgroundMouseMove = useCallback(
    (e) => {
      if (tool === 'draw' && isDrawing) {
        handleDrawMove(e);
      } else if (tool === 'elements') {
        const p = screenToSvg(e.clientX, e.clientY);
        const hit = nearestWallSegment(p, elementChains);
        setElemHover(hit ? { wall: hit.wall, seg: hit.seg, t: hit.t, x: hit.x, y: hit.y } : null);
      }
    },
    [tool, isDrawing, handleDrawMove, screenToSvg, elementChains]
  );

  const activeLast = activeChain.length > 0 ? activeChain[activeChain.length - 1] : null;
  const bgCursor = tool === 'dimension' ? 'default' : tool === 'elements' ? 'copy' : dragId !== null ? 'grabbing' : isDrawing ? 'crosshair' : 'default';
  const drawMode = tool === 'draw';

  // --- Dimension-mode handle sizing & label handles ---
  const dimSw = Math.max(0.5, (viewBox?.w ?? 800) * 0.0022);
  const dimPtR = Math.max(3, (viewBox?.w ?? 800) * 0.006);
  const accent = '#e64980';
  const labelHandles = dims.map((d) => {
    const lp = getDimensionLabelPoint(skeletonGeo, d, dimStyle);
    return lp ? { dim: d, ...lp } : null;
  }).filter(Boolean);

  const dimModeHint = dimMode === 'linear'
    ? 'Click two points to dimension'
    : dimMode === 'relation'
      ? `Click two points on a wall to lock it ${relationKind}`
      : 'Click vertex, then two arm points';

  // --- Elements-mode: ghost preview on solved chains ---
  const elemGhost = useMemo(() => {
    if (tool !== 'elements' || !elemHover) return null;
    const widthWorld = (DEFAULT_WIDTH_M[elemKind] ?? 1) * worldPerMeter;
    return resolveElement(
      { type: elemKind, wall: elemHover.wall, seg: elemHover.seg, t: elemHover.t, width: widthWorld },
      elementChains
    );
  }, [tool, elemHover, elemKind, worldPerMeter, elementChains]);

  // Screen-fixed compact toolbar mounted next to the # grid button.
  const canvasEl = typeof document !== 'undefined'
    ? document.querySelector('[data-viewport-canvas]')
    : null;
  const accentColor = dimStyle.color;
  const btn = (active) => ({
    fontSize: 11, padding: '3px 9px', height: 22, borderRadius: 5, whiteSpace: 'nowrap',
    border: `1px solid ${active ? accentColor : '#ced4da'}`,
    background: active ? accentColor : '#fff',
    color: active ? '#fff' : '#495057',
    cursor: 'pointer', fontWeight: active ? 600 : 400, lineHeight: 1,
  });
  const subBtn = (active) => ({
    fontSize: 11, padding: '3px 8px', height: 22, borderRadius: 5, whiteSpace: 'nowrap',
    border: `1px solid ${active ? accentColor : '#dee2e6'}`,
    background: active ? 'rgba(19,102,214,0.12)' : '#fff',
    color: active ? accentColor : '#868e96',
    cursor: 'pointer', fontWeight: active ? 600 : 400, lineHeight: 1,
  });

  const toolbar = (
    <div
      className="absolute top-2 z-10"
      style={{ left: 44, display: 'flex', flexDirection: 'column', gap: 5, fontFamily: 'system-ui, sans-serif', pointerEvents: 'auto' }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap' }}>
        <button onClick={() => setTool('draw')} style={btn(tool === 'draw')}>Draw</button>
        <button onClick={() => { setTool('dimension'); setPending([]); }} style={btn(tool === 'dimension')}>Dimension</button>
        <button onClick={() => { setTool('elements'); setElemHover(null); }} style={btn(tool === 'elements')}>Elements</button>
        {tool === 'dimension' && (
          <>
            <span style={{ width: 1, height: 18, background: '#dee2e6', margin: '0 2px' }} />
            {DIM_MODES.map((m) => (
              <button key={m.id} onClick={() => { setDimMode(m.id); setPending([]); }} style={subBtn(dimMode === m.id)}>
                {m.label}
              </button>
            ))}
            {dimMode === 'relation' && [
              { id: 'horizontal', label: 'H' },
              { id: 'vertical', label: 'V' },
            ].map((rk) => (
              <button key={rk.id} onClick={() => { setRelationKind(rk.id); setPending([]); }} style={subBtn(relationKind === rk.id)}>
                {rk.label}
              </button>
            ))}
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 6 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: statusInfo.color, border: '1px solid rgba(0,0,0,0.15)' }} />
              <span style={{ fontSize: 11, fontWeight: 600, color: statusInfo.color }}>{statusInfo.label}</span>
            </span>
          </>
        )}
        {tool === 'elements' && (
          <>
            <span style={{ width: 1, height: 18, background: '#dee2e6', margin: '0 2px' }} />
            {ELEMENT_KINDS.map((k) => (
              <button key={k.id} onClick={() => setElemKind(k.id)} style={subBtn(elemKind === k.id)}>
                {k.label}
              </button>
            ))}
          </>
        )}
      </div>
      <div style={{ fontSize: 10, color: '#868e96', background: 'rgba(255,255,255,0.85)', padding: '2px 6px', borderRadius: 4, width: 'fit-content', whiteSpace: 'nowrap' }}>
        {tool === 'draw'
          ? 'Click to lay out walls. Enter / double-click = finish wall & start a new one. Esc = exit.'
          : tool === 'elements'
            ? `Click a wall to place a ${elemKind}. Drag the marker to slide it; double-click the marker for width, or the distance label to set its position \u2014 both in ${dimStyle.units || 'm'}.`
            : `${dimModeHint}${pending.length > 0 ? ` \u2014 ${pending.length} picked` : ''}. Values in ${dimStyle.units || 'm'}; drag to move, double-click to edit.`}
      </div>
    </div>
  );

  // === Dimension-mode picking + label handles (SVG) ===
  const dimHandles = tool === 'dimension' && skeletonGeo ? (
    <g onClick={(e) => e.stopPropagation()} style={{ userSelect: 'none', WebkitUserSelect: 'none' }}>
      {dimPoints.map((pt) => {
        const isPending = pending.includes(pt.idx);
        return (
          <g key={`dpt${pt.idx}`}>
            <circle
              cx={pt.x} cy={pt.y} r={dimPtR * 1.6}
              fill="transparent" stroke="none"
              style={{ cursor: 'pointer' }}
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); handleDimPointClick(pt.idx); }}
            />
            <circle
              cx={pt.x} cy={pt.y} r={dimPtR}
              fill={isPending ? accent : '#ffffff'}
              stroke={isPending ? accent : statusInfo.color}
              strokeWidth={dimSw * 1.5}
              style={{ pointerEvents: 'none' }}
            />
          </g>
        );
      })}

      {labelHandles.map(({ dim, x, y }) => {
        const isConflict = dimConflicts && dimConflicts.has(dim.id);
        return (
          <g key={`dlbl${dim.id}`}>
            {isConflict && (
              <g pointerEvents="none">
                <circle cx={x} cy={y} r={dimStyle.textSize * 1.5} fill="rgba(224,49,49,0.12)" stroke="#e03131" strokeWidth={dimSw} />
                <g transform={`translate(${x + dimStyle.textSize * 2.6}, ${y})`}>
                  <line x1={-dimStyle.textSize * 0.4} y1={-dimStyle.textSize * 0.4} x2={dimStyle.textSize * 0.4} y2={dimStyle.textSize * 0.4} stroke="#e03131" strokeWidth={dimSw * 1.6} strokeLinecap="round" />
                  <line x1={-dimStyle.textSize * 0.4} y1={dimStyle.textSize * 0.4} x2={dimStyle.textSize * 0.4} y2={-dimStyle.textSize * 0.4} stroke="#e03131" strokeWidth={dimSw * 1.6} strokeLinecap="round" />
                </g>
              </g>
            )}
            <rect
              x={x - dimStyle.textSize * 1.8}
              y={y - dimStyle.textSize * 0.9}
              width={dimStyle.textSize * 3.6}
              height={dimStyle.textSize * 1.8}
              fill="transparent"
              style={{ cursor: 'move', userSelect: 'none', WebkitUserSelect: 'none' }}
              onMouseDown={(e) => { beginLabelDrag(e, dim); }}
              onDoubleClick={(e) => { e.stopPropagation(); startDimEdit(dim); }}
            />
            <g
              transform={`translate(${x + dimStyle.textSize * 2}, ${y - dimStyle.textSize * 0.9})`}
              style={{ cursor: 'pointer' }}
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); deleteDim(dim.id); }}
            >
              <circle r={dimPtR * 0.9} fill="#ffffff" stroke={accent} strokeWidth={dimSw} />
              <line x1={-dimPtR * 0.4} y1={-dimPtR * 0.4} x2={dimPtR * 0.4} y2={dimPtR * 0.4} stroke={accent} strokeWidth={dimSw} />
              <line x1={-dimPtR * 0.4} y1={dimPtR * 0.4} x2={dimPtR * 0.4} y2={-dimPtR * 0.4} stroke={accent} strokeWidth={dimSw} />
            </g>
            {dim.labelPos && (
              <g
                transform={`translate(${x - dimStyle.textSize * 2.4}, ${y - dimStyle.textSize * 0.9})`}
                style={{ cursor: 'pointer' }}
                onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); resetLabelPos(dim); }}
              >
                <circle r={dimPtR * 0.9} fill="#ffffff" stroke={dimStyle.color} strokeWidth={dimSw} />
                <path
                  d={`M ${-dimPtR * 0.45} 0 A ${dimPtR * 0.45} ${dimPtR * 0.45} 0 1 1 ${dimPtR * 0.2} ${dimPtR * 0.4}`}
                  fill="none" stroke={dimStyle.color} strokeWidth={dimSw}
                />
              </g>
            )}

            {editing && editing.id === dim.id && (
              <foreignObject
                x={x - dimStyle.textSize * 2.2}
                y={y - dimStyle.textSize}
                width={dimStyle.textSize * 5}
                height={dimStyle.textSize * 2}
              >
                <input
                  ref={dimInputRef}
                  type="number"
                  value={editing.value}
                  onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitDimEdit();
                    else if (e.key === 'Escape') setEditing(null);
                  }}
                  onBlur={commitDimEdit}
                  onMouseDown={(e) => e.stopPropagation()}
                  style={{
                    width: '100%',
                    fontSize: `${Math.max(11, dimStyle.textSize)}px`,
                    textAlign: 'center',
                    border: `1.5px solid ${dimStyle.color}`,
                    borderRadius: 4,
                    padding: '1px 2px',
                    boxSizing: 'border-box',
                    outline: 'none',
                    background: '#fff',
                    color: '#111',
                  }}
                />
              </foreignObject>
            )}
          </g>
        );
      })}
    </g>
  ) : null;

  // === Elements-mode ghost + placed-element handles (SVG) ===
  const elemHandleR = Math.max(3, (viewBox?.w ?? 800) * 0.007);
  const elemSw = Math.max(0.5, (viewBox?.w ?? 800) * 0.0022);
  const elemAccent = '#7048e8';

  const renderOpeningBracket = (r, color, opacity) => {
    if (!r) return null;
    const { p1, p2, normal } = r;
    const n = { x: normal.x * wallHalf, y: normal.y * wallHalf };
    return (
      <g pointerEvents="none" opacity={opacity}>
        <line x1={p1.x + n.x} y1={p1.y + n.y} x2={p1.x - n.x} y2={p1.y - n.y} stroke={color} strokeWidth={elemSw * 1.4} />
        <line x1={p2.x + n.x} y1={p2.y + n.y} x2={p2.x - n.x} y2={p2.y - n.y} stroke={color} strokeWidth={elemSw * 1.4} />
        <line x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y} stroke={color} strokeWidth={elemSw * 1.4} strokeDasharray={`${elemSw * 3} ${elemSw * 2}`} />
      </g>
    );
  };

  // Locating dimension for one placed element: distance from the nearest wall
  // corner to the nearest door edge (jamb), so you read how much wall is left.
  // Drawn as a proper offset dimension parallel to the wall, pushed to the side
  // AWAY from the door swing so it never crosses the arc. When `interactive` is
  // true it can be double-clicked to edit; otherwise it's a static read-only
  // annotation (shown even when not in Elements mode).
  const renderElemDim = (el, r, interactive) => {
    if (!r) return null;
    const a = r.chain[r.seg];
    const b = r.chain[r.seg + 1];
    const dA = Math.hypot(r.center.x - a.x, r.center.y - a.y);
    const dB = b ? Math.hypot(r.center.x - b.x, r.center.y - b.y) : Infinity;
    const corner = dB < dA ? b : a;
    const edge = dB < dA ? r.p2 : r.p1; // jamb facing the chosen corner
    const distWorld = Math.hypot(edge.x - corner.x, edge.y - corner.y);
    const meters = (distWorld / worldPerMeter).toFixed(dimStyle.decimals ?? 2);
    const label = `${meters} ${dimStyle.units || 'm'}`;

    const swingSign = el.type === 'door' ? ((el.swing ?? 'in') === 'in' ? 1 : -1) : 1;
    const side = el.type === 'door' ? -swingSign : 1;
    const nrm = { x: r.normal.x * side, y: r.normal.y * side };
    const off = (typeof el.dimOff === 'number' && isFinite(el.dimOff))
      ? Math.max(wallHalf + 1, el.dimOff)
      : wallHalf + elemHandleR * 4.5;

    const c1 = { x: corner.x + nrm.x * off, y: corner.y + nrm.y * off };
    const c2 = { x: edge.x + nrm.x * off, y: edge.y + nrm.y * off };
    const mx = (c1.x + c2.x) / 2, my = (c1.y + c2.y) / 2;

    const wit = elemHandleR * 0.8;
    const wStart = wallHalf + elemHandleR * 0.6;
    const wA = { x: corner.x + nrm.x * wStart, y: corner.y + nrm.y * wStart };
    const wB = { x: corner.x + nrm.x * (off + wit), y: corner.y + nrm.y * (off + wit) };
    const eA = { x: edge.x + nrm.x * wStart, y: edge.y + nrm.y * wStart };
    const eB = { x: edge.x + nrm.x * (off + wit), y: edge.y + nrm.y * (off + wit) };

    const dirL = distWorld > 1e-6
      ? { x: (c2.x - c1.x) / distWorld, y: (c2.y - c1.y) / distWorld }
      : { x: 1, y: 0 };
    const tick = elemHandleR * 0.9;
    const tdx = (dirL.x + nrm.x) * tick, tdy = (dirL.y + nrm.y) * tick;

    const fs = Math.max(9, elemHandleR * 1.7);
    const padX = fs * 0.45, padY = fs * 0.3;
    const labelW = label.length * fs * 0.58 + padX * 2;
    const labelH = fs + padY * 2;

    const isEditingOffset = interactive && elemEdit && elemEdit.id === el.id && elemEditField === 'offset';
    return (
      <g style={{ userSelect: 'none' }} pointerEvents={interactive ? undefined : 'none'}>
        <line x1={wA.x} y1={wA.y} x2={wB.x} y2={wB.y} stroke={dimStyle.color} strokeWidth={elemSw * 0.8} opacity={0.55} />
        <line x1={eA.x} y1={eA.y} x2={eB.x} y2={eB.y} stroke={dimStyle.color} strokeWidth={elemSw * 0.8} opacity={0.55} />
        <line x1={c1.x} y1={c1.y} x2={c2.x} y2={c2.y} stroke={dimStyle.color} strokeWidth={elemSw * 1.1} />
        <line x1={c1.x - tdx} y1={c1.y - tdy} x2={c1.x + tdx} y2={c1.y + tdy} stroke={dimStyle.color} strokeWidth={elemSw * 1.1} />
        <line x1={c2.x - tdx} y1={c2.y - tdy} x2={c2.x + tdx} y2={c2.y + tdy} stroke={dimStyle.color} strokeWidth={elemSw * 1.1} />
        {!isEditingOffset && (
          <g
            style={interactive ? { cursor: 'ns-resize' } : undefined}
            onMouseDown={interactive ? (e) => beginElemDimDrag(e, el, r) : undefined}
            onClick={interactive ? (e) => { e.stopPropagation(); } : undefined}
            onDoubleClick={interactive ? (e) => { e.stopPropagation(); startElemOffsetEdit(el, r); } : undefined}
          >
            <rect x={mx - labelW / 2} y={my - labelH / 2} width={labelW} height={labelH} rx={labelH * 0.3} fill="#ffffff" stroke={dimStyle.color} strokeWidth={elemSw * 0.7} />
            <text x={mx} y={my} textAnchor="middle" dominantBaseline="central" fontSize={fs} fill={dimStyle.color} fontFamily="system-ui, sans-serif" fontWeight={500}>
              {label}
            </text>
          </g>
        )}
        {isEditingOffset && (
          <foreignObject x={mx - labelW * 0.85} y={my - labelH * 0.85} width={labelW * 1.7} height={labelH * 1.7}>
            <input
              ref={elemInputRef}
              type="number"
              value={elemEdit.value}
              onChange={(e) => setElemEdit({ ...elemEdit, value: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitElemEdit();
                else if (e.key === 'Escape') setElemEdit(null);
              }}
              onBlur={commitElemEdit}
              onMouseDown={(e) => e.stopPropagation()}
              style={{
                width: '100%', height: '100%', fontSize: `${fs}px`, textAlign: 'center',
                border: `1.5px solid ${dimStyle.color}`, borderRadius: 5,
                padding: '0 4px', boxSizing: 'border-box', outline: 'none',
                background: '#fff', color: '#111',
              }}
            />
          </foreignObject>
        )}
      </g>
    );
  };

  const elementLayer = tool === 'elements' ? (
    <g onClick={(e) => e.stopPropagation()} style={{ userSelect: 'none', WebkitUserSelect: 'none' }}>
      {/* ghost preview under the cursor */}
      {elemGhost && renderOpeningBracket(elemGhost, elemAccent, 0.55)}
      {elemGhost && (
        <circle cx={elemGhost.center.x} cy={elemGhost.center.y} r={elemHandleR * 0.7} fill={elemAccent} opacity={0.5} pointerEvents="none" />
      )}

      {/* placed elements: marker + controls */}
      {resolvedElements.map(({ el, r }) => (
        <g key={`el${el.id}`}>
          {renderOpeningBracket(r, r.clamped ? '#e03131' : elemAccent, 0.9)}
          {/* slide handle (drag along wall) — larger transparent hit area */}
          <circle
            cx={r.center.x} cy={r.center.y} r={elemHandleR * 2.2}
            fill="transparent"
            style={{ cursor: 'grab' }}
            onMouseDown={(e) => beginElemDrag(e, el)}
            onDoubleClick={(e) => { e.stopPropagation(); startElemWidthEdit(el); }}
          />
          <circle
            cx={r.center.x} cy={r.center.y} r={elemHandleR}
            fill="#ffffff" stroke={r.clamped ? '#e03131' : elemAccent} strokeWidth={elemSw * 1.6}
            pointerEvents="none"
          />
          {/* delete affordance */}
          <g
            transform={`translate(${r.center.x + r.normal.x * (wallHalf + elemHandleR * 2.2)}, ${r.center.y + r.normal.y * (wallHalf + elemHandleR * 2.2)})`}
            style={{ cursor: 'pointer' }}
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); deleteElement(el.id); }}
          >
            <circle r={elemHandleR * 0.85} fill="#ffffff" stroke={elemAccent} strokeWidth={elemSw} />
            <line x1={-elemHandleR * 0.35} y1={-elemHandleR * 0.35} x2={elemHandleR * 0.35} y2={elemHandleR * 0.35} stroke={elemAccent} strokeWidth={elemSw} />
            <line x1={-elemHandleR * 0.35} y1={elemHandleR * 0.35} x2={elemHandleR * 0.35} y2={-elemHandleR * 0.35} stroke={elemAccent} strokeWidth={elemSw} />
          </g>
          {/* door: rotate/flip affordance */}
          {el.type === 'door' && (
            <g
              transform={`translate(${r.center.x - r.normal.x * (wallHalf + elemHandleR * 2.2)}, ${r.center.y - r.normal.y * (wallHalf + elemHandleR * 2.2)})`}
              style={{ cursor: 'pointer' }}
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); cycleDoor(el); }}
            >
              <circle r={elemHandleR * 0.85} fill="#ffffff" stroke={elemAccent} strokeWidth={elemSw} />
              <path
                d={`M ${-elemHandleR * 0.4} ${elemHandleR * 0.1} A ${elemHandleR * 0.45} ${elemHandleR * 0.45} 0 1 1 ${elemHandleR * 0.1} ${elemHandleR * 0.45}`}
                fill="none" stroke={elemAccent} strokeWidth={elemSw}
              />
            </g>
          )}
          {/* inline width editor */}
          {elemEdit && elemEdit.id === el.id && elemEditField === 'width' && (
            <foreignObject
              x={r.center.x - elemHandleR * 4}
              y={r.center.y - r.normal.y * (wallHalf + elemHandleR * 4) - elemHandleR}
              width={elemHandleR * 8}
              height={elemHandleR * 3}
            >
              <input
                ref={elemInputRef}
                type="number"
                value={elemEdit.value}
                onChange={(e) => setElemEdit({ ...elemEdit, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitElemEdit();
                  else if (e.key === 'Escape') setElemEdit(null);
                }}
                onBlur={commitElemEdit}
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  width: '100%', fontSize: '12px', textAlign: 'center',
                  border: `1.5px solid ${elemAccent}`, borderRadius: 4,
                  padding: '1px 2px', boxSizing: 'border-box', outline: 'none',
                  background: '#fff', color: '#111',
                }}
              />
            </foreignObject>
          )}
        </g>
      ))}
    </g>
  ) : null;

  // Persistent read-only element dimensions: shown OUTSIDE Elements mode (so
  // they survive switching tools) whenever dimensions are enabled. Inside
  // Elements mode the interactive version above already draws them.
  // Element locating dimensions. Shown in ALL tool modes (so they persist after
  // placing and switching tools) and are interactive everywhere: drag the label
  // in/out to tidy the layout, double-click to edit the distance.
  const elementDimsLayer = (params.show_dimensions ?? true) ? (
    <g style={{ userSelect: 'none' }}>
      {resolvedElements.map(({ el, r }) => (
        <g key={`eldim${el.id}`}>{renderElemDim(el, r, true)}</g>
      ))}
    </g>
  ) : null;

  return (
    <>
    <g onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {/* === PERMANENT BACKGROUND — always blocks events from reaching the Viewport === */}
      <rect
        x="-100000"
        y="-100000"
        width="200000"
        height="200000"
        fill="transparent"
        pointerEvents="all"
        onMouseDown={handleBackgroundMouseDown}
        onClick={handleBackgroundClick}
        onDoubleClick={handleBackgroundDblClick}
        onMouseMove={handleBackgroundMouseMove}
        style={{ cursor: bgCursor }}
      />

      {/* === Preview segment from last active point to cursor === */}
      {drawMode && isDrawing && activeLast && preview && (
        <line
          x1={activeLast.x}
          y1={activeLast.y}
          x2={preview.x}
          y2={preview.y}
          stroke="#339af0"
          strokeWidth={1.5}
          strokeDasharray="6,3"
          pointerEvents="none"
          opacity={0.7}
        />
      )}

      {drawMode && isDrawing && preview && (
        <circle
          cx={preview.x}
          cy={preview.y}
          r={4}
          fill={closeSnap ? '#51cf66' : snapTarget ? '#ff6b6b' : '#339af0'}
          opacity={0.7}
          pointerEvents="none"
        />
      )}

      {drawMode && isDrawing && closeSnap && activeChain.length > 0 && (
        <circle
          cx={activeChain[0].x}
          cy={activeChain[0].y}
          r={9}
          fill="none"
          stroke="#51cf66"
          strokeWidth={2.5}
          pointerEvents="none"
          opacity={0.9}
        />
      )}

      {drawMode && isDrawing && snapTarget && (
        <circle
          cx={snapTarget.x}
          cy={snapTarget.y}
          r={8}
          fill="none"
          stroke="#ff6b6b"
          strokeWidth={2}
          pointerEvents="none"
          opacity={0.8}
        />
      )}

      {drawMode && isDrawing &&
        snapPoints.map((pt, i) => (
          <circle
            key={`snap_${i}`}
            cx={pt.x}
            cy={pt.y}
            r={2.5}
            fill="#ff6b6b"
            opacity={0.3}
            pointerEvents="none"
          />
        ))}

      {/* === SNAP INDICATOR DURING DRAG === */}
      {drawMode && !isDrawing && dragId !== null && snapTarget && (
        <circle
          cx={snapTarget.x}
          cy={snapTarget.y}
          r={8}
          fill="none"
          stroke="#ff6b6b"
          strokeWidth={2}
          pointerEvents="none"
          opacity={0.8}
        />
      )}

      {/* === POINT HANDLES per chain — only in Draw mode === */}
      {drawMode && chains.map((chain, ci) =>
        chain.map((pt, pi) => {
          const id = `${ci}:${pi}`;
          const isDragging = dragId === id;
          return (
            <circle
              key={id}
              cx={pt.x}
              cy={pt.y}
              r={isDragging ? 6 : 5}
              fill={isDragging ? '#ff6b6b' : pi === 0 ? '#22b8cf' : '#339af0'}
              stroke="#1a1a2e"
              strokeWidth={1.5}
              style={{ cursor: isDrawing ? 'default' : 'grab' }}
              pointerEvents={isDrawing ? 'none' : 'all'}
              onMouseDown={!isDrawing ? (e) => handlePointDown(e, ci, pi) : undefined}
            />
          );
        })
      )}

      {/* === On-canvas hint while drawing === */}
      {drawMode && isDrawing && (
        <g pointerEvents="none">
          <text
            x={preview ? preview.x + 14 : 0}
            y={preview ? preview.y - 12 : 0}
            fontSize={11}
            fill="#868e96"
            style={{ userSelect: 'none' }}
          >
            {activeChain.length > 0 ? 'Enter / dbl-click = new wall' : 'Click to start a wall'}
          </text>
        </g>
      )}

      {dimHandles}
      {elementDimsLayer}
      {elementLayer}
    </g>
    {canvasEl ? createPortal(toolbar, canvasEl) : null}
    </>
  );
}
