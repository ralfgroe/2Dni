import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { useGraphStore } from '../../store/graphStore';

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
          for (let i = 0; i < coords.length - 1; i += 2)
            out.push({ x: parseFloat(coords[i]), y: parseFloat(coords[i + 1]) });
        }
      }
      break;
    case 'rect': case 'roundedRect':
      out.push({ x: geo.x, y: geo.y });
      out.push({ x: geo.x + geo.width, y: geo.y });
      out.push({ x: geo.x + geo.width, y: geo.y + geo.height });
      out.push({ x: geo.x, y: geo.y + geo.height });
      break;
    case 'group':
      if (geo.children) geo.children.forEach(c => collectPoints(c, out));
      break;
    default: break;
  }
}

function findSnap(cursor, pts, threshold) {
  let best = null, bestD = threshold;
  for (const pt of pts) {
    const d = Math.hypot(cursor.x - pt.x, cursor.y - pt.y);
    if (d < bestD) { bestD = d; best = pt; }
  }
  return best;
}

function r2(v) { return Math.round(v * 100) / 100; }

function mirror(anchor, handle) {
  return { x: r2(2 * anchor.x - handle.x), y: r2(2 * anchor.y - handle.y) };
}

function autoSmooth(anchors) {
  const n = anchors.length;
  if (n < 2) return anchors;
  const out = anchors.map(a => ({
    point: { ...a.point },
    handleIn: { ...a.handleIn },
    handleOut: { ...a.handleOut },
    manual: a.manual || false,
  }));
  for (let i = 0; i < n; i++) {
    if (out[i].manual) continue;
    const p = out[i].point;
    const prev = i > 0 ? out[i - 1].point : null;
    const next = i < n - 1 ? out[i + 1].point : null;
    if (prev && next) {
      const tx = (next.x - prev.x) / 4;
      const ty = (next.y - prev.y) / 4;
      out[i].handleIn = { x: r2(p.x - tx), y: r2(p.y - ty) };
      out[i].handleOut = { x: r2(p.x + tx), y: r2(p.y + ty) };
    } else if (prev && !next) {
      const tx = (p.x - prev.x) / 4;
      const ty = (p.y - prev.y) / 4;
      out[i].handleIn = { x: r2(p.x - tx), y: r2(p.y - ty) };
      out[i].handleOut = { ...p };
    } else if (!prev && next) {
      const tx = (next.x - p.x) / 4;
      const ty = (next.y - p.y) / 4;
      out[i].handleOut = { x: r2(p.x + tx), y: r2(p.y + ty) };
      out[i].handleIn = { ...p };
    }
  }
  return out;
}

export default function BezierOverlay({ nodeId, screenToSvg, results }) {
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === nodeId));
  const nodeParams = node?.data?.params;

  const [isDrawing, setIsDrawing] = useState(() => {
    try { return JSON.parse(nodeParams?.anchors_data || '[]').length === 0; }
    catch { return true; }
  });
  const isDrawingRef = useRef(isDrawing);
  isDrawingRef.current = isDrawing;
  const [preview, setPreview] = useState(null);
  const [snapTarget, setSnapTarget] = useState(null);
  const [, forceRender] = useState(0);
  const justFinishedDrag = useRef(false);
  const dragRef = useRef({ active: false, idx: null, type: null });
  const anchorsRef = useRef([]);

  const anchors = useMemo(() => {
    try {
      const parsed = JSON.parse(node?.data?.params?.anchors_data || '[]');
      anchorsRef.current = parsed;
      return parsed;
    } catch { return []; }
  }, [node?.data?.params?.anchors_data]);

  const snapPoints = useMemo(() => extractSnapPoints(results, nodeId), [results, nodeId]);
  const screenToSvgRef = useRef(screenToSvg);
  screenToSvgRef.current = screenToSvg;
  const snapPointsRef = useRef(snapPoints);
  snapPointsRef.current = snapPoints;

  const saveAnchors = useCallback((a) => {
    anchorsRef.current = a;
    updateNodeParams(nodeId, { anchors_data: JSON.stringify(a) });
  }, [nodeId, updateNodeParams]);

  const startDrag = useCallback((idx, type) => {
    dragRef.current = { active: true, idx, type };
    forceRender(c => c + 1);
    useGraphStore.getState().beginOperation();

    const onMove = (e) => {
      const svgPt = screenToSvgRef.current(e.clientX, e.clientY);
      let pt = { x: r2(svgPt.x), y: r2(svgPt.y) };
      const snap = findSnap(pt, snapPointsRef.current, SNAP_DISTANCE);
      if (snap) { pt = { x: r2(snap.x), y: r2(snap.y) }; setSnapTarget(snap); }
      else setSnapTarget(null);

      const cur = anchorsRef.current;
      const d = dragRef.current;
      if (!d.active || d.idx == null || d.idx >= cur.length) return;
      const updated = cur.map(a => ({ point:{...a.point}, handleIn:{...a.handleIn}, handleOut:{...a.handleOut}, manual: a.manual||false }));
      const anc = updated[d.idx];

      if (d.type === 'anchor') {
        const dx = pt.x - anc.point.x, dy = pt.y - anc.point.y;
        anc.point = pt;
        anc.handleIn = { x: r2(anc.handleIn.x+dx), y: r2(anc.handleIn.y+dy) };
        anc.handleOut = { x: r2(anc.handleOut.x+dx), y: r2(anc.handleOut.y+dy) };
      } else if (d.type === 'handleOut') {
        anc.handleOut = pt;
        anc.handleIn = mirror(anc.point, pt);
        anc.manual = true;
      } else if (d.type === 'handleIn') {
        anc.handleIn = pt;
        anc.handleOut = mirror(anc.point, pt);
        anc.manual = true;
      }
      saveAnchors(updated);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dragRef.current = { active: false, idx: null, type: null };
      setSnapTarget(null);
      forceRender(c => c + 1);
      useGraphStore.getState().endOperation();
      justFinishedDrag.current = true;
      setTimeout(() => { justFinishedDrag.current = false; }, 200);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [saveAnchors]);

  const handleDrawClick = useCallback((e) => {
    if (e.button !== 0 || e.altKey) return;
    e.stopPropagation(); e.preventDefault();
    const svgPt = screenToSvg(e.clientX, e.clientY);
    let pt = { x: r2(svgPt.x), y: r2(svgPt.y) };
    const snap = findSnap(pt, snapPoints, SNAP_DISTANCE);
    if (snap) pt = { x: r2(snap.x), y: r2(snap.y) };

    const newAnchor = { point: pt, handleIn: {...pt}, handleOut: {...pt}, manual: false };
    const newAnchors = [...anchorsRef.current, newAnchor];
    saveAnchors(autoSmooth(newAnchors));
  }, [screenToSvg, snapPoints, saveAnchors]);

  const handleDrawMove = useCallback((e) => {
    const svgPt = screenToSvg(e.clientX, e.clientY);
    let pt = svgPt;
    const snap = findSnap(pt, snapPoints, SNAP_DISTANCE);
    if (snap) { pt = snap; setSnapTarget(snap); } else setSnapTarget(null);
    setPreview(pt);
  }, [screenToSvg, snapPoints]);

  const handleStopDrawing = useCallback(() => {
    setIsDrawing(false); setPreview(null); setSnapTarget(null);
  }, []);

  const handleAnchorDown = useCallback((e, idx) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    startDrag(idx, 'anchor');
  }, [startDrag]);

  const handleHandleDown = useCallback((e, idx, type) => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    startDrag(idx, type);
  }, [startDrag]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      if (dragRef.current.active) {
        dragRef.current = { active: false, idx: null, type: null };
        forceRender(c => c + 1);
      } else if (isDrawingRef.current) {
        handleStopDrawing();
      }
    }
  }, [handleStopDrawing]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleBgMouseDown = useCallback((e) => {
    e.stopPropagation();
    if (isDrawing && !dragRef.current.active) handleDrawClick(e);
  }, [isDrawing, handleDrawClick]);

  const handleBgClick = useCallback((e) => {
    e.stopPropagation();
    if (!isDrawing && !dragRef.current.active && !justFinishedDrag.current) setIsDrawing(true);
  }, [isDrawing]);

  const handleBgDblClick = useCallback((e) => {
    e.stopPropagation();
    if (isDrawing) handleStopDrawing();
  }, [isDrawing, handleStopDrawing]);

  const handleBgMouseMove = useCallback((e) => {
    if (isDrawing && !dragRef.current.active) handleDrawMove(e);
  }, [isDrawing, handleDrawMove]);

  const lastAnc = anchors.length > 0 ? anchors[anchors.length - 1] : null;
  const drag = dragRef.current;
  const bgCursor = drag.active ? 'grabbing' : isDrawing ? 'crosshair' : 'default';

  let previewPath = null;
  if (isDrawing && lastAnc && preview && !drag.active) {
    const cp1 = lastAnc.handleOut || lastAnc.point;
    previewPath = `M${lastAnc.point.x},${lastAnc.point.y} C${cp1.x},${cp1.y} ${preview.x},${preview.y} ${preview.x},${preview.y}`;
  }

  return (
    <g onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      <rect x="-100000" y="-100000" width="200000" height="200000"
        fill="transparent" pointerEvents="all"
        onMouseDown={handleBgMouseDown} onClick={handleBgClick}
        onDoubleClick={handleBgDblClick} onMouseMove={handleBgMouseMove}
        style={{ cursor: bgCursor }} />

      {previewPath && (
        <path d={previewPath} fill="none" stroke="#339af0" strokeWidth={1.5}
          strokeDasharray="6,3" pointerEvents="none" opacity={0.7} />
      )}

      {isDrawing && preview && !drag.active && (
        <circle cx={preview.x} cy={preview.y} r={4}
          fill={snapTarget ? '#ff6b6b' : '#339af0'} opacity={0.7} pointerEvents="none" />
      )}

      {snapTarget && (
        <circle cx={snapTarget.x} cy={snapTarget.y} r={8}
          fill="none" stroke="#ff6b6b" strokeWidth={2} pointerEvents="none" opacity={0.8} />
      )}

      {isDrawing && snapPoints.map((pt, i) => (
        <circle key={`snap_${i}`} cx={pt.x} cy={pt.y} r={2.5}
          fill="#ff6b6b" opacity={0.3} pointerEvents="none" />
      ))}

      {anchors.map((a, i) => {
        const hoX = Math.abs(a.handleOut.x - a.point.x) > 0.5 || Math.abs(a.handleOut.y - a.point.y) > 0.5;
        const hiX = Math.abs(a.handleIn.x - a.point.x) > 0.5 || Math.abs(a.handleIn.y - a.point.y) > 0.5;
        if (!hoX && !hiX) return null;
        return (
          <g key={`h_${i}`}>
            {hoX && <>
              <line x1={a.point.x} y1={a.point.y} x2={a.handleOut.x} y2={a.handleOut.y}
                stroke="#339af0" strokeWidth={1} opacity={0.5} pointerEvents="none" />
              <circle cx={a.handleOut.x} cy={a.handleOut.y} r={4}
                fill="#fff" stroke="#339af0" strokeWidth={1.5}
                style={{ cursor: isDrawing ? 'default' : 'grab' }}
                pointerEvents={isDrawing ? 'none' : 'all'}
                onMouseDown={!isDrawing ? (e) => handleHandleDown(e, i, 'handleOut') : undefined} />
            </>}
            {hiX && <>
              <line x1={a.point.x} y1={a.point.y} x2={a.handleIn.x} y2={a.handleIn.y}
                stroke="#339af0" strokeWidth={1} opacity={0.5} pointerEvents="none" />
              <circle cx={a.handleIn.x} cy={a.handleIn.y} r={4}
                fill="#fff" stroke="#339af0" strokeWidth={1.5}
                style={{ cursor: isDrawing ? 'default' : 'grab' }}
                pointerEvents={isDrawing ? 'none' : 'all'}
                onMouseDown={!isDrawing ? (e) => handleHandleDown(e, i, 'handleIn') : undefined} />
            </>}
          </g>
        );
      })}

      {anchors.map((a, i) => (
        <circle key={`a_${i}`} cx={a.point.x} cy={a.point.y}
          r={drag.active && drag.idx === i && drag.type === 'anchor' ? 6 : 5}
          fill={drag.active && drag.idx === i ? '#ff6b6b' : i === 0 ? '#22b8cf' : '#339af0'}
          stroke="#1a1a2e" strokeWidth={1.5}
          style={{ cursor: isDrawing ? 'default' : 'grab' }}
          pointerEvents={isDrawing ? 'none' : 'all'}
          onMouseDown={!isDrawing ? (e) => handleAnchorDown(e, i) : undefined} />
      ))}
    </g>
  );
}
