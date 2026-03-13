import { useCallback, useMemo } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { extractPoints } from '../../utils/geometryPoints';

const HANDLE_R = 6;

export default function CornerPickOverlay({ geometry, nodeId }) {
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);
  const nodes = useGraphStore((s) => s.nodes);

  const node = nodes.find((n) => n.id === nodeId);
  if (!node || !geometry) return null;

  const allPoints = useMemo(() => extractPoints(geometry), [geometry]);
  const sharpPoints = useMemo(() => allPoints.filter((p) => p.sharp), [allPoints]);
  const totalSharp = sharpPoints.length;

  if (totalSharp === 0) return null;

  const sel = node.data.params.point_selection ?? '';
  const selected = parseSelection(sel, sharpPoints);

  const toggleCorner = useCallback(
    (originalIdx) => {
      const newSel = new Set(selected);
      if (newSel.has(originalIdx)) {
        newSel.delete(originalIdx);
      } else {
        newSel.add(originalIdx);
      }
      const allSharpIndices = new Set(sharpPoints.map((p) => p.idx));
      const allSelected = newSel.size === totalSharp && [...newSel].every((i) => allSharpIndices.has(i));
      const val = allSelected ? '*' : [...newSel].sort((a, b) => a - b).join(',');
      updateNodeParams(nodeId, { point_selection: val || '' });
    },
    [selected, totalSharp, sharpPoints, nodeId, updateNodeParams]
  );

  return (
    <g>
      {(geometry.type === 'rect' || geometry.type === 'roundedRect') && (
        <rect
          x={geometry.x || 0}
          y={geometry.y || 0}
          width={geometry.width}
          height={geometry.height}
          fill="none"
          stroke="#4263eb"
          strokeWidth={1}
          strokeDasharray="6 3"
          opacity={0.4}
          pointerEvents="none"
        />
      )}

      {geometry.type === 'booleanResult' && geometry.pathData && (
        <path
          d={geometry.pathData}
          fill="none"
          stroke="#4263eb"
          strokeWidth={1}
          strokeDasharray="6 3"
          opacity={0.4}
          pointerEvents="none"
        />
      )}

      {sharpPoints.map((pt) => {
        const isOn = selected.has(pt.idx);
        return (
          <g key={pt.idx} onClick={(e) => { e.stopPropagation(); toggleCorner(pt.idx); }} className="cursor-pointer">
            <circle
              cx={pt.x}
              cy={pt.y}
              r={HANDLE_R + 2}
              fill="none"
              stroke={isOn ? '#4263eb' : '#868e96'}
              strokeWidth={1}
              opacity={0.5}
            />
            <circle
              cx={pt.x}
              cy={pt.y}
              r={HANDLE_R}
              fill={isOn ? '#4263eb' : '#ffffff'}
              stroke={isOn ? '#3b5bdb' : '#adb5bd'}
              strokeWidth={1.5}
            />
            <text
              x={pt.x}
              y={pt.y + 0.5}
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={totalSharp > 20 ? 5 : 6}
              fontWeight="700"
              fill={isOn ? '#ffffff' : '#868e96'}
              pointerEvents="none"
            >
              {pt.idx}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function parseSelection(sel, sharpPoints) {
  if (sel === '*') {
    return new Set(sharpPoints.map((p) => p.idx));
  }
  const sharpIndices = new Set(sharpPoints.map((p) => p.idx));
  const result = new Set();
  const parts = sel.split(',').map((p) => p.trim()).filter(Boolean);
  for (const p of parts) {
    const idx = parseInt(p, 10);
    if (!isNaN(idx) && sharpIndices.has(idx)) result.add(idx);
  }
  return result;
}
