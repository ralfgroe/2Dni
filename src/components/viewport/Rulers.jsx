import { useMemo, useState, useCallback, useEffect } from 'react';

const RULER_SIZE = 20;
const TICK_COLOR = '#94a3b8';
const TEXT_COLOR = '#64748b';
const BG_COLOR = '#f8fafc';
const BORDER_COLOR = '#e2e8f0';
const GUIDE_COLOR = '#06b6d4';

const UNITS = {
  px: { label: 'px', scale: 1 },
  mm: { label: 'mm', scale: 3.7795275591 },
  cm: { label: 'cm', scale: 37.795275591 },
  in: { label: 'in', scale: 96 },
};

function getTickSpacing(viewRange, availablePixels, unit) {
  const unitScale = UNITS[unit]?.scale || 1;
  const unitsVisible = viewRange / unitScale;
  const pixelsPerUnit = availablePixels / unitsVisible;
  
  const niceSteps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  const targetTickCount = availablePixels / 50;
  const idealStep = unitsVisible / targetTickCount;
  
  let step = niceSteps[0];
  for (const s of niceSteps) {
    if (s >= idealStep) {
      step = s;
      break;
    }
    step = s;
  }
  
  return { step, pixelsPerUnit, unitScale };
}

function HorizontalRuler({ viewBox, width, unit = 'px', onStartDrag }) {
  const ticks = useMemo(() => {
    const { step, pixelsPerUnit, unitScale } = getTickSpacing(viewBox.w, width, unit);
    const startUnit = Math.floor(viewBox.x / unitScale / step) * step;
    const endUnit = Math.ceil((viewBox.x + viewBox.w) / unitScale / step) * step;
    
    const result = [];
    for (let u = startUnit; u <= endUnit; u += step) {
      const worldX = u * unitScale;
      const screenX = ((worldX - viewBox.x) / viewBox.w) * width;
      if (screenX >= 0 && screenX <= width) {
        result.push({ x: screenX, label: u, major: true });
      }
      
      const minorStep = step / 5;
      for (let m = 1; m < 5; m++) {
        const minorU = u + m * minorStep;
        const minorWorldX = minorU * unitScale;
        const minorScreenX = ((minorWorldX - viewBox.x) / viewBox.w) * width;
        if (minorScreenX >= 0 && minorScreenX <= width && minorScreenX < screenX + (step * pixelsPerUnit) - 5) {
          result.push({ x: minorScreenX, label: null, major: false });
        }
      }
    }
    return result;
  }, [viewBox, width, unit]);

  const handleMouseDown = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const screenX = e.clientX - rect.left;
    const worldY = viewBox.y + viewBox.h / 2;
    onStartDrag?.('horizontal', screenX, worldY, e);
  }, [viewBox, onStartDrag]);

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        position: 'absolute',
        top: 0,
        left: RULER_SIZE,
        right: 0,
        height: RULER_SIZE,
        backgroundColor: BG_COLOR,
        borderBottom: `1px solid ${BORDER_COLOR}`,
        overflow: 'hidden',
        userSelect: 'none',
        zIndex: 10,
        cursor: 'ns-resize',
      }}
      title="Drag to create horizontal guideline"
    >
      <svg width="100%" height={RULER_SIZE} style={{ pointerEvents: 'none' }}>
        {ticks.map((tick, i) => (
          <g key={i}>
            <line
              x1={tick.x}
              y1={tick.major ? RULER_SIZE - 10 : RULER_SIZE - 5}
              x2={tick.x}
              y2={RULER_SIZE}
              stroke={TICK_COLOR}
              strokeWidth={tick.major ? 1 : 0.5}
            />
            {tick.major && tick.label !== null && (
              <text
                x={tick.x + 3}
                y={RULER_SIZE - 12}
                fontSize={9}
                fill={TEXT_COLOR}
              >
                {tick.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function VerticalRuler({ viewBox, height, unit = 'px', onStartDrag }) {
  const ticks = useMemo(() => {
    const { step, pixelsPerUnit, unitScale } = getTickSpacing(viewBox.h, height, unit);
    const startUnit = Math.floor(viewBox.y / unitScale / step) * step;
    const endUnit = Math.ceil((viewBox.y + viewBox.h) / unitScale / step) * step;
    
    const result = [];
    for (let u = startUnit; u <= endUnit; u += step) {
      const worldY = u * unitScale;
      const screenY = ((worldY - viewBox.y) / viewBox.h) * height;
      if (screenY >= 0 && screenY <= height) {
        result.push({ y: screenY, label: u, major: true });
      }
      
      const minorStep = step / 5;
      for (let m = 1; m < 5; m++) {
        const minorU = u + m * minorStep;
        const minorWorldY = minorU * unitScale;
        const minorScreenY = ((minorWorldY - viewBox.y) / viewBox.h) * height;
        if (minorScreenY >= 0 && minorScreenY <= height && minorScreenY < screenY + (step * pixelsPerUnit) - 5) {
          result.push({ y: minorScreenY, label: null, major: false });
        }
      }
    }
    return result;
  }, [viewBox, height, unit]);

  const handleMouseDown = useCallback((e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const screenY = e.clientY - rect.top;
    const worldX = viewBox.x + viewBox.w / 2;
    onStartDrag?.('vertical', worldX, screenY, e);
  }, [viewBox, onStartDrag]);

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        position: 'absolute',
        top: RULER_SIZE,
        left: 0,
        width: RULER_SIZE,
        bottom: 0,
        backgroundColor: BG_COLOR,
        borderRight: `1px solid ${BORDER_COLOR}`,
        overflow: 'hidden',
        userSelect: 'none',
        zIndex: 10,
        cursor: 'ew-resize',
      }}
      title="Drag to create vertical guideline"
    >
      <svg width={RULER_SIZE} height="100%" style={{ pointerEvents: 'none' }}>
        {ticks.map((tick, i) => (
          <g key={i}>
            <line
              x1={tick.major ? RULER_SIZE - 10 : RULER_SIZE - 5}
              y1={tick.y}
              x2={RULER_SIZE}
              y2={tick.y}
              stroke={TICK_COLOR}
              strokeWidth={tick.major ? 1 : 0.5}
            />
            {tick.major && tick.label !== null && (
              <text
                x={2}
                y={tick.y + 3}
                fontSize={9}
                fill={TEXT_COLOR}
                transform={`rotate(-90, 2, ${tick.y + 3})`}
              >
                {tick.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function CornerBox({ unit, onUnitChange, onClearGuides, hasGuides }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: RULER_SIZE,
        height: RULER_SIZE,
        backgroundColor: BG_COLOR,
        borderRight: `1px solid ${BORDER_COLOR}`,
        borderBottom: `1px solid ${BORDER_COLOR}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        zIndex: 12,
      }}
      onClick={onUnitChange}
      onDoubleClick={hasGuides ? onClearGuides : undefined}
      title={`Units: ${UNITS[unit]?.label || 'px'} (click to change${hasGuides ? ', double-click to clear guides' : ''})`}
    >
      <span style={{ fontSize: 8, color: TEXT_COLOR, fontWeight: 500 }}>
        {UNITS[unit]?.label || 'px'}
      </span>
    </div>
  );
}

export default function Rulers({ 
  viewBox, 
  width, 
  height, 
  unit = 'px', 
  onUnitChange,
  guides = [],
  onAddGuide,
  onUpdateGuide,
  onRemoveGuide,
  onClearGuides,
  svgRef,
}) {
  const [dragging, setDragging] = useState(null);

  // Convert screen coordinates to world coordinates using SVG's coordinate system
  const screenToWorld = useCallback((clientX, clientY) => {
    const svg = svgRef?.current;
    if (!svg) {
      return { worldX: viewBox.x, worldY: viewBox.y };
    }
    
    // Use SVG's built-in coordinate transformation
    // This correctly handles preserveAspectRatio and any transforms
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    
    // Get the inverse of the screen-to-SVG transformation matrix
    const ctm = svg.getScreenCTM();
    if (!ctm) {
      return { worldX: viewBox.x, worldY: viewBox.y };
    }
    
    const svgPoint = point.matrixTransform(ctm.inverse());
    
    return { worldX: svgPoint.x, worldY: svgPoint.y };
  }, [svgRef, viewBox]);

  const handleStartDrag = useCallback((orientation, screenX, screenY, e) => {
    e.preventDefault();
    
    const { worldX, worldY } = screenToWorld(e.clientX, e.clientY);
    
    const newGuide = {
      id: Date.now(),
      orientation,
      position: orientation === 'horizontal' ? worldY : worldX,
    };
    
    onAddGuide?.(newGuide);
    setDragging({ id: newGuide.id, orientation });
  }, [screenToWorld, onAddGuide]);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e) => {
      const { worldX, worldY } = screenToWorld(e.clientX, e.clientY);
      const position = dragging.orientation === 'horizontal' ? worldY : worldX;
      onUpdateGuide?.(dragging.id, position);
    };

    const handleMouseUp = (e) => {
      const svg = svgRef?.current;
      if (svg) {
        const svgRect = svg.getBoundingClientRect();
        // Check if released over the ruler area (outside SVG bounds toward the rulers)
        const isOverRuler = dragging.orientation === 'horizontal'
          ? e.clientY < svgRect.top
          : e.clientX < svgRect.left;
        
        if (isOverRuler) {
          onRemoveGuide?.(dragging.id);
        }
      }
      
      setDragging(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragging, screenToWorld, svgRef, onUpdateGuide, onRemoveGuide]);

  return (
    <>
      <CornerBox 
        unit={unit} 
        onUnitChange={onUnitChange} 
        onClearGuides={onClearGuides}
        hasGuides={guides.length > 0}
      />
      <HorizontalRuler 
        viewBox={viewBox} 
        width={width - RULER_SIZE} 
        unit={unit} 
        onStartDrag={handleStartDrag}
      />
      <VerticalRuler 
        viewBox={viewBox} 
        height={height - RULER_SIZE} 
        unit={unit}
        onStartDrag={handleStartDrag}
      />
    </>
  );
}

export { RULER_SIZE, UNITS, GUIDE_COLOR };
