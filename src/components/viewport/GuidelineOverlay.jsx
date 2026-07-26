import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { RULER_SIZE, UNITS, getTickSpacing } from './Rulers';

const GUIDE_COLOR = '#06b6d4';
const HANDLE_SIZE = 18;

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
  const [hoveredGuideId, setHoveredGuideId] = useState(null);
  const [draggingGuide, setDraggingGuide] = useState(null);
  const controlsRef = useRef(null);

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
    
    const viewSize = orientation === 'horizontal' ? viewBox.h : viewBox.w;
    const dynamicThreshold = viewSize * 0.05;
    
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

  // Handle dragging
  useEffect(() => {
    if (!draggingGuide) return;
    
    const currentGuide = guides.find(g => g.id === draggingGuide.id);
    const isMagnetic = currentGuide?.magnetic !== false;

    const handleMouseMove = (e) => {
      const world = screenToWorld(e.clientX, e.clientY);
      let newPosition = draggingGuide.orientation === 'horizontal' ? world.y : world.x;
      
      if (isMagnetic) {
        const viewRange = draggingGuide.orientation === 'horizontal' ? viewBox.h : viewBox.w;
        const rulerPixelSize = draggingGuide.orientation === 'horizontal' 
          ? (viewportHeight - RULER_SIZE)
          : (viewportWidth - RULER_SIZE);
        
        const { step, unitScale } = getTickSpacing(viewRange, rulerPixelSize, rulerUnit);
        
        const positionInUnits = newPosition / unitScale;
        const nearestTickUnit = Math.round(positionInUnits / step) * step;
        const snapTargetWorld = nearestTickUnit * unitScale;
        
        const tickIntervalWorld = step * unitScale;
        const threshold = tickIntervalWorld * 0.4;
        
        if (Math.abs(newPosition - snapTargetWorld) < threshold) {
          newPosition = snapTargetWorld;
        }
        
        const snapPos = findSnapPoint(newPosition, draggingGuide.orientation);
        if (snapPos !== null) {
          newPosition = snapPos;
        }
      }
      
      onUpdateGuide(draggingGuide.id, newPosition);
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

  // Simple hover detection on mouse move
  useEffect(() => {
    const handleMouseMove = (e) => {
      // Don't update hover while dragging
      if (draggingGuide) return;
      
      // Check if mouse is over the controls - if so, don't change hover state
      if (controlsRef.current && controlsRef.current.contains(e.target)) {
        return;
      }
      
      const svg = svgRef?.current;
      if (!svg) return;
      
      const svgRect = svg.getBoundingClientRect();
      
      // If mouse is outside SVG, clear hover
      if (e.clientX < svgRect.left || e.clientX > svgRect.right ||
          e.clientY < svgRect.top || e.clientY > svgRect.bottom) {
        setHoveredGuideId(null);
        return;
      }
      
      const world = screenToWorld(e.clientX, e.clientY);
      const hoverThreshold = (viewBox.h / svgRect.height) * 12; // 12 pixels
      
      let foundId = null;
      for (const guide of guides) {
        const dist = guide.orientation === 'horizontal'
          ? Math.abs(world.y - guide.position)
          : Math.abs(world.x - guide.position);
        
        if (dist < hoverThreshold) {
          foundId = guide.id;
          break;
        }
      }
      
      setHoveredGuideId(foundId);
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [guides, draggingGuide, screenToWorld, svgRef, viewBox]);

  const startDrag = useCallback((guide, e) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingGuide(guide);
  }, []);

  const deleteGuide = useCallback((guide, e) => {
    e.stopPropagation();
    e.preventDefault();
    onRemoveGuide(guide.id);
    setHoveredGuideId(null);
  }, [onRemoveGuide]);

  const toggleMagnetic = useCallback((guide, e) => {
    e.stopPropagation();
    e.preventDefault();
    onToggleMagnetic(guide.id);
  }, [onToggleMagnetic]);

  // Render control buttons for a guide
  const renderControls = (guide) => {
    if (hoveredGuideId !== guide.id) return null;
    if (draggingGuide) return null;
    
    const controlPos = guide.orientation === 'horizontal'
      ? worldToScreen(viewBox.x + viewBox.w * 0.5, guide.position)
      : worldToScreen(guide.position, viewBox.y + viewBox.h * 0.5);
    
    const isHorizontal = guide.orientation === 'horizontal';
    const isMagnetic = guide.magnetic !== false;
    
    const totalControlsWidth = isHorizontal ? (HANDLE_SIZE * 3 + 4) : HANDLE_SIZE;
    const totalControlsHeight = isHorizontal ? HANDLE_SIZE : (HANDLE_SIZE * 3 + 4);
    
    const offsetX = -totalControlsWidth / 2;
    const offsetY = -totalControlsHeight / 2;
    
    return createPortal(
      <div
        key={`controls-${guide.id}`}
        ref={controlsRef}
        style={{
          position: 'fixed',
          left: controlPos.x + offsetX,
          top: controlPos.y + offsetY,
          display: 'flex',
          flexDirection: isHorizontal ? 'row' : 'column',
          gap: 2,
          zIndex: 1000,
          pointerEvents: 'auto',
          padding: 4,
          margin: -4,
        }}
      >
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
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" style={{ marginTop: -1 }}>
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
              <line
                x1={viewBox.x - viewBox.w * 2}
                y1={guide.position}
                x2={viewBox.x + viewBox.w * 3}
                y2={guide.position}
                stroke="transparent"
                strokeWidth="10"
                style={{ cursor: 'pointer' }}
              />
              <line
                x1={viewBox.x - viewBox.w * 2}
                y1={guide.position}
                x2={viewBox.x + viewBox.w * 3}
                y2={guide.position}
                stroke={GUIDE_COLOR}
                strokeWidth={hoveredGuideId === guide.id || draggingGuide?.id === guide.id ? "2" : "1"}
                vectorEffect="non-scaling-stroke"
                strokeDasharray="4 2"
                opacity={hoveredGuideId === guide.id || draggingGuide?.id === guide.id ? "1" : "0.8"}
                style={{ pointerEvents: 'none' }}
              />
            </>
          ) : (
            <>
              <line
                x1={guide.position}
                y1={viewBox.y - viewBox.h * 2}
                x2={guide.position}
                y2={viewBox.y + viewBox.h * 3}
                stroke="transparent"
                strokeWidth="10"
                style={{ cursor: 'pointer' }}
              />
              <line
                x1={guide.position}
                y1={viewBox.y - viewBox.h * 2}
                x2={guide.position}
                y2={viewBox.y + viewBox.h * 3}
                stroke={GUIDE_COLOR}
                strokeWidth={hoveredGuideId === guide.id || draggingGuide?.id === guide.id ? "2" : "1"}
                vectorEffect="non-scaling-stroke"
                strokeDasharray="4 2"
                opacity={hoveredGuideId === guide.id || draggingGuide?.id === guide.id ? "1" : "0.8"}
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
