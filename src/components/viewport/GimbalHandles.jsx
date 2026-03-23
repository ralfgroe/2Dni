import { useState, useCallback } from 'react';
import { useGraphStore } from '../../store/graphStore';

const HANDLE_SIZE = 8;
const HANDLE_COLOR = '#4263eb';
const HANDLE_FILL = '#ffffff';

export default function GimbalHandles({ geometry, node, definition, screenToSvg, viewBox }) {
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
  if (defId === 'transform') return renderTransformHandles(geometry, node, startDrag, viewBox);

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
    if (type === 'pivot') {
      updateNodeParams(nodeId, {
        pivot_x: Math.round((startParams.pivot_x || 0) + dx),
        pivot_y: Math.round((startParams.pivot_y || 0) + dy),
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

function renderTransformHandles(geo, node, startDrag, viewBox) {
  const px = node.data.params.pivot_x || 0;
  const py = node.data.params.pivot_y || 0;
  const scale = viewBox ? viewBox.w / 800 : 1;
  const arm = 20 * scale;
  const r = (HANDLE_SIZE / 2) * scale;
  const sw = 1.5 * scale;
  const b = geo.bounds;
  const pad = 4 * scale;
  return (
    <g>
      {/* Invisible hit area over geometry bounds for direct translate dragging */}
      {b && (
        <rect
          x={b.x - pad}
          y={b.y - pad}
          width={b.width + pad * 2}
          height={b.height + pad * 2}
          fill="transparent"
          stroke="none"
          cursor="move"
          onMouseDown={(e) => startDrag('translate', e)}
        />
      )}
      <line x1={px - arm} y1={py} x2={px + arm} y2={py} stroke={HANDLE_COLOR} strokeWidth={sw} />
      <line x1={px} y1={py - arm} x2={px} y2={py + arm} stroke={HANDLE_COLOR} strokeWidth={sw} />
      <circle
        cx={px}
        cy={py}
        r={r}
        fill={HANDLE_FILL}
        stroke={HANDLE_COLOR}
        strokeWidth={sw}
        cursor="move"
        onMouseDown={(e) => startDrag('pivot', e)}
      />
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
