import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { RULER_SIZE, UNITS, getTickSpacing } from './Rulers';

const GUIDE_COLOR = '#06b6d4';
const HANDLE_SIZE = 18; // Reduced by 10% from 20

export default function GuidelineOverlay({
  guides,
  viewBox,
  svgRef,
  onUpdateGuide,
  onRemoveGuide,
  onToggleMagnetic,
  snapPoints = [],
  snapThreshold = 10,
  rulerUnit = 'px',
  viewportWidth = 800,
  viewportHeight = 600,
}) {
  const [hoveredGuide, setHoveredGuide] = useState(null);
  const [draggingGuide, setDraggingGuide] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [isExternalMouseDown, setIsExternalMouseDown] = useState(false);
  const mouseOverControlsRef = useRef(false);

  // Convert screen coordinates to world coordinates
  const screenToWorld = useCallback((clientX, clientY) => {
    const svg = svgRef?.current;
    if (!svg) return { x: 0, y: 0 };
    
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    
    const svgPoint = point.matrixTransform(ctm.inverse());
    return { x: svgPoint.x, y: svgPoint.y };
  }, [svgRef]);

  // Convert world coordinates to screen coordinates
  const worldToScreen = useCallback((worldX, worldY) => {
    const svg = svgRef?.current;
    if (!svg) return { x: 0, y: 0 };
    
    const point = svg.createSVGPoint();
    point.x = worldX;
    point.y = worldY;
    
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    
    const screenPoint = point.matrixTransform(ctm);
    return { x: screenPoint.x, y: screenPoint.y };
  }, [svgRef]);

  // Find nearest snap point (geometry control points)
  const findSnapPoint = useCallback((position, orientation) => {
    if (!snapPoints || snapPoints.length === 0) return null;
    
    // Use a percentage of viewport for snap threshold (same as ruler tick snap)
    const viewSize = orientation === 'horizontal' ? viewBox.h : viewBox.w;
    const dynamicThreshold = viewSize * 0.05; // 5% of viewport
    
    let nearest = null;
    let minDist = dynamicThreshold;
    
    for (const pt of snapPoints) {
      const coord = orientation === 'horizontal' ? pt.y : pt.x;
      const dist = Math.abs(coord - position);
      if (dist < minDist) {
        minDist = dist;
        nearest = coord;
      }
    }
    
    return nearest;
  }, [snapPoints, viewBox]);

  // Handle mouse move for dragging
  useEffect(() => {
    if (!draggingGuide) return;
    
    // Get the current magnetic state of the guide being dragged
    const currentGuide = guides.find(g => g.id === draggingGuide.id);
    const isMagnetic = currentGuide?.magnetic !== false;

    const handleMouseMove = (e) => {
      const world = screenToWorld(e.clientX, e.clientY);
      let newPosition = draggingGuide.orientation === 'horizontal' ? world.y : world.x;
      
      // Only apply snapping if the guideline is magnetic
      if (isMagnetic) {
        // FIRST PRINCIPLES:
        // For HORIZONTAL guideline: position is Y, snap to VerticalRuler ticks
        //   VerticalRuler uses: getTickSpacing(viewBox.h, viewportHeight - RULER_SIZE, unit)
        // For VERTICAL guideline: position is X, snap to HorizontalRuler ticks
        //   HorizontalRuler uses: getTickSpacing(viewBox.w, viewportWidth - RULER_SIZE, unit)
        
        const viewRange = draggingGuide.orientation === 'horizontal' ? viewBox.h : viewBox.w;
        const rulerPixelSize = draggingGuide.orientation === 'horizontal' 
          ? (viewportHeight - RULER_SIZE)
          : (viewportWidth - RULER_SIZE);
        
        const { step, unitScale } = getTickSpacing(viewRange, rulerPixelSize, rulerUnit);
        
        // Snap to nearest tick: position -> units -> round to step -> back to world
        const positionInUnits = newPosition / unitScale;
        const nearestTickUnit = Math.round(positionInUnits / step) * step;
        const snapTargetWorld = nearestTickUnit * unitScale;
        
        // Snap if within 40% of tick interval
        const tickIntervalWorld = step * unitScale;
        const snapThreshold = tickIntervalWorld * 0.4;
        
        if (Math.abs(newPosition - snapTargetWorld) < snapThreshold) {
          newPosition = snapTargetWorld;
        }
        
        // Also try to snap to geometry points (takes priority if closer) - only when magnetic
        const snapPos = findSnapPoint(newPosition, draggingGuide.orientation);
        if (snapPos !== null) {
          newPosition = snapPos;
        }
      }
      // When NOT magnetic, no snapping at all - guideline moves freely
      
      onUpdateGuide(draggingGuide.id, newPosition);
      setMousePos({ x: e.clientX, y: e.clientY });
    };

    const handleMouseUp = () => {
      setDraggingGuide(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingGuide, guides, screenToWorld, findSnapPoint, rulerUnit, viewBox, onUpdateGuide, viewportWidth, viewportHeight]);

  // Track mouse position for hover detection
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (draggingGuide) return;
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    
    const handleMouseDown = () => {
      // Only set external mouse down if NOT over our controls
      // This way, clicking on guideline controls doesn't trigger the "hide hover" behavior
      if (!mouseOverControlsRef.current) {
        setIsExternalMouseDown(true);
      }
    };
    
    const handleMouseUp = () => {
      setIsExternalMouseDown(false);
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingGuide]);

  // Check which guide is being hovered (with hysteresis)
  // Only show hover when mouse is NOT pressed (not dragging a shape)
  useEffect(() => {
    if (draggingGuide) return;
    
    // Don't show hover controls if mouse button is pressed externally (user is dragging a shape)
    // But allow hover if the mouse down was on our own controls
    if (isExternalMouseDown) {
      setHoveredGuide(null);
      return;
    }
    
    // Don't change hover state if mouse is over the control buttons
    if (mouseOverControlsRef.current) return;
    
    const world = screenToWorld(mousePos.x, mousePos.y);
    const svg = svgRef?.current;
    if (!svg) return;
    
    const svgRect = svg.getBoundingClientRect();
    // Check if mouse is within SVG bounds
    if (mousePos.x < svgRect.left || mousePos.x > svgRect.right ||
        mousePos.y < svgRect.top || mousePos.y > svgRect.bottom) {
      setHoveredGuide(null);
      return;
    }
    
    // Use different thresholds for entering vs exiting hover state (hysteresis)
    const enterThreshold = 8;  // pixels to enter hover
    const exitThreshold = 16;  // pixels to exit hover (larger = more cushion)
    
    const worldEnterThreshold = (viewBox.h / svgRect.height) * enterThreshold;
    const worldExitThreshold = (viewBox.h / svgRect.height) * exitThreshold;
    
    let found = null;
    for (const guide of guides) {
      const dist = guide.orientation === 'horizontal'
        ? Math.abs(world.y - guide.position)
        : Math.abs(world.x - guide.position);
      
      // Use larger threshold if already hovering this guide
      const threshold = (hoveredGuide?.id === guide.id) ? worldExitThreshold : worldEnterThreshold;
      
      if (dist < threshold) {
        found = guide;
        break;
      }
    }
    
    setHoveredGuide(found);
  }, [mousePos, guides, draggingGuide, isExternalMouseDown, screenToWorld, svgRef, viewBox, hoveredGuide]);

  const startDrag = useCallback((guide, e) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingGuide(guide);
  }, []);

  const deleteGuide = useCallback((guide, e) => {
    e.stopPropagation();
    e.preventDefault();
    // Reset the controls hover state so other guidelines can show their controls
    mouseOverControlsRef.current = false;
    onRemoveGuide(guide.id);
    setHoveredGuide(null);
  }, [onRemoveGuide]);

  const toggleMagnetic = useCallback((guide, e) => {
    e.stopPropagation();
    e.preventDefault();
    onToggleMagnetic(guide.id);
  }, [onToggleMagnetic]);

  // Render control buttons for a guide
  const renderControls = (guide) => {
    if (!hoveredGuide || hoveredGuide.id !== guide.id) return null;
    if (draggingGuide) return null;
    
    // Position controls at the center of the visible line
    const controlPos = guide.orientation === 'horizontal'
      ? worldToScreen(viewBox.x + viewBox.w * 0.5, guide.position)
      : worldToScreen(guide.position, viewBox.y + viewBox.h * 0.5);
    
    const isHorizontal = guide.orientation === 'horizontal';
    const isMagnetic = guide.magnetic !== false; // Default to true if not set
    
    // Calculate total width/height of controls to center them on the line (now 3 buttons)
    const totalControlsWidth = isHorizontal ? (HANDLE_SIZE * 3 + 4) : HANDLE_SIZE;
    const totalControlsHeight = isHorizontal ? HANDLE_SIZE : (HANDLE_SIZE * 3 + 4);
    
    // Center controls on the line
    const offsetX = -totalControlsWidth / 2;
    const offsetY = -totalControlsHeight / 2;
    
    return createPortal(
      <div
        key={`controls-${guide.id}`}
        onMouseEnter={() => { mouseOverControlsRef.current = true; }}
        onMouseLeave={() => { mouseOverControlsRef.current = false; }}
        style={{
          position: 'fixed',
          left: controlPos.x + offsetX,
          top: controlPos.y + offsetY,
          display: 'flex',
          flexDirection: isHorizontal ? 'row' : 'column',
          gap: 2,
          zIndex: 1000,
          pointerEvents: 'auto',
          animation: 'guideControlsFadeIn 0.15s ease-out',
          padding: 4,
          margin: -4,
        }}
      >
        <style>{`
          @keyframes guideControlsFadeIn {
            from { opacity: 0; transform: translateY(${isHorizontal ? '4px' : '0'}) translateX(${isHorizontal ? '0' : '4px'}); }
            to { opacity: 1; transform: translateY(0) translateX(0); }
          }
        `}</style>
        {/* Move handle */}
        <button
          onMouseDown={(e) => startDrag(guide, e)}
          style={{
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            border: '1px solid #06b6d4',
            borderRadius: 3,
            backgroundColor: 'white',
            cursor: isHorizontal ? 'ns-resize' : 'ew-resize',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
          title="Drag to move guideline"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#06b6d4" strokeWidth="1.5">
            {isHorizontal ? (
              <>
                <path d="M6 2L6 10" />
                <path d="M3 4L6 1L9 4" />
                <path d="M3 8L6 11L9 8" />
              </>
            ) : (
              <>
                <path d="M2 6L10 6" />
                <path d="M4 3L1 6L4 9" />
                <path d="M8 3L11 6L8 9" />
              </>
            )}
          </svg>
        </button>
        
        {/* Delete handle */}
        <button
          onClick={(e) => deleteGuide(guide, e)}
          style={{
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            border: '1px solid #ef4444',
            borderRadius: 3,
            backgroundColor: 'white',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
          title="Delete guideline"
        >
          <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="#ef4444" strokeWidth="1.5">
            <path d="M2 2L10 10M10 2L2 10" />
          </svg>
        </button>
        
        {/* Magnetic toggle */}
        <button
          onClick={(e) => toggleMagnetic(guide, e)}
          style={{
            width: HANDLE_SIZE,
            height: HANDLE_SIZE,
            border: '1px solid #f7931e',
            borderRadius: 3,
            backgroundColor: 'white',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          }}
          title={isMagnetic ? "Magnetic ON - click to disable" : "Magnetic OFF - click to enable"}
        >
          {/* Simple orange horseshoe magnet icon */}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ marginTop: -1 }}>
            {/* Outer horseshoe shape - orange when magnetic, gray when not */}
            <path 
              d="M4 20L4 10C4 5.6 7.6 2 12 2C16.4 2 20 5.6 20 10L20 20L16 20L16 10C16 7.8 14.2 6 12 6C9.8 6 8 7.8 8 10L8 20L4 20Z" 
              fill={isMagnetic ? '#f7931e' : '#9ca3af'}
            />
          </svg>
        </button>
      </div>,
      document.body
    );
  };

  return (
    <>
      {/* Render guidelines in SVG */}
      {guides.map((guide) => (
        <g key={guide.id}>
          {guide.orientation === 'horizontal' ? (
            <>
              {/* Invisible wider hit area for hover detection */}
              <line
                x1={viewBox.x - viewBox.w * 2}
                y1={guide.position}
                x2={viewBox.x + viewBox.w * 3}
                y2={guide.position}
                stroke="transparent"
                strokeWidth="10"
                style={{ cursor: 'pointer' }}
              />
              {/* Visible guideline */}
              <line
                x1={viewBox.x - viewBox.w * 2}
                y1={guide.position}
                x2={viewBox.x + viewBox.w * 3}
                y2={guide.position}
                stroke={GUIDE_COLOR}
                strokeWidth={hoveredGuide?.id === guide.id || draggingGuide?.id === guide.id ? "2" : "1"}
                vectorEffect="non-scaling-stroke"
                strokeDasharray="4 2"
                opacity={hoveredGuide?.id === guide.id || draggingGuide?.id === guide.id ? "1" : "0.8"}
                style={{ pointerEvents: 'none' }}
              />
            </>
          ) : (
            <>
              {/* Invisible wider hit area for hover detection */}
              <line
                x1={guide.position}
                y1={viewBox.y - viewBox.h * 2}
                x2={guide.position}
                y2={viewBox.y + viewBox.h * 3}
                stroke="transparent"
                strokeWidth="10"
                style={{ cursor: 'pointer' }}
              />
              {/* Visible guideline */}
              <line
                x1={guide.position}
                y1={viewBox.y - viewBox.h * 2}
                x2={guide.position}
                y2={viewBox.y + viewBox.h * 3}
                stroke={GUIDE_COLOR}
                strokeWidth={hoveredGuide?.id === guide.id || draggingGuide?.id === guide.id ? "2" : "1"}
                vectorEffect="non-scaling-stroke"
                strokeDasharray="4 2"
                opacity={hoveredGuide?.id === guide.id || draggingGuide?.id === guide.id ? "1" : "0.8"}
                style={{ pointerEvents: 'none' }}
              />
            </>
          )}
        </g>
      ))}
      
      {/* Render controls as HTML overlay via portal */}
      {guides.map((guide) => renderControls(guide))}
    </>
  );
}
