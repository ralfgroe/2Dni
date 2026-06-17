import { useCallback, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useGraphStore } from '../../store/graphStore';
import { extractPoints } from '../../utils/geometryPoints';
import { getDimensionLabelPoint, measureDimension, isCircular, solveDimensions } from '../../nodes/dimension';

function parseJSON(str, fallback) {
  try { const v = JSON.parse(str); return v ?? fallback; } catch { return fallback; }
}

let idCounter = 0;
function newId() { return `d${Date.now().toString(36)}${(idCounter++).toString(36)}`; }

// Decide how a two-point linear dimension should be measured/drawn based on the
// edge the user picked. A near-vertical edge measures its vertical extent; a
// near-horizontal edge measures its horizontal extent; clearly diagonal stays
// 'aligned'.
function inferAxis(a, b) {
  if (!a || !b) return 'aligned';
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  if (dx <= 1e-6 && dy <= 1e-6) return 'aligned';
  if (dy >= dx * 3) return 'vertical';
  if (dx >= dy * 3) return 'horizontal';
  return 'aligned';
}

const MODES = [
  { id: 'linear', label: 'Linear' },
  { id: 'radius', label: 'Radius' },
  { id: 'diameter', label: 'Diameter' },
  { id: 'angle', label: 'Angle' },
  { id: 'relation', label: 'Relation' },
];

// SolidWorks-style status colors.
const STATUS = {
  under: { color: '#1366d6', label: 'Under-defined' },
  fully: { color: '#1a1a1a', label: 'Fully defined' },
  over: { color: '#e03131', label: 'Over-defined' },
};

export default function DimensionOverlay({ nodeId, screenToSvg, edges, results, viewBox }) {
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);
  const nodes = useGraphStore((s) => s.nodes);
  const node = nodes.find((n) => n.id === nodeId);
  const params = node?.data?.params || {};

  const [mode, setMode] = useState('linear');
  const [relationKind, setRelationKind] = useState('horizontal');
  const [pending, setPending] = useState([]);
  const [editing, setEditing] = useState(null);
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

  const solved = useMemo(
    () => (sourceGeo ? solveDimensions(sourceGeo, dims) : null),
    [sourceGeo, dims]
  );
  // The skeleton (solved polygon WITHOUT fillets) is the stable surface for
  // picking, anchoring and measuring — fillets would otherwise add arc points
  // that shift vertex indices and break dimension anchors.
  const skeletonGeo = solved ? solved.skeleton : null;
  const conflicts = solved ? solved.conflicts : null;
  const status = solved ? solved.status : 'under';
  const statusInfo = STATUS[status] || STATUS.under;

  const points = useMemo(() => (skeletonGeo ? extractPoints(skeletonGeo) : []), [skeletonGeo]);

  const persist = useCallback((nextDims) => {
    const { beginOperation, endOperation } = useGraphStore.getState();
    beginOperation();
    updateNodeParams(nodeId, { dimensions: JSON.stringify(nextDims) });
    endOperation();
  }, [nodeId, updateNodeParams]);

  const commitDimension = useCallback((partial) => {
    if (partial.kind === 'relation') {
      persist([...dims, { id: newId(), ...partial }]);
      setPending([]);
      return;
    }
    const measured = measureDimension(skeletonGeo, partial);
    const dim = { id: newId(), value: measured != null ? Math.round(measured * 100) / 100 : null, ...partial };
    persist([...dims, dim]);
    setPending([]);
  }, [skeletonGeo, dims, persist]);

  const handlePointClick = useCallback((idx) => {
    if (mode === 'radius' || mode === 'diameter') {
      const pt = points[idx];
      if (mode === 'radius' && !isCircular(skeletonGeo) && pt) {
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
    if (mode === 'relation') {
      if (next.length === 2) {
        const pa = points[next[0]], pb = points[next[1]];
        commitDimension({
          kind: 'relation', relation: relationKind, a: next[0], b: next[1],
          ax: pa?.x, ay: pa?.y, bx: pb?.x, by: pb?.y, labelOffset: 24,
        });
      } else {
        setPending(next);
      }
    } else if (mode === 'linear') {
      if (next.length === 2) {
        const pa = points[next[0]], pb = points[next[1]];
        const axis = inferAxis(pa, pb);
        commitDimension({
          kind: 'linear', a: next[0], b: next[1], axis, labelOffset: 30,
          ax: pa?.x, ay: pa?.y, bx: pb?.x, by: pb?.y,
        });
      } else {
        setPending(next);
      }
    } else if (mode === 'angle') {
      if (next.length === 3) {
        const pv = points[next[0]], pa = points[next[1]], pb = points[next[2]];
        commitDimension({
          kind: 'angle', v: next[0], a: next[1], b: next[2], labelOffset: 40,
          vx: pv?.x, vy: pv?.y, ax: pa?.x, ay: pa?.y, bx: pb?.x, by: pb?.y,
        });
      } else {
        setPending(next);
      }
    }
  }, [mode, relationKind, pending, commitDimension, points, skeletonGeo]);

  const startEdit = useCallback((dim) => {
    if (dim.kind === 'arcRadius' || dim.kind === 'relation') return;
    setEditing({ id: dim.id, value: dim.value != null ? String(dim.value) : '' });
    setTimeout(() => { inputRef.current?.focus(); inputRef.current?.select(); }, 0);
  }, []);

  const commitEdit = useCallback(() => {
    if (!editing) return;
    const num = parseFloat(editing.value);
    const next = dims.map((d) => {
      if (d.id !== editing.id) return d;
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

  const dragRef = useRef(null);

  const beginLabelDrag = useCallback((e, dim) => {
    e.stopPropagation();
    const startX = e.clientX, startY = e.clientY;
    dragRef.current = { id: dim.id, moved: false, startX, startY };

    const onMove = (ev) => {
      const d = dragRef.current;
      if (!d) return;
      if (!d.moved) {
        const dpx = Math.abs(ev.clientX - d.startX);
        const dpy = Math.abs(ev.clientY - d.startY);
        if (dpx < 4 && dpy < 4) return;
        d.moved = true;
      }
      const p = screenToSvg(ev.clientX, ev.clientY);
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

  const labelHandles = dims.map((d) => {
    const lp = getDimensionLabelPoint(skeletonGeo, d, style);
    return lp ? { dim: d, ...lp } : null;
  }).filter(Boolean);

  const modeHint = mode === 'linear'
    ? 'Click two points to dimension'
    : mode === 'relation'
      ? `Click two points on a line to lock it ${relationKind}`
    : mode === 'angle'
      ? 'Click vertex, then two arm points'
      : mode === 'radius'
        ? 'Click a circle, an arc to measure its radius, or a sharp corner to fillet it'
        : 'Click the shape to dimension its diameter';

  const handles = (
    <g onClick={(e) => e.stopPropagation()} style={{ userSelect: 'none', WebkitUserSelect: 'none' }}>
      {/* Picking handles on the driven shape, tinted by sketch status. */}
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
              stroke={isPending ? accent : statusInfo.color}
              strokeWidth={sw * 1.5}
              style={{ pointerEvents: 'none' }}
            />
          </g>
        );
      })}

      {/* Editable value handles over each dimension label */}
      {labelHandles.map(({ dim, x, y }) => {
        const isConflict = conflicts && conflicts.has(dim.id);
        return (
        <g key={`lbl${dim.id}`}>
          {isConflict && (
            <g pointerEvents="none">
              <circle cx={x} cy={y} r={style.textSize * 1.5} fill="rgba(224,49,49,0.12)" stroke="#e03131" strokeWidth={sw} />
              <g transform={`translate(${x + style.textSize * 2.6}, ${y})`}>
                <line x1={-style.textSize * 0.4} y1={-style.textSize * 0.4} x2={style.textSize * 0.4} y2={style.textSize * 0.4} stroke="#e03131" strokeWidth={sw * 1.6} strokeLinecap="round" />
                <line x1={-style.textSize * 0.4} y1={style.textSize * 0.4} x2={style.textSize * 0.4} y2={-style.textSize * 0.4} stroke="#e03131" strokeWidth={sw * 1.6} strokeLinecap="round" />
              </g>
            </g>
          )}
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
          <g
            transform={`translate(${x + style.textSize * 2}, ${y - style.textSize * 0.9})`}
            style={{ cursor: 'pointer' }}
            onMouseDown={(e) => { e.stopPropagation(); e.preventDefault(); deleteDim(dim.id); }}
          >
            <circle r={ptR * 0.9} fill="#ffffff" stroke={accent} strokeWidth={sw} />
            <line x1={-ptR * 0.4} y1={-ptR * 0.4} x2={ptR * 0.4} y2={ptR * 0.4} stroke={accent} strokeWidth={sw} />
            <line x1={-ptR * 0.4} y1={ptR * 0.4} x2={ptR * 0.4} y2={-ptR * 0.4} stroke={accent} strokeWidth={sw} />
          </g>
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
      );
      })}
    </g>
  );

  // Screen-fixed compact toolbar, mounted next to the # grid button so it never
  // eats stage space and doesn't scale with zoom.
  const canvasEl = typeof document !== 'undefined'
    ? document.querySelector('[data-viewport-canvas]')
    : null;
  const btn = (active) => ({
    fontSize: 11,
    padding: '3px 9px',
    height: 22,
    borderRadius: 5,
    whiteSpace: 'nowrap',
    border: `1px solid ${active ? style.color : '#ced4da'}`,
    background: active ? style.color : '#fff',
    color: active ? '#fff' : '#495057',
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
    lineHeight: 1,
  });
  const subBtn = (active) => ({
    fontSize: 11,
    padding: '3px 8px',
    height: 22,
    borderRadius: 5,
    whiteSpace: 'nowrap',
    border: `1px solid ${active ? style.color : '#dee2e6'}`,
    background: active ? 'rgba(19,102,214,0.12)' : '#fff',
    color: active ? style.color : '#868e96',
    cursor: 'pointer',
    fontWeight: active ? 600 : 400,
    lineHeight: 1,
  });

  const toolbar = (
    <div
      className="absolute top-2 z-10"
      style={{ left: 44, display: 'flex', flexDirection: 'column', gap: 5, fontFamily: 'system-ui, sans-serif', pointerEvents: 'auto' }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'nowrap' }}>
        {MODES.map((m) => (
          <button key={m.id} onClick={() => { setMode(m.id); setPending([]); }} style={btn(mode === m.id)}>
            {m.label}
          </button>
        ))}
        {mode === 'relation' && [
          { id: 'horizontal', label: 'Horizontal' },
          { id: 'vertical', label: 'Vertical' },
        ].map((rk) => (
          <button key={rk.id} onClick={() => { setRelationKind(rk.id); setPending([]); }} style={subBtn(relationKind === rk.id)}>
            {rk.label}
          </button>
        ))}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginLeft: 6 }}>
          <span style={{ width: 9, height: 9, borderRadius: '50%', background: statusInfo.color, border: '1px solid rgba(0,0,0,0.15)' }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: statusInfo.color }}>{statusInfo.label}</span>
        </span>
      </div>
      <div style={{ fontSize: 10, color: '#868e96', background: 'rgba(255,255,255,0.85)', padding: '2px 6px', borderRadius: 4, width: 'fit-content', whiteSpace: 'nowrap' }}>
        {modeHint}{pending.length > 0 ? ` \u2014 ${pending.length} picked` : ''}. Drag a value to move it; double-click to edit.
      </div>
    </div>
  );

  return (
    <>
      {handles}
      {canvasEl ? createPortal(toolbar, canvasEl) : null}
    </>
  );
}
