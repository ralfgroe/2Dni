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
  const { step, pixelsPerUnit, unitScale } = getTickSpacing(viewBox.w, width, unit);
  
  // Store for debugging
  if (typeof window !== 'undefined') {
    window.__hrulerStep = step;
    window.__hrulerWidth = width;
    window.__hrulerViewBoxW = viewBox.w;
  }
  
  const startUnit = Math.floor(viewBox.x / unitScale / step) * step;
  const endUnit = Math.ceil((viewBox.x + viewBox.w) / unitScale / step) * step;
  
  const ticks = [];
  for (let u = startUnit; u <= endUnit; u += step) {
    const worldX = u * unitScale;
    const screenX = ((worldX - viewBox.x) / viewBox.w) * width;
    if (screenX >= 0 && screenX <= width) {
      ticks.push({ x: screenX, label: u, major: true });
    }
    
    const minorStep = step / 5;
    for (let m = 1; m < 5; m++) {
      const minorU = u + m * minorStep;
      const minorWorldX = minorU * unitScale;
      const minorScreenX = ((minorWorldX - viewBox.x) / viewBox.w) * width;
      if (minorScreenX >= 0 && minorScreenX <= width && minorScreenX < screenX + (step * pixelsPerUnit) - 5) {
        ticks.push({ x: minorScreenX, label: null, major: false });
      }
    }
  }

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
  const { step, pixelsPerUnit, unitScale } = getTickSpacing(viewBox.h, height, unit);
  
  // Store for debugging
  if (typeof window !== 'undefined') {
    window.__vrulerStep = step;
    window.__vrulerHeight = height;
    window.__vrulerViewBoxH = viewBox.h;
  }
  
  const startUnit = Math.floor(viewBox.y / unitScale / step) * step;
  const endUnit = Math.ceil((viewBox.y + viewBox.h) / unitScale / step) * step;
  
  const ticks = [];
  for (let u = startUnit; u <= endUnit; u += step) {
    const worldY = u * unitScale;
    const screenY = ((worldY - viewBox.y) / viewBox.h) * height;
    if (screenY >= 0 && screenY <= height) {
      ticks.push({ y: screenY, label: u, major: true });
    }
    
    const minorStep = step / 5;
    for (let m = 1; m < 5; m++) {
      const minorU = u + m * minorStep;
      const minorWorldY = minorU * unitScale;
      const minorScreenY = ((minorWorldY - viewBox.y) / viewBox.h) * height;
      if (minorScreenY >= 0 && minorScreenY <= height && minorScreenY < screenY + (step * pixelsPerUnit) - 5) {
        ticks.push({ y: minorScreenY, label: null, major: false });
      }
    }
  }

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
        overflow: 'visible',
        userSelect: 'none',
        zIndex: 10,
        cursor: 'ew-resize',
      }}
      title="Drag to create vertical guideline"
    >
      <svg width={RULER_SIZE} height="100%" style={{ pointerEvents: 'none', overflow: 'visible' }}>
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
                x={RULER_SIZE - 12}
                y={tick.y + 3}
                fontSize={9}
                fill={TEXT_COLOR}
                textAnchor="end"
                dominantBaseline="middle"
                transform={`rotate(-90, ${RULER_SIZE - 12}, ${tick.y + 3})`}
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
  geometrySnapPoints = [],
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
      magnetic: true, // Guidelines are magnetic by default
    };
    
    onAddGuide?.(newGuide);
    setDragging({ id: newGuide.id, orientation });
  }, [screenToWorld, onAddGuide]);

  useEffect(() => {
    if (!dragging) return;

    const handleMouseMove = (e) => {
      const { worldX, worldY } = screenToWorld(e.clientX, e.clientY);
      let position = dragging.orientation === 'horizontal' ? worldY : worldX;
      
      // FIRST PRINCIPLES REDESIGN:
      // 
      // For a HORIZONTAL guideline (line goes left-right, dragged from TOP ruler):
      //   - The guideline's position is a Y coordinate (world units)
      //   - It should snap to the VERTICAL ruler's tick marks
      //   - VerticalRuler receives (height - RULER_SIZE) as its height prop
      //   - VerticalRuler uses: getTickSpacing(viewBox.h, height, unit) where height = parent's (height - RULER_SIZE)
      //
      // For a VERTICAL guideline (line goes up-down, dragged from LEFT ruler):
      //   - The guideline's position is an X coordinate (world units)  
      //   - It should snap to the HORIZONTAL ruler's tick marks
      //   - HorizontalRuler receives (width - RULER_SIZE) as its width prop
      //   - HorizontalRuler uses: getTickSpacing(viewBox.w, width, unit) where width = parent's (width - RULER_SIZE)
      //
      // So we need to use (height - RULER_SIZE) and (width - RULER_SIZE) to match what the rulers receive
      
      const viewRange = dragging.orientation === 'horizontal' ? viewBox.h : viewBox.w;
      const rulerPixelSize = dragging.orientation === 'horizontal' 
        ? (height - RULER_SIZE)
        : (width - RULER_SIZE);
      
      const { step, unitScale } = getTickSpacing(viewRange, rulerPixelSize, unit);
      
      // Store snap step for debugging
      if (typeof window !== 'undefined') {
        window.__snapStep = step;
        window.__snapRulerPixelSize = rulerPixelSize;
        window.__snapViewRange = viewRange;
        window.__snapOrientation = dragging.orientation;
      }
      
      // The ruler displays ticks at: ..., -2*step, -step, 0, step, 2*step, ... (in units)
      // World position of each tick is: tickUnit * unitScale
      // So we need to snap `position` to the nearest (N * step * unitScale)
      
      const positionInUnits = position / unitScale;
      const nearestTickUnit = Math.round(positionInUnits / step) * step;
      const snapTargetWorld = nearestTickUnit * unitScale;
      
      // ALWAYS snap to ruler tick - this is the primary snap behavior
      position = snapTargetWorld;
      
      // NOTE: We intentionally do NOT snap to geometry points when dragging from rulers.
      // The ruler tick snap is the expected behavior. Geometry snapping is only for
      // when the user drags an existing guideline via its controls (handled in GuidelineOverlay).
      
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
  }, [dragging, screenToWorld, svgRef, onUpdateGuide, onRemoveGuide, unit, viewBox, width, height, geometrySnapPoints]);

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

export { RULER_SIZE, UNITS, GUIDE_COLOR, getTickSpacing };
