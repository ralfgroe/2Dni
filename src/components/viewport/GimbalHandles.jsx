import { useState, useCallback } from 'react';
import { useGraphStore } from '../../store/graphStore';

const HANDLE_SIZE = 8;
const HANDLE_COLOR = '#4263eb';
const HANDLE_FILL = '#ffffff';

export default function GimbalHandles({ geometry, node, definition, screenToSvg }) {
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);
  const [dragging, setDragging] = useState(null);

  const defId = definition.id;

  const startDrag = useCallback((type, e) => {
    e.stopPropagation();
    setDragging({ type, startX: e.clientX, startY: e.clientY, startParams: { ...node.data.params } });
    useGraphStore.getState().beginOperation();

    const handleMove = (me) => {
      setDragging((prev) => {
        if (!prev) return null;
        const svgStart = screenToSvg(prev.startX, prev.startY);
        const svgCurrent = screenToSvg(me.clientX, me.clientY);
        const dx = svgCurrent.x - svgStart.x;
        const dy = svgCurrent.y - svgStart.y;
        applyDrag(prev.type, dx, dy, prev.startParams, node.id, defId, updateNodeParams);
        return prev;
      });
    };

    const handleUp = () => {
      setDragging(null);
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      useGraphStore.getState().endOperation();
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  }, [node, defId, screenToSvg, updateNodeParams]);

  if (!geometry) return null;

  if (defId === 'line') return renderLineHandles(geometry, startDrag);
  if (defId === 'rectangle') return renderRectHandles(geometry, startDrag);
  if (defId === 'transform') return renderTransformHandles(geometry, node, startDrag);

  return renderBoundsHandles(geometry, startDrag);
}

function applyDrag(type, dx, dy, startParams, nodeId, defId, updateNodeParams) {
  if (defId === 'line') {
    if (type === 'endpoint') {
      const startLen = startParams.length || 200;
      const startAngle = (startParams.angle || 0) * Math.PI / 180;
      const ex = startLen * Math.cos(startAngle) + dx;
      const ey = startLen * Math.sin(startAngle) + dy;
      const newLen = Math.max(1, Math.sqrt(ex * ex + ey * ey));
      const newAngle = (Math.atan2(ey, ex) * 180) / Math.PI;
      updateNodeParams(nodeId, { length: Math.round(newLen), angle: Math.round(newAngle * 10) / 10 });
    }
  } else if (defId === 'rectangle') {
    if (type === 'move') {
      updateNodeParams(nodeId, {
        x: Math.round(startParams.x + dx),
        y: Math.round(startParams.y + dy),
      });
    } else if (type === 'resize-br') {
      updateNodeParams(nodeId, {
        width: Math.max(1, Math.round(startParams.width + dx)),
        height: Math.max(1, Math.round(startParams.height + dy)),
      });
    } else if (type === 'resize-r') {
      updateNodeParams(nodeId, {
        width: Math.max(1, Math.round(startParams.width + dx)),
      });
    } else if (type === 'resize-b') {
      updateNodeParams(nodeId, {
        height: Math.max(1, Math.round(startParams.height + dy)),
      });
    }
  } else if (defId === 'transform') {
    if (type === 'translate') {
      updateNodeParams(nodeId, {
        translate_x: Math.round(startParams.translate_x + dx),
        translate_y: Math.round(startParams.translate_y + dy),
      });
    }
  } else {
    if (type === 'move') {
      if (startParams.x !== undefined) {
        updateNodeParams(nodeId, {
          x: Math.round((startParams.x || 0) + dx),
          y: Math.round((startParams.y || 0) + dy),
        });
      }
    }
  }
}

function Handle({ x, y, cursor, onMouseDown }) {
  return (
    <rect
      x={x - HANDLE_SIZE / 2}
      y={y - HANDLE_SIZE / 2}
      width={HANDLE_SIZE}
      height={HANDLE_SIZE}
      fill={HANDLE_FILL}
      stroke={HANDLE_COLOR}
      strokeWidth={1.5}
      rx={2}
      cursor={cursor}
      onMouseDown={onMouseDown}
    />
  );
}

function CircleHandle({ cx, cy, cursor, onMouseDown }) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r={HANDLE_SIZE / 2}
      fill={HANDLE_FILL}
      stroke={HANDLE_COLOR}
      strokeWidth={1.5}
      cursor={cursor}
      onMouseDown={onMouseDown}
    />
  );
}

function renderLineHandles(geo, startDrag) {
  return (
    <g>
      <CircleHandle cx={geo.x1} cy={geo.y1} cursor="crosshair" onMouseDown={(e) => startDrag('origin', e)} />
      <CircleHandle cx={geo.x2} cy={geo.y2} cursor="crosshair" onMouseDown={(e) => startDrag('endpoint', e)} />
    </g>
  );
}

function renderRectHandles(geo, startDrag) {
  const { x, y, width, height } = geo;
  return (
    <g>
      {/* Move handle (top-left) */}
      <Handle x={x} y={y} cursor="move" onMouseDown={(e) => startDrag('move', e)} />
      {/* Right edge */}
      <Handle x={x + width} y={y + height / 2} cursor="ew-resize" onMouseDown={(e) => startDrag('resize-r', e)} />
      {/* Bottom edge */}
      <Handle x={x + width / 2} y={y + height} cursor="ns-resize" onMouseDown={(e) => startDrag('resize-b', e)} />
      {/* Bottom-right corner */}
      <Handle x={x + width} y={y + height} cursor="nwse-resize" onMouseDown={(e) => startDrag('resize-br', e)} />
    </g>
  );
}

function renderTransformHandles(geo, node, startDrag) {
  const tx = node.data.params.translate_x || 0;
  const ty = node.data.params.translate_y || 0;
  return (
    <g>
      {/* Translate crosshair */}
      <line x1={tx - 15} y1={ty} x2={tx + 15} y2={ty} stroke={HANDLE_COLOR} strokeWidth={1} />
      <line x1={tx} y1={ty - 15} x2={tx} y2={ty + 15} stroke={HANDLE_COLOR} strokeWidth={1} />
      <CircleHandle cx={tx} cy={ty} cursor="move" onMouseDown={(e) => startDrag('translate', e)} />
    </g>
  );
}

function renderBoundsHandles(geo, startDrag) {
  if (!geo.bounds) return null;
  const { x, y } = geo.bounds;
  return (
    <g>
      <Handle x={x} y={y} cursor="move" onMouseDown={(e) => startDrag('move', e)} />
    </g>
  );
}
