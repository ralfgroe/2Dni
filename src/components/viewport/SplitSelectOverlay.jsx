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

// Sample evenly spaced points along a path's centerline using the browser's
// native path measurement. Used for accurate nearest-piece click selection.
function samplePathPoints(d, maxSamples = 24) {
  if (typeof document === 'undefined') return [];
  try {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    el.setAttribute('d', d);
    const len = el.getTotalLength();
    if (!len || !isFinite(len)) return [];
    const n = Math.max(2, Math.min(maxSamples, Math.ceil(len / 2)));
    const pts = [];
    for (let i = 0; i <= n; i++) {
      const p = el.getPointAtLength((len * i) / n);
      pts.push([p.x, p.y]);
    }
    return pts;
  } catch {
    return [];
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

// Squared distance from point (px,py) to a part's sampled centerline (or its
// bounds center as a fallback). Used to pick the piece nearest the cursor.
function distToPart(px, py, part) {
  const samples = part._samples;
  if (samples && samples.length) {
    let best = Infinity;
    for (const [x, y] of samples) {
      const dx = x - px, dy = y - py;
      const dd = dx * dx + dy * dy;
      if (dd < best) best = dd;
    }
    return best;
  }
  const b = part.geo?.bounds;
  if (b) {
    const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
    const dx = cx - px, dy = cy - py;
    return dx * dx + dy * dy;
  }
  return Infinity;
}

// Interactive component picker for the Split Select node. Clicking a part
// toggles whether it belongs to the "Selected" output (second terminal). Picked
// parts are tinted green (output 2), the rest blue (output 1).
export default function SplitSelectOverlay({ nodeId, edges, results, viewBox }) {
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);
  const nodes = useGraphStore((s) => s.nodes);
  const node = nodes.find((n) => n.id === nodeId);
  const params = node?.data?.params || {};

  const sourceEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'geometry_in');
  const sourceGeoRaw = sourceEdge ? results.get(sourceEdge.source) : null;
  const sourceGeo = sourceGeoRaw && sourceGeoRaw.__multiOutput && sourceEdge?.sourceHandle
    ? sourceGeoRaw[sourceEdge.sourceHandle]
    : sourceGeoRaw;

  const parts = useMemo(() => {
    if (!sourceGeo) return [];
    const list = extractParts(sourceGeo);
    for (const part of list) {
      const shape = partShape(part.geo);
      part._samples = shape?.kind === 'path' ? samplePathPoints(shape.d) : null;
    }
    return list;
  }, [sourceGeo]);

  const selected = useMemo(
    () => new Set(parseJSON(params.selected || '[]', [])),
    [params.selected]
  );
  const selectedRef = useRef(selected);
  useEffect(() => { selectedRef.current = selected; }, [selected]);
  const partsRef = useRef(parts);
  useEffect(() => { partsRef.current = parts; }, [parts]);

  const toggleIdx = useCallback((idx) => {
    const { beginOperation, endOperation } = useGraphStore.getState();
    beginOperation();
    const sel = new Set(selectedRef.current);
    if (sel.has(idx)) sel.delete(idx); else sel.add(idx);
    updateNodeParams(nodeId, { selected: JSON.stringify([...sel].sort((a, b) => a - b)) });
    endOperation();
  }, [nodeId, updateNodeParams]);

  // Pick the piece whose centerline is nearest the cursor, in SVG coordinates.
  // This removes paint-order ambiguity when hit areas overlap while zoomed in.
  const handleDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const svg = e.currentTarget.ownerSVGElement || e.currentTarget.closest('svg');
    if (!svg) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const inv = ctm.inverse();
    const px = inv.a * e.clientX + inv.c * e.clientY + inv.e;
    const py = inv.b * e.clientX + inv.d * e.clientY + inv.f;

    let bestIdx = null;
    let bestDist = Infinity;
    for (const part of partsRef.current) {
      const dd = distToPart(px, py, part);
      if (dd < bestDist) { bestDist = dd; bestIdx = part.idx; }
    }
    if (bestIdx != null) toggleIdx(bestIdx);
  }, [toggleIdx]);

  if (!sourceGeo || parts.length === 0) return null;

  const sw = Math.max(0.6, (viewBox?.w ?? 800) * 0.0025);
  // Small screen-relative padding so the click target hugs the visible piece
  // instead of a fixed large multiple (which overlaps neighbouring dashes when
  // zoomed in and makes selection feel imprecise).
  const hitPad = (viewBox?.w ?? 800) * 0.004;

  return (
    <g onClick={(e) => e.stopPropagation()}>
      {parts.map((part) => {
        const shape = partShape(part.geo);
        if (!shape) return null;
        const isSel = selected.has(part.idx);

        const common = {
          fill: isSel ? 'rgba(64, 192, 87, 0.30)' : 'rgba(66, 99, 235, 0.06)',
          stroke: isSel ? '#2f9e44' : '#4263eb',
          strokeWidth: isSel ? sw * 2 : sw,
          strokeDasharray: isSel ? undefined : `${sw * 3} ${sw * 2}`,
          pointerEvents: 'none',
        };

        // Tight hit target: the piece's own stroke width plus a small constant
        // pad. The actual selection is resolved by handleDown (nearest piece to
        // the cursor), so overlapping targets no longer cause mis-selection.
        const hitProps = {
          fill: '#000',
          fillOpacity: 0,
          stroke: '#000',
          strokeOpacity: 0,
          strokeWidth: (part.geo?.strokeWidth ?? sw) + hitPad,
          strokeLinecap: 'butt',
          strokeLinejoin: 'round',
          pointerEvents: 'all',
          style: { cursor: 'pointer' },
          onMouseDown: handleDown,
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
