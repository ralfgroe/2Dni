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
    return { kind: 'path', d: geo.pathData };
  }
  const b = geo.bounds
    || (typeof geo.x === 'number' && typeof geo.width === 'number'
      ? { x: geo.x, y: geo.y, width: geo.width, height: geo.height }
      : null);
  if (b) return { kind: 'rect', x: b.x, y: b.y, width: b.width, height: b.height };
  return null;
}

// Interactive component picker for the Delete node. Clicking a part toggles
// whether it is marked for deletion. Marked parts are tinted red and removed
// from the output; everything else passes through.
export default function DeleteOverlay({ nodeId, edges, results, viewBox }) {
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
  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);

  const toggle = useCallback((e, idx) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const { beginOperation, endOperation } = useGraphStore.getState();
    beginOperation();
    const sel = new Set(selectedRef.current);
    if (sel.has(idx)) sel.delete(idx); else sel.add(idx);
    updateNodeParams(nodeId, { selected: JSON.stringify([...sel].sort((a, b) => a - b)) });
    endOperation();
  }, [nodeId, updateNodeParams]);

  if (!sourceGeo || parts.length === 0) return null;

  const sw = Math.max(0.6, (viewBox?.w ?? 800) * 0.0025);

  return (
    <g onClick={(e) => e.stopPropagation()}>
      {parts.map((part) => {
        const shape = partShape(part.geo);
        if (!shape) return null;
        const isDel = selected.has(part.idx);

        const common = {
          fill: isDel ? 'rgba(240, 62, 62, 0.30)' : 'rgba(66, 99, 235, 0.06)',
          stroke: isDel ? '#e03131' : '#4263eb',
          strokeWidth: isDel ? sw * 2 : sw,
          strokeDasharray: isDel ? undefined : `${sw * 3} ${sw * 2}`,
          pointerEvents: 'none',
        };

        // A separate fat, invisible hit target makes thin/open dash pieces easy
        // to click. Its stroke width is generous so small dashes are reachable.
        const hitProps = {
          fill: 'transparent',
          stroke: '#000',
          strokeOpacity: 0,
          strokeWidth: Math.max(sw * 8, (part.geo?.strokeWidth ?? 0) + sw * 6),
          strokeLinecap: 'round',
          style: { cursor: 'pointer' },
          onMouseDown: (e) => toggle(e, part.idx),
        };

        return (
          <g key={part.idx}>
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
