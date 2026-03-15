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
      if (geo.children) geo.children.forEach(c => collectPoints(c, out));
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

export default function FreeCurveOverlay({ nodeId, screenToSvg, results }) {
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);
  const node = useGraphStore((s) => s.nodes.find((n) => n.id === nodeId));
  const nodeParams = node?.data?.params;
  const [isDrawing, setIsDrawing] = useState(() => {
    try {
      const existing = JSON.parse(nodeParams?.points_data || '[]');
      return existing.length === 0;
    } catch {
      return true;
    }
  });
  const isDrawingRef = useRef(isDrawing);
  isDrawingRef.current = isDrawing;
  const [preview, setPreview] = useState(null);
  const [snapTarget, setSnapTarget] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const dragIdxRef = useRef(dragIdx);
  dragIdxRef.current = dragIdx;
  const dragRef = useRef(null);
  const justFinishedDrag = useRef(false);

  const points = useMemo(() => {
    try {
      return JSON.parse(node?.data?.params?.points_data || '[]');
    } catch {
      return [];
    }
  }, [node?.data?.params?.points_data]);

  const snapPoints = useMemo(
    () => extractSnapPoints(results, nodeId),
    [results, nodeId]
  );

  const constrainToAxis = useCallback((prev, current, shiftKey) => {
    if (!shiftKey || !prev) return current;
    const dx = Math.abs(current.x - prev.x);
    const dy = Math.abs(current.y - prev.y);
    if (dx >= dy) {
      return { x: current.x, y: prev.y };
    } else {
      return { x: prev.x, y: current.y };
    }
  }, []);

  const savePoints = useCallback((newPoints) => {
    updateNodeParams(nodeId, {
      points_data: JSON.stringify(newPoints),
    });
  }, [nodeId, updateNodeParams]);

  // --- Drawing mode handlers ---
  const handleDrawClick = useCallback((e) => {
    if (e.button !== 0 || e.altKey) return;
    e.stopPropagation();

    const svgPt = screenToSvg(e.clientX, e.clientY);
    const lastPt = points.length > 0 ? points[points.length - 1] : null;
    let pt = constrainToAxis(lastPt, svgPt, e.shiftKey);

    const snap = findSnapTarget(pt, snapPoints, SNAP_DISTANCE);
    if (snap) pt = snap;

    const rounded = {
      x: Math.round(pt.x * 100) / 100,
      y: Math.round(pt.y * 100) / 100,
    };

    savePoints([...points, rounded]);
  }, [points, savePoints, screenToSvg, constrainToAxis, snapPoints]);

  const handleDrawMove = useCallback((e) => {
    const svgPt = screenToSvg(e.clientX, e.clientY);
    const lastPt = points.length > 0 ? points[points.length - 1] : null;
    let pt = constrainToAxis(lastPt, svgPt, e.shiftKey);

    const snap = findSnapTarget(pt, snapPoints, SNAP_DISTANCE);
    if (snap) {
      pt = snap;
      setSnapTarget(snap);
    } else {
      setSnapTarget(null);
    }
    setPreview(pt);
  }, [points, screenToSvg, constrainToAxis, snapPoints]);

  const handleStopDrawing = useCallback((e) => {
    e.stopPropagation();
    setIsDrawing(false);
    setPreview(null);
    setSnapTarget(null);
  }, []);

  // --- Point dragging handlers ---
  const handlePointDown = useCallback((e, idx) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    useGraphStore.getState().beginOperation();
    setDragIdx(idx);
    dragRef.current = { idx, lastSave: Date.now() };
  }, []);

  useEffect(() => {
    if (dragIdx === null) return;

    const handleDragMove = (e) => {
      const svgPt = screenToSvg(e.clientX, e.clientY);
      let pt = svgPt;

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

      const newPoints = [...points];
      newPoints[dragIdx] = rounded;
      savePoints(newPoints);
    };

    const handleDragUp = () => {
      setDragIdx(null);
      setSnapTarget(null);
      dragRef.current = null;
      useGraphStore.getState().endOperation();

      setTimeout(() => {
        justFinishedDrag.current = false;
      }, 200);
      justFinishedDrag.current = true;
    };

    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragUp);
    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragUp);
    };
  }, [dragIdx, points, savePoints, screenToSvg, snapPoints]);

  // --- Keyboard handlers ---
  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      if (dragIdxRef.current !== null) {
        setDragIdx(null);
        dragRef.current = null;
      } else {
        setIsDrawing(false);
        setPreview(null);
        setSnapTarget(null);
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleBackgroundMouseDown = useCallback((e) => {
    e.stopPropagation();
  }, []);

  const handleBackgroundClick = useCallback((e) => {
    e.stopPropagation();
    if (e.button !== 0 || e.altKey) return;

    if (isDrawing) {
      handleDrawClick(e);
    } else if (dragIdx === null && !justFinishedDrag.current) {
      setIsDrawing(true);
    }
  }, [isDrawing, dragIdx, handleDrawClick]);

  const handleBackgroundDblClick = useCallback((e) => {
    e.stopPropagation();
    if (isDrawing) {
      handleStopDrawing(e);
    }
  }, [isDrawing, handleStopDrawing]);

  const handleBackgroundMouseMove = useCallback((e) => {
    if (isDrawing) {
      handleDrawMove(e);
    }
  }, [isDrawing, handleDrawMove]);

  const lastPt = points.length > 0 ? points[points.length - 1] : null;

  const displayPoints = points;

  const bgCursor = dragIdx !== null ? 'grabbing' : isDrawing ? 'crosshair' : 'default';

  return (
    <g
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* === PERMANENT BACKGROUND — always blocks events from reaching the Viewport === */}
      <rect
        x="-100000" y="-100000" width="200000" height="200000"
        fill="transparent"
        pointerEvents="all"
        onMouseDown={handleBackgroundMouseDown}
        onClick={handleBackgroundClick}
        onDoubleClick={handleBackgroundDblClick}
        onMouseMove={handleBackgroundMouseMove}
        style={{ cursor: bgCursor }}
      />

      {isDrawing && lastPt && preview && (
        <line
          x1={lastPt.x} y1={lastPt.y}
          x2={preview.x} y2={preview.y}
          stroke="#339af0" strokeWidth={1.5}
          strokeDasharray="6,3" pointerEvents="none" opacity={0.7}
        />
      )}

      {isDrawing && preview && (
        <circle
          cx={preview.x} cy={preview.y} r={4}
          fill={snapTarget ? '#ff6b6b' : '#339af0'}
          opacity={0.7} pointerEvents="none"
        />
      )}

      {isDrawing && snapTarget && (
        <circle
          cx={snapTarget.x} cy={snapTarget.y} r={8}
          fill="none" stroke="#ff6b6b" strokeWidth={2}
          pointerEvents="none" opacity={0.8}
        />
      )}

      {isDrawing && snapPoints.map((pt, i) => (
        <circle
          key={`snap_${i}`} cx={pt.x} cy={pt.y} r={2.5}
          fill="#ff6b6b" opacity={0.3} pointerEvents="none"
        />
      ))}

      {/* === SNAP INDICATORS DURING DRAG === */}
      {!isDrawing && dragIdx !== null && snapTarget && (
        <circle
          cx={snapTarget.x} cy={snapTarget.y} r={8}
          fill="none" stroke="#ff6b6b" strokeWidth={2}
          pointerEvents="none" opacity={0.8}
        />
      )}

      {/* === POINT HANDLES (draggable when not drawing) — rendered last so they're on top === */}
      {displayPoints.map((pt, i) => (
        <circle
          key={i}
          cx={pt.x} cy={pt.y}
          r={dragIdx === i ? 6 : 5}
          fill={dragIdx === i ? '#ff6b6b' : i === 0 ? '#22b8cf' : '#339af0'}
          stroke="#1a1a2e"
          strokeWidth={1.5}
          style={{ cursor: isDrawing ? 'default' : 'grab' }}
          pointerEvents={isDrawing ? 'none' : 'all'}
          onMouseDown={!isDrawing ? (e) => handlePointDown(e, i) : undefined}
        />
      ))}
    </g>
  );
}
