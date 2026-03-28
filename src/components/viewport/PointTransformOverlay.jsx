import { useCallback, useMemo, useRef, useState } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { useAnimationStore } from '../../store/animationStore';
import paper from 'paper';
import { geoToPaperPath } from '../../utils/geoPathUtils';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

function extractSegmentPoints(geo, offsets, scale, scaleIndices) {
  ensurePaper();
  const path = geoToPaperPath(geo);
  if (!path) return [];

  const segments = [];
  if (path instanceof paper.CompoundPath) {
    path.children.forEach(child => {
      child.segments.forEach(seg => segments.push(seg));
    });
  } else {
    path.segments.forEach(seg => segments.push(seg));
  }

  const moved = segments.map((seg, i) => {
    const off = offsets[String(i)];
    const dx = off ? off[0] : 0;
    const dy = off ? off[1] : 0;
    return { idx: i, x: seg.point.x + dx, y: seg.point.y + dy };
  });

  if (scale !== 1 && scaleIndices.length > 0) {
    const valid = scaleIndices.filter(si => si < moved.length);
    if (valid.length > 0) {
      let cx = 0, cy = 0;
      for (const si of valid) { cx += moved[si].x; cy += moved[si].y; }
      cx /= valid.length;
      cy /= valid.length;
      for (const si of valid) {
        moved[si].x = cx + (moved[si].x - cx) * scale;
        moved[si].y = cy + (moved[si].y - cy) * scale;
      }
    }
  }

  path.remove();
  return moved;
}

export default function PointTransformOverlay({ nodeId, screenToSvg, edges, results }) {
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);
  const nodes = useGraphStore((s) => s.nodes);
  const animEnabled = useAnimationStore((s) => s.enabled);
  const currentFrame = useAnimationStore((s) => s.currentFrame);
  const setKeyframe = useAnimationStore((s) => s.setKeyframe);
  const allKeyframes = useAnimationStore((s) => s.keyframes);

  const node = nodes.find(n => n.id === nodeId);
  const params = node?.data?.params || {};

  const offsets = useMemo(() => {
    try { return JSON.parse(params.point_offsets || '{}'); }
    catch { return {}; }
  }, [params.point_offsets]);

  const offsetsRef = useRef(offsets);
  offsetsRef.current = offsets;

  const scale = params.scale ?? 1;

  const sourceEdge = edges.find(e => e.target === nodeId && e.targetHandle === 'geometry_in');
  const sourceGeoRaw = sourceEdge ? results.get(sourceEdge.source) : null;
  const sourceGeo = sourceGeoRaw && sourceGeoRaw.__multiOutput && sourceEdge?.sourceHandle
    ? sourceGeoRaw[sourceEdge.sourceHandle] : sourceGeoRaw;

  const scaleIndices = useMemo(() => {
    const s = params.scale_points || '';
    if (!s) return [];
    return s.split(',').map(x => parseInt(x, 10)).filter(x => !isNaN(x));
  }, [params.scale_points]);

  const points = useMemo(
    () => sourceGeo ? extractSegmentPoints(sourceGeo, offsets, scale, scaleIndices) : [],
    [sourceGeo, offsets, scale, scaleIndices]
  );

  const selectionRef = useRef(new Set());
  const [selVersion, setSelVersion] = useState(0);
  const selectedPts = selectionRef.current;

  const syncScalePoints = useCallback((sel) => {
    const indices = [...sel].sort((a, b) => a - b).join(',');
    updateNodeParams(nodeId, { scale_points: indices });
  }, [nodeId, updateNodeParams]);

  const handleMouseDown = useCallback((e, idx) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const { beginOperation, endOperation } = useGraphStore.getState();
    beginOperation();

    const sel = selectionRef.current;
    const wasSelected = sel.has(idx);

    if (!wasSelected) {
      sel.add(idx);
      setSelVersion(v => v + 1);
    }

    const startSvg = screenToSvg(e.clientX, e.clientY);
    const curOffsets = offsetsRef.current;
    const startOffsets = {};
    for (const i of sel) {
      startOffsets[i] = curOffsets[String(i)] ? [...curOffsets[String(i)]] : [0, 0];
    }

    let didDrag = false;
    const dragIndices = [...sel];

    const onMove = (me) => {
      const cur = screenToSvg(me.clientX, me.clientY);
      const dx = cur.x - startSvg.x;
      const dy = cur.y - startSvg.y;
      if (!didDrag && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) didDrag = true;
      if (!didDrag) return;

      const { enabled: isAnim, currentFrame: frame, keyframes: kfs, setKeyframe: setKf } = useAnimationStore.getState();
      const nodeKfs = kfs[nodeId] || {};
      const hasKfX = nodeKfs.offset_x && Object.keys(nodeKfs.offset_x).length > 0;
      const hasKfY = nodeKfs.offset_y && Object.keys(nodeKfs.offset_y).length > 0;

      if (isAnim && (hasKfX || hasKfY)) {
        const avgDx = Math.round((startOffsets[dragIndices[0]]?.[0] ?? 0 + dx) * 100) / 100;
        const avgDy = Math.round((startOffsets[dragIndices[0]]?.[1] ?? 0 + dy) * 100) / 100;
        let sumX = 0, sumY = 0;
        for (const i of dragIndices) {
          sumX += Math.round(((startOffsets[i]?.[0] ?? 0) + dx) * 100) / 100;
          sumY += Math.round(((startOffsets[i]?.[1] ?? 0) + dy) * 100) / 100;
        }
        const newOffX = Math.round((sumX / dragIndices.length) * 100) / 100;
        const newOffY = Math.round((sumY / dragIndices.length) * 100) / 100;

        if (hasKfX) setKf(nodeId, 'offset_x', frame, newOffX);
        if (hasKfY) setKf(nodeId, 'offset_y', frame, newOffY);
        updateNodeParams(nodeId, { offset_x: newOffX, offset_y: newOffY });
      } else {
        const latest = offsetsRef.current;
        const newOffsets = { ...latest };
        for (const i of dragIndices) {
          const so = startOffsets[i];
          newOffsets[String(i)] = [
            Math.round((so[0] + dx) * 100) / 100,
            Math.round((so[1] + dy) * 100) / 100,
          ];
        }

        const updates = { point_offsets: JSON.stringify(newOffsets) };
        if (dragIndices.length === 1) {
          const singleOff = newOffsets[String(dragIndices[0])];
          updates.offset_x = singleOff[0];
          updates.offset_y = singleOff[1];
        }
        updateNodeParams(nodeId, updates);
      }
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);

      if (!didDrag && wasSelected) {
        sel.delete(idx);
        setSelVersion(v => v + 1);
      }

      syncScalePoints(selectionRef.current);
      endOperation();
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [nodeId, updateNodeParams, screenToSvg, syncScalePoints]);

  if (!sourceGeo || points.length === 0) return null;

  const ptRadius = 4.5;

  let centroid = null;
  if (selectedPts.size >= 2) {
    let cx = 0, cy = 0, n = 0;
    for (const idx of selectedPts) {
      const pt = points.find(p => p.idx === idx);
      if (pt) { cx += pt.x; cy += pt.y; n++; }
    }
    if (n > 0) centroid = { x: cx / n, y: cy / n };
  }

  // Force use of selVersion to trigger re-render
  void selVersion;

  return (
    <g
      onClick={(e) => e.stopPropagation()}
    >
      {points.map(pt => {
        const isSel = selectedPts.has(pt.idx);
        return (
          <g key={pt.idx}>
            {/* Hit area */}
            <circle
              cx={pt.x}
              cy={pt.y}
              r={ptRadius}
              fill="transparent"
              stroke="none"
              style={{ cursor: 'pointer' }}
              onMouseDown={(e) => handleMouseDown(e, pt.idx)}
            />
            {/* Visible point */}
            <circle
              cx={pt.x}
              cy={pt.y}
              r={ptRadius}
              fill={isSel ? '#e64980' : '#ffffff'}
              stroke={isSel ? '#e64980' : '#868e96'}
              strokeWidth={1.5}
              style={{ cursor: 'pointer', pointerEvents: 'none' }}
            />
          </g>
        );
      })}

      {centroid && (
        <>
          <line x1={centroid.x - 6} y1={centroid.y} x2={centroid.x + 6} y2={centroid.y}
            stroke="#e64980" strokeWidth={1} opacity={0.6} style={{ pointerEvents: 'none' }} />
          <line x1={centroid.x} y1={centroid.y - 6} x2={centroid.x} y2={centroid.y + 6}
            stroke="#e64980" strokeWidth={1} opacity={0.6} style={{ pointerEvents: 'none' }} />
        </>
      )}
    </g>
  );
}
