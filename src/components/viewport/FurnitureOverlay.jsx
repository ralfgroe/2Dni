import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useGraphStore } from '../../store/graphStore';
import {
  FURNITURE_TYPES,
  FURNITURE_LABELS,
  FURNITURE_CATEGORIES,
  resolveFurniture,
  furnitureWorldFootprint,
} from '../../utils/furnitureSymbols';

function parseItems(raw) {
  try {
    const v = JSON.parse(raw ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

let idCounter = 0;
function makeId() {
  idCounter += 1;
  return `f${Date.now().toString(36)}_${idCounter}`;
}

export default function FurnitureOverlay({ nodeId, screenToSvg, gridSize = 50, viewBox }) {
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === nodeId));
  const params = node?.data?.params || {};

  const items = useMemo(() => parseItems(params.items_data), [params.items_data]);
  const worldPerMeter = Number(params.world_per_meter) > 0 ? Number(params.world_per_meter) : 100;
  const snapGrid = params.snap_grid === true;

  const [kind, setKind] = useState(FURNITURE_TYPES[0].id);
  const [category, setCategory] = useState(FURNITURE_CATEGORIES[0]);
  const [selected, setSelected] = useState(null);
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [hoverPt, setHoverPt] = useState(null);

  // drag = { mode: 'move' | 'rotate', id, ... }
  const [drag, setDrag] = useState(null);
  const dragRef = useRef(null);
  const justDragged = useRef(false);

  const saveItems = useCallback(
    (next) => updateNodeParams(nodeId, { items_data: JSON.stringify(next) }),
    [nodeId, updateNodeParams]
  );

  const maybeSnap = useCallback(
    (pt) => {
      if (!snapGrid || !gridSize) return pt;
      return {
        x: Math.round(pt.x / gridSize) * gridSize,
        y: Math.round(pt.y / gridSize) * gridSize,
      };
    },
    [snapGrid, gridSize]
  );

  // Resolve every placed item to world-space strokes for display.
  const resolved = useMemo(() => {
    const out = [];
    for (const it of items) {
      const r = resolveFurniture(it, worldPerMeter);
      if (r) out.push({ item: it, ...r });
    }
    return out;
  }, [items, worldPerMeter]);

  const placeItem = useCallback(
    (pt) => {
      const p = maybeSnap(pt);
      const item = { id: makeId(), type: kind, x: Math.round(p.x * 100) / 100, y: Math.round(p.y * 100) / 100, rot: 0, scale: 1 };
      useGraphStore.getState().beginOperation();
      saveItems([...items, item]);
      useGraphStore.getState().endOperation();
      setSelected(item.id);
    },
    [kind, items, maybeSnap, saveItems]
  );

  const deleteSelected = useCallback(() => {
    if (!selectedRef.current) return;
    useGraphStore.getState().beginOperation();
    saveItems(items.filter((it) => it.id !== selectedRef.current));
    useGraphStore.getState().endOperation();
    setSelected(null);
  }, [items, saveItems]);

  // Delete a specific item by id (used by the on-canvas ⊗ handle). Reads the
  // freshest items from the store so it never deletes against a stale snapshot.
  const deleteItem = useCallback((id) => {
    if (!id) return;
    const cur = parseItems(useGraphStore.getState().nodes.find((n) => n.id === nodeId)?.data?.params?.items_data);
    useGraphStore.getState().beginOperation();
    saveItems(cur.filter((it) => it.id !== id));
    useGraphStore.getState().endOperation();
    setSelected((s) => (s === id ? null : s));
  }, [nodeId, saveItems]);

  // --- Background interactions ---
  const handleBgMouseDown = useCallback((e) => e.stopPropagation(), []);

  const handleBgClick = useCallback(
    (e) => {
      e.stopPropagation();
      if (e.button !== 0 || e.altKey) return;
      if (justDragged.current) return;
      // Clicking empty space with a selection clears it; otherwise place.
      if (selectedRef.current) {
        setSelected(null);
        return;
      }
      placeItem(screenToSvg(e.clientX, e.clientY));
    },
    [placeItem, screenToSvg]
  );

  const handleBgMove = useCallback(
    (e) => {
      if (selectedRef.current || drag) { setHoverPt(null); return; }
      setHoverPt(maybeSnap(screenToSvg(e.clientX, e.clientY)));
    },
    [screenToSvg, maybeSnap, drag]
  );

  // --- Item move / rotate drag ---
  const startMove = useCallback(
    (e, item) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      setSelected(item.id);
      const p = screenToSvg(e.clientX, e.clientY);
      useGraphStore.getState().beginOperation();
      const d = { mode: 'move', id: item.id, offX: item.x - p.x, offY: item.y - p.y };
      dragRef.current = d;
      setDrag(d);
    },
    [screenToSvg]
  );

  const startRotate = useCallback(
    (e, item) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      setSelected(item.id);
      useGraphStore.getState().beginOperation();
      const d = { mode: 'rotate', id: item.id, cx: item.x, cy: item.y };
      dragRef.current = d;
      setDrag(d);
    },
    []
  );

  useEffect(() => {
    if (!drag) return;
    const onMove = (e) => {
      const p = screenToSvg(e.clientX, e.clientY);
      const d = dragRef.current;
      if (!d) return;
      const cur = parseItems(useGraphStore.getState().nodes.find((n) => n.id === nodeId)?.data?.params?.items_data);
      if (d.mode === 'move') {
        let nx = p.x + d.offX;
        let ny = p.y + d.offY;
        const snapped = maybeSnap({ x: nx, y: ny });
        nx = Math.round(snapped.x * 100) / 100;
        ny = Math.round(snapped.y * 100) / 100;
        saveItems(cur.map((it) => (it.id === d.id ? { ...it, x: nx, y: ny } : it)));
      } else {
        // rotate: angle from center to cursor; snap to 15deg with Shift.
        let ang = (Math.atan2(p.y - d.cy, p.x - d.cx) * 180) / Math.PI + 90;
        if (e.shiftKey) ang = Math.round(ang / 15) * 15;
        ang = Math.round(ang * 10) / 10;
        saveItems(cur.map((it) => (it.id === d.id ? { ...it, rot: ang } : it)));
      }
    };
    const onUp = () => {
      useGraphStore.getState().endOperation();
      dragRef.current = null;
      setDrag(null);
      justDragged.current = true;
      setTimeout(() => { justDragged.current = false; }, 200);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [drag, nodeId, screenToSvg, maybeSnap, saveItems]);

  // --- Keyboard: delete / rotate-step / esc ---
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedRef.current) { e.preventDefault(); deleteSelected(); }
      } else if (e.key === 'Escape') {
        setSelected(null);
      } else if ((e.key === '[' || e.key === ']') && selectedRef.current) {
        const step = e.key === ']' ? 15 : -15;
        const cur = parseItems(useGraphStore.getState().nodes.find((n) => n.id === nodeId)?.data?.params?.items_data);
        useGraphStore.getState().beginOperation();
        saveItems(cur.map((it) => (it.id === selectedRef.current ? { ...it, rot: Math.round((((it.rot || 0) + step) % 360) * 10) / 10 } : it)));
        useGraphStore.getState().endOperation();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [deleteSelected, nodeId, saveItems]);

  // --- Sizing for handles relative to current zoom ---
  const hr = Math.max(4, (viewBox?.w ?? 800) * 0.007);
  const accent = '#e64980';
  const selColor = '#1366d6';

  // Ghost preview footprint at cursor for the piece about to be placed.
  const ghost = !selected && hoverPt
    ? resolveFurniture({ type: kind, x: hoverPt.x, y: hoverPt.y, rot: 0, scale: 1 }, worldPerMeter)
    : null;

  // === Toolbar (portal next to the # grid button) ===
  const canvasEl = typeof document !== 'undefined' ? document.querySelector('[data-viewport-canvas]') : null;
  const btn = (active) => ({
    fontSize: 11, padding: '3px 9px', height: 22, borderRadius: 5, whiteSpace: 'nowrap',
    border: `1px solid ${active ? accent : '#ced4da'}`,
    background: active ? accent : '#fff', color: active ? '#fff' : '#495057',
    cursor: 'pointer', fontWeight: active ? 600 : 400, lineHeight: 1,
  });
  const catBtn = (active) => ({
    fontSize: 11, padding: '3px 9px', height: 22, borderRadius: 5, whiteSpace: 'nowrap',
    border: `1px solid ${active ? accent : '#ced4da'}`,
    background: active ? '#e7f1ff' : '#fff', color: active ? accent : '#495057',
    cursor: 'pointer', fontWeight: active ? 600 : 400, lineHeight: 1,
  });
  const piecesInCat = FURNITURE_TYPES.filter((t) => t.cat === category);
  const toolbar = (
    <div
      className="absolute top-2 z-10"
      style={{ left: 44, display: 'flex', flexDirection: 'column', gap: 5, fontFamily: 'system-ui, sans-serif', pointerEvents: 'auto' }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', maxWidth: 560 }}>
        {FURNITURE_CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => {
              setCategory(c);
              const first = FURNITURE_TYPES.find((t) => t.cat === c);
              if (first) { setKind(first.id); setSelected(null); }
            }}
            style={catBtn(category === c)}
          >
            {c}
          </button>
        ))}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', maxWidth: 560 }}>
        {piecesInCat.map((t) => (
          <button key={t.id} onClick={() => { setKind(t.id); setSelected(null); }} style={btn(kind === t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: 10, color: '#868e96', background: 'rgba(255,255,255,0.85)', padding: '2px 6px', borderRadius: 4, width: 'fit-content', whiteSpace: 'nowrap' }}>
        {selected
          ? 'Drag to move \u00b7 drag the ring handle to rotate (Shift = 15\u00b0 snaps) \u00b7 [ / ] rotate \u00b7 Delete to remove'
          : `Click to place a ${FURNITURE_LABELS[kind]}. Click a piece to select it.`}
      </div>
    </div>
  );

  return (
    <>
      <g onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
        {/* Event-catching background */}
        <rect
          x="-100000" y="-100000" width="200000" height="200000"
          fill="transparent" pointerEvents="all"
          onMouseDown={handleBgMouseDown}
          onClick={handleBgClick}
          onMouseMove={handleBgMove}
          style={{ cursor: selected ? 'default' : 'copy' }}
        />

        {/* Ghost preview of the piece to be placed */}
        {ghost && (
          <g pointerEvents="none" opacity={0.45}>
            {ghost.strokes.map((s, i) => (
              <path key={i} d={s.d} fill="none" stroke={accent} strokeWidth={1.25} />
            ))}
          </g>
        )}

        {/* Placed furniture: invisible hit shapes + selection chrome */}
        {resolved.map(({ item, bounds }) => {
          const isSel = item.id === selected;
          const fp = furnitureWorldFootprint(item, worldPerMeter);
          const half = Math.max(fp.w, fp.h) / 2;
          // Rotate handle sits "above" the piece along its local -Y (up) axis,
          // rotated by the item's rotation.
          const ar = (item.rot || 0) * Math.PI / 180;
          const ux = Math.sin(ar), uy = -Math.cos(ar);
          const handleDist = fp.h / 2 + hr * 4;
          const hx = item.x + ux * handleDist;
          const hy = item.y + uy * handleDist;
          return (
            <g key={item.id}>
              {/* Hit area = the piece's bounding box (transparent), so the whole
                  footprint is grabbable for moving. */}
              {bounds && (
                <rect
                  x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height}
                  fill="transparent" pointerEvents="all"
                  style={{ cursor: 'grab' }}
                  onMouseDown={(e) => startMove(e, item)}
                  onClick={(e) => { e.stopPropagation(); setSelected(item.id); }}
                />
              )}
              {isSel && bounds && (
                <>
                  <rect
                    x={bounds.x} y={bounds.y} width={bounds.width} height={bounds.height}
                    fill="none" stroke={selColor} strokeWidth={1} strokeDasharray="5 4"
                    pointerEvents="none" opacity={0.8}
                  />
                  {/* Rotate handle */}
                  <line x1={item.x} y1={item.y} x2={hx} y2={hy} stroke={selColor} strokeWidth={1} strokeDasharray="3 3" pointerEvents="none" opacity={0.7} />
                  <circle
                    cx={hx} cy={hy} r={hr}
                    fill="#fff" stroke={selColor} strokeWidth={1.5}
                    style={{ cursor: 'crosshair' }}
                    onMouseDown={(e) => startRotate(e, item)}
                  />
                  {/* Center dot */}
                  <circle cx={item.x} cy={item.y} r={hr * 0.5} fill={selColor} pointerEvents="none" />
                  {/* Delete handle (⊗) at the top-right corner of the footprint */}
                  <g
                    transform={`translate(${bounds.x + bounds.width + hr * 0.4}, ${bounds.y - hr * 0.4})`}
                    style={{ cursor: 'pointer' }}
                    onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); deleteItem(item.id); }}
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); }}
                  >
                    <circle r={hr} fill="#fff" stroke={accent} strokeWidth={1.5} />
                    <line x1={-hr * 0.45} y1={-hr * 0.45} x2={hr * 0.45} y2={hr * 0.45} stroke={accent} strokeWidth={1.5} strokeLinecap="round" />
                    <line x1={-hr * 0.45} y1={hr * 0.45} x2={hr * 0.45} y2={-hr * 0.45} stroke={accent} strokeWidth={1.5} strokeLinecap="round" />
                  </g>
                </>
              )}
            </g>
          );
        })}
      </g>
      {canvasEl ? createPortal(toolbar, canvasEl) : null}
    </>
  );
}
