import { useCallback, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { extractPoints } from '../../utils/geometryPoints';
import { driveGeometry, getDimensionLabelPoint, measureDimension, isCircular } from '../../nodes/dimension';

function parseJSON(str, fallback) {
  try { const v = JSON.parse(str); return v ?? fallback; } catch { return fallback; }
}

let idCounter = 0;
function newId() { return `d${Date.now().toString(36)}${(idCounter++).toString(36)}`; }

// Decide how a two-point linear dimension should be measured/drawn based on the
// edge the user picked. A near-vertical edge measures its vertical extent (and
// the dimension line sits to the side); a near-horizontal edge measures its
// horizontal extent; anything clearly diagonal stays 'aligned'.
function inferAxis(a, b) {
  if (!a || !b) return 'aligned';
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx <= 1e-6 && dy <= 1e-6) return 'aligned';
  // Treat as axis-aligned when one delta clearly dominates the other.
  if (dy >= dx * 3) return 'vertical';
  if (dx >= dy * 3) return 'horizontal';
  return 'aligned';
}

const MODES = [
  { id: 'linear', label: 'Linear' },
  { id: 'radius', label: 'Radius' },
  { id: 'diameter', label: 'Diameter' },
  { id: 'angle', label: 'Angle' },
];

export default function DimensionOverlay({ nodeId, screenToSvg, edges, results, viewBox }) {
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);
  const nodes = useGraphStore((s) => s.nodes);
  const node = nodes.find((n) => n.id === nodeId);
  const params = node?.data?.params || {};

  const [mode, setMode] = useState('linear');
  const [pending, setPending] = useState([]); // indices being collected for the current dimension
  const [editing, setEditing] = useState(null); // { id, value }
  const inputRef = useRef(null);

  const sourceEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'geometry_in');
  const sourceGeoRaw = sourceEdge ? results.get(sourceEdge.source) : null;
  const sourceGeo = sourceGeoRaw && sourceGeoRaw.__multiOutput && sourceEdge?.sourceHandle
    ? sourceGeoRaw[sourceEdge.sourceHandle]
    : sourceGeoRaw;

  const dims = useMemo(() => parseJSON(params.dimensions || '[]', []), [params.dimensions]);

  const style = useMemo(() => ({
    color: params.dim_color ?? '#1366d6',
    textSize: params.text_size ?? 14,
    arrowSize: params.arrow_size ?? 8,
    decimals: params.decimals ?? 1,
    units: params.units ?? '',
  }), [params.dim_color, params.text_size, params.arrow_size, params.decimals, params.units]);

  // The shape as currently driven by existing dimensions.
  const drivenGeo = useMemo(
    () => (sourceGeo ? driveGeometry(sourceGeo, dims) : null),
    [sourceGeo, dims]
  );

  const points = useMemo(() => (drivenGeo ? extractPoints(drivenGeo) : []), [drivenGeo]);

  const persist = useCallback((nextDims) => {
    const { beginOperation, endOperation } = useGraphStore.getState();
    beginOperation();
    updateNodeParams(nodeId, { dimensions: JSON.stringify(nextDims) });
    endOperation();
  }, [nodeId, updateNodeParams]);

  const commitDimension = useCallback((partial) => {
    const measured = measureDimension(drivenGeo, partial);
    const dim = { id: newId(), value: measured != null ? Math.round(measured * 100) / 100 : null, ...partial };
    persist([...dims, dim]);
    setPending([]);
  }, [drivenGeo, dims, persist]);

  const handlePointClick = useCallback((idx) => {
    if (mode === 'radius' || mode === 'diameter') {
      const pt = points[idx];
      // On a genuinely round shape, drive the circle's radius/diameter. On a
      // compound/boolean shape: clicking a smooth point (on an arc) measures
      // that arc's radius (read-only); clicking a sharp corner fillets it.
      if (mode === 'radius' && !isCircular(drivenGeo) && pt) {
        if (pt.sharp) {
          commitDimension({ kind: 'fillet', a: idx, ax: pt.x, ay: pt.y, labelOffset: 30 });
        } else {
          commitDimension({ kind: 'arcRadius', a: idx, ax: pt.x, ay: pt.y, labelAngle: -45 });
        }
      } else {
        commitDimension({ kind: mode, labelAngle: -45 });
      }
      return;
    }
    const next = [...pending, idx];
    if (mode === 'linear') {
      if (next.length === 2) {
        const pa = points[next[0]], pb = points[next[1]];
        const axis = inferAxis(pa, pb);
        // Store the picked coordinates so anchors stay correct even after the
        // shape is converted to a booleanResult (whose vertex ordering differs).
        commitDimension({
          kind: 'linear', a: next[0], b: next[1], axis, labelOffset: 30,
          ax: pa?.x, ay: pa?.y, bx: pb?.x, by: pb?.y,
        });
      } else {
        setPending(next);
      }
    } else if (mode === 'angle') {
      if (next.length === 3) {
        // first click = vertex, then the two arms
        const pv = points[next[0]], pa = points[next[1]], pb = points[next[2]];
        commitDimension({
          kind: 'angle', v: next[0], a: next[1], b: next[2], labelOffset: 40,
          vx: pv?.x, vy: pv?.y, ax: pa?.x, ay: pa?.y, bx: pb?.x, by: pb?.y,
        });
      } else {
        setPending(next);
      }
    }
  }, [mode, pending, commitDimension, points, drivenGeo]);

  const startEdit = useCallback((dim) => {
    // arcRadius is a measured (read-only) value; it can't drive the merged
    // boolean geometry, so don't open an editor for it.
    if (dim.kind === 'arcRadius') return;
    setEditing({ id: dim.id, value: dim.value != null ? String(dim.value) : '' });
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 0);
  }, []);

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const num = parseFloat(editing.value);
    const next = dims.map((d) => {
      if (d.id !== editing.id) return d;
      // Linear/radius/diameter lengths must be positive; angles may be any
      // finite value. Reject anything else and keep the previous value so a
      // stray 0/negative/blank entry can't collapse the geometry.
      const isAngle = d.kind === 'angle';
      const valid = isFinite(num) && (isAngle || num > 0);
      return { ...d, value: valid ? num : d.value };
    });
    persist(next);
    setEditing(null);
  }, [editing, dims, persist]);

  const deleteDim = useCallback((id) => {
    persist(dims.filter((d) => d.id !== id));
  }, [dims, persist]);

  // --- Label dragging (SolidWorks-style: reposition a dimension's text) ---
  const dragRef = useRef(null); // { id, moved }

  const beginLabelDrag = useCallback((e, dim) => {
    e.stopPropagation();
    // Don't preventDefault here: that would swallow the dblclick used to edit.
    const startX = e.clientX, startY = e.clientY;
    dragRef.current = { id: dim.id, moved: false, startX, startY };

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      // Require a small drag past a threshold before we treat it as a move, so
      // a plain click (or double-click to edit) is never mistaken for a drag.
      if (!d.moved) {
        const dpx = Math.abs(ev.clientX - d.startX);
        const dpy = Math.abs(ev.clientY - d.startY);
        if (dpx < 4 && dpy < 4) return;
        d.moved = true;
      }
      const p = screenToSvg(ev.clientX, ev.clientY);
      // Update only the dragged dimension; write straight to params so the
      // label tracks the cursor live without flooding the undo stack.
      const next = parseJSON(node?.data?.params?.dimensions || '[]', []).map((dd) =>
        dd.id === d.id ? { ...dd, labelPos: { x: p.x, y: p.y } } : dd
      );
      updateNodeParams(nodeId, { dimensions: JSON.stringify(next) });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      const d = dragRef.current;
      dragRef.current = null;
      // Commit one undo step only if the label actually moved.
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
    persist(dims.map((d) => (d.id === dim.id ? { ...d, labelPos: undefined } : d)));
  }, [dims, persist]);

  if (!sourceGeo) return null;

  const sw = Math.max(0.5, (viewBox?.w ?? 800) * 0.0022);
  const ptR = Math.max(3, (viewBox?.w ?? 800) * 0.006);
  const accent = '#e64980';

  // Compute editable label positions for each existing dimension.
  const labelHandles = dims.map((d) => {
    const lp = getDimensionLabelPoint(drivenGeo, d, style);
    return lp ? { dim: d, ...lp } : null;
  }).filter(Boolean);

  const modeHint = mode === 'linear'
    ? 'Click two points'
    : mode === 'angle'
      ? 'Click vertex, then two arm points'
      : mode === 'radius'
        ? 'Click a circle, an arc to measure its radius, or a sharp corner to fillet it'
        : 'Click the shape to dimension its diameter';

  return (
    <g onClick={(e) => e.stopPropagation()}>
      {/* Picking handles on the driven shape */}
      {points.map((pt) => {
        const isPending = pending.includes(pt.idx);
        return (
          <g key={`pt${pt.idx}`}>
            <circle
              cx={pt.x} cy={pt.y} r={ptR * 1.6}
              fill="transparent" stroke="none"
              style={{ cursor: 'pointer' }}
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); handlePointClick(pt.idx); }}
            />
            <circle
              cx={pt.x} cy={pt.y} r={ptR}
              fill={isPending ? accent : '#ffffff'}
              stroke={isPending ? accent : style.color}
              strokeWidth={sw * 1.5}
              style={{ pointerEvents: 'none' }}
            />
          </g>
        );
      })}

      {/* Editable value handles over each dimension label */}
      {labelHandles.map(({ dim, x, y, text }) => (
        <g key={`lbl${dim.id}`}>
          <rect
            x={x - style.textSize * 1.8}
            y={y - style.textSize * 0.9}
            width={style.textSize * 3.6}
            height={style.textSize * 1.8}
            fill="transparent"
            style={{ cursor: 'move', userSelect: 'none', WebkitUserSelect: 'none' }}
            onMouseDown={(e) => { beginLabelDrag(e, dim); }}
            onDoubleClick={(e) => { e.stopPropagation(); startEdit(dim); }}
          />
          {/* small delete affordance */}
          <g
            transform={`translate(${x + style.textSize * 2}, ${y - style.textSize * 0.9})`}
            style={{ cursor: 'pointer' }}
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); deleteDim(dim.id); }}
          >
            <circle r={ptR * 0.9} fill="#ffffff" stroke={accent} strokeWidth={sw} />
            <line x1={-ptR * 0.4} y1={-ptR * 0.4} x2={ptR * 0.4} y2={ptR * 0.4} stroke={accent} strokeWidth={sw} />
            <line x1={-ptR * 0.4} y1={ptR * 0.4} x2={ptR * 0.4} y2={-ptR * 0.4} stroke={accent} strokeWidth={sw} />
          </g>
          {/* reset-position affordance, shown only once the label has been moved */}
          {dim.labelPos && (
            <g
              transform={`translate(${x - style.textSize * 2.4}, ${y - style.textSize * 0.9})`}
              style={{ cursor: 'pointer' }}
              onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); resetLabelPos(dim); }}
            >
              <circle r={ptR * 0.9} fill="#ffffff" stroke={style.color} strokeWidth={sw} />
              <path
                d={`M ${-ptR * 0.45} 0 A ${ptR * 0.45} ${ptR * 0.45} 0 1 1 ${ptR * 0.2} ${ptR * 0.4}`}
                fill="none" stroke={style.color} strokeWidth={sw}
              />
            </g>
          )}

          {editing && editing.id === dim.id && (
            <foreignObject
              x={x - style.textSize * 2.2}
              y={y - style.textSize}
              width={style.textSize * 5}
              height={style.textSize * 2}
            >
              <input
                ref={inputRef}
                type="number"
                value={editing.value}
                onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitEdit();
                  else if (e.key === 'Escape') setEditing(null);
                }}
                onBlur={commitEdit}
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                  width: '100%',
                  fontSize: `${Math.max(11, style.textSize)}px`,
                  textAlign: 'center',
                  border: `1.5px solid ${style.color}`,
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
      ))}

      {/* Mode toolbar + hint, pinned to the top-left of the current view.
          The inner content is authored at a fixed pixel size, then scaled by
          the world-units-per-reference-width ratio so it stays a stable size
          on screen at any zoom and never gets cropped. */}
      {(() => {
        const s = viewBox.w / 800; // world units per "design pixel"
        const padX = viewBox.w * 0.02;
        const padY = viewBox.h * 0.02;
        // Author the panel at a fixed 360x84 px and scale into world units.
        const PANEL_W = 360, PANEL_H = 90;
        return (
          <foreignObject
            x={viewBox.x + padX}
            y={viewBox.y + padY}
            width={PANEL_W * s}
            height={PANEL_H * s}
            style={{ overflow: 'visible' }}
          >
            <div
              style={{
                width: PANEL_W,
                height: PANEL_H,
                transform: `scale(${s})`,
                transformOrigin: 'top left',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
                fontFamily: 'system-ui, sans-serif',
              }}
              onMouseDown={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap' }}>
                {MODES.map((m) => (
                  <button
                    key={m.id}
                    onClick={(e) => { e.stopPropagation(); setMode(m.id); setPending([]); }}
                    style={{
                      fontSize: 12,
                      padding: '4px 10px',
                      borderRadius: 6,
                      whiteSpace: 'nowrap',
                      border: `1px solid ${mode === m.id ? style.color : '#ced4da'}`,
                      background: mode === m.id ? style.color : '#fff',
                      color: mode === m.id ? '#fff' : '#495057',
                      cursor: 'pointer',
                      fontWeight: mode === m.id ? 600 : 400,
                      boxShadow: '0 1px 2px rgba(0,0,0,0.08)',
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#868e96', background: 'rgba(255,255,255,0.85)', padding: '2px 6px', borderRadius: 4, width: 'fit-content', whiteSpace: 'nowrap' }}>
                {modeHint}{pending.length > 0 ? ` \u2014 ${pending.length} picked` : ''}. Drag a value to move it; double-click to edit.
              </div>
            </div>
          </foreignObject>
        );
      })()}
    </g>
  );
}
