import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { extractParts } from '../../nodes/select';

function parseJSON(str, fallback) {
  try {
    const v = JSON.parse(str);
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

// Returns an SVG-renderable description for a part: prefer the real path data
// (shape-accurate hit testing), fall back to the bounding box rectangle.
function partShape(geo) {
  if (!geo) return null;
  if (geo.type === 'booleanResult' && geo.pathData) {
    return { kind: 'path', d: geo.pathData, fill: geo.fill };
  }
  const b = geo.bounds
    || (typeof geo.x === 'number' && typeof geo.width === 'number'
      ? { x: geo.x, y: geo.y, width: geo.width, height: geo.height }
      : null);
  if (b) return { kind: 'rect', x: b.x, y: b.y, width: b.width, height: b.height, fill: geo.fill };
  return null;
}

export default function SelectOverlay({ nodeId, screenToSvg, edges, results, viewBox }) {
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);
  const nodes = useGraphStore((s) => s.nodes);
  const node = nodes.find((n) => n.id === nodeId);
  const params = node?.data?.params || {};

  const sourceEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'geometry_in');
  const sourceGeoRaw = sourceEdge ? results.get(sourceEdge.source) : null;
  const sourceGeo = sourceGeoRaw && sourceGeoRaw.__multiOutput && sourceEdge?.sourceHandle
    ? sourceGeoRaw[sourceEdge.sourceHandle]
    : sourceGeoRaw;

  const parts = useMemo(() => (sourceGeo ? extractParts(sourceGeo) : []), [sourceGeo]);

  const selected = useMemo(
    () => new Set(parseJSON(params.selected || '[]', [])),
    [params.selected]
  );
  const offsets = useMemo(() => parseJSON(params.offsets || '{}', {}), [params.offsets]);
  const offsetsRef = useRef(offsets);
  const selectedRef = useRef(selected);
  useEffect(() => { offsetsRef.current = offsets; }, [offsets]);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const persistSelection = useCallback((sel) => {
    updateNodeParams(nodeId, { selected: JSON.stringify([...sel].sort((a, b) => a - b)) });
  }, [nodeId, updateNodeParams]);

  const handleMouseDown = useCallback((e, idx) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();

    const { beginOperation, endOperation } = useGraphStore.getState();
    beginOperation();

    const sel = new Set(selectedRef.current);
    const wasSelected = sel.has(idx);
    if (!wasSelected) {
      sel.add(idx);
      persistSelection(sel);
    }

    const startSvg = screenToSvg(e.clientX, e.clientY);
    const startOffsets = {};
    for (const i of sel) {
      const o = offsetsRef.current[String(i)];
      startOffsets[i] = o ? [...o] : [0, 0];
    }

    let didDrag = false;
    const dragIndices = [...sel];

    const onMove = (me) => {
      const cur = screenToSvg(me.clientX, me.clientY);
      const dx = cur.x - startSvg.x;
      const dy = cur.y - startSvg.y;
      if (!didDrag && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) didDrag = true;
      if (!didDrag) return;

      const newOffsets = { ...offsetsRef.current };
      for (const i of dragIndices) {
        const so = startOffsets[i];
        newOffsets[String(i)] = [
          Math.round((so[0] + dx) * 100) / 100,
          Math.round((so[1] + dy) * 100) / 100,
        ];
      }
      updateNodeParams(nodeId, { offsets: JSON.stringify(newOffsets) });
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      // A click without drag toggles selection off (if it was already selected).
      if (!didDrag && wasSelected) {
        const next = new Set(selectedRef.current);
        next.delete(idx);
        persistSelection(next);
      }
      endOperation();
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [nodeId, updateNodeParams, screenToSvg, persistSelection]);

  if (!sourceGeo || parts.length === 0) return null;

  const sw = Math.max(0.6, (viewBox?.w ?? 800) * 0.0025);

  return (
    <g onClick={(e) => e.stopPropagation()}>
      {parts.map((part) => {
        const shape = partShape(part.geo);
        if (!shape) return null;
        const isSel = selected.has(part.idx);
        const off = offsets[String(part.idx)];
        const tx = off ? off[0] : 0;
        const ty = off ? off[1] : 0;
        const transform = tx || ty ? `translate(${tx}, ${ty})` : undefined;

        const common = {
          fill: isSel ? 'rgba(230, 73, 128, 0.25)' : 'rgba(66, 99, 235, 0.001)',
          stroke: isSel ? '#e64980' : '#4263eb',
          strokeWidth: isSel ? sw * 2 : sw,
          strokeDasharray: isSel ? undefined : `${sw * 3} ${sw * 2}`,
          pointerEvents: 'none',
        };

        // Fat invisible hit target so thin/open pieces (e.g. dashes) are
        // clickable and draggable, not just their hairline stroke.
        const hitProps = {
          fill: 'transparent',
          stroke: '#000',
          strokeOpacity: 0,
          strokeWidth: Math.max(sw * 8, (part.geo?.strokeWidth ?? 0) + sw * 6),
          strokeLinecap: 'round',
          style: { cursor: 'move' },
          onMouseDown: (e) => handleMouseDown(e, part.idx),
        };

        return (
          <g key={part.idx} transform={transform}>
            {shape.kind === 'path' ? (
              <>
                <path d={shape.d} {...common} />
                <path d={shape.d} {...hitProps} />
              </>
            ) : (
              <>
                <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} {...common} />
                <rect x={shape.x} y={shape.y} width={shape.width} height={shape.height} {...hitProps} />
              </>
            )}
          </g>
        );
      })}
    </g>
  );
}
