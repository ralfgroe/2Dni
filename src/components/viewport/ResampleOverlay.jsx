import { useMemo } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { computeResampledSubpaths } from '../../nodes/resample';

// Visual reference overlay for the Resample node. Draws the control points that
// the node distributes along the input geometry so you can see point density
// before feeding it into a Noise Deform (or similar) node.
export default function ResampleOverlay({ nodeId, edges, results, viewBox }) {
  const nodes = useGraphStore((s) => s.nodes);
  const node = nodes.find((n) => n.id === nodeId);
  const params = node?.data?.params || {};

  const sourceEdge = edges.find((e) => e.target === nodeId && e.targetHandle === 'geometry_in');
  const sourceGeoRaw = sourceEdge ? results.get(sourceEdge.source) : null;
  const sourceGeo = sourceGeoRaw && sourceGeoRaw.__multiOutput && sourceEdge?.sourceHandle
    ? sourceGeoRaw[sourceEdge.sourceHandle]
    : sourceGeoRaw;

  const segmentLength = params.segment_length;
  const keepCorners = params.keep_corners;
  const maxPoints = params.max_points;

  const subpaths = useMemo(
    () =>
      sourceGeo
        ? computeResampledSubpaths(sourceGeo, {
            segment_length: segmentLength,
            keep_corners: keepCorners,
            max_points: maxPoints,
          })
        : [],
    [sourceGeo, segmentLength, keepCorners, maxPoints]
  );

  if (!sourceGeo || subpaths.length === 0) return null;

  // Size points relative to the current zoom so they stay readable.
  const r = Math.max(0.8, (viewBox?.w ?? 800) * 0.005);
  const total = subpaths.reduce((sum, sp) => sum + sp.points.length, 0);

  return (
    <g style={{ pointerEvents: 'none' }}>
      {subpaths.map((sp, si) =>
        sp.points.map((pt, pi) => (
          <circle
            key={`${si}_${pi}`}
            cx={pt.x}
            cy={pt.y}
            r={r}
            fill={pt.original ? '#4263eb' : '#ffffff'}
            stroke={pt.original ? '#4263eb' : '#e64980'}
            strokeWidth={r * 0.4}
          />
        ))
      )}
      {subpaths[0]?.points[0] && (
        <text
          x={subpaths[0].points[0].x}
          y={subpaths[0].points[0].y - r * 3}
          fill="#e64980"
          fontSize={r * 4}
          textAnchor="middle"
        >
          {total} pts
        </text>
      )}
    </g>
  );
}
