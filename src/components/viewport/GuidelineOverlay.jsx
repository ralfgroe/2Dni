import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

const GUIDE_COLOR = '#06b6d4';
const HANDLE_SIZE = 20;

export default function GuidelineOverlay({
  guides,
  viewBox,
  svgRef,
  onUpdateGuide,
  onRemoveGuide,
  snapPoints = [],
  snapThreshold = 10,
}) {
  const [hoveredGuide, setHoveredGuide] = useState(null);
  const [draggingGuide, setDraggingGuide] = useState(null);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

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

  // Find nearest snap point
  const findSnapPoint = useCallback((position, orientation) => {
    if (!snapPoints || snapPoints.length === 0) return null;
    
    let nearest = null;
    let minDist = snapThreshold;
    
    for (const pt of snapPoints) {
      const coord = orientation === 'horizontal' ? pt.y : pt.x;
      const dist = Math.abs(coord - position);
      if (dist < minDist) {
        minDist = dist;
        nearest = coord;
      }
    }
    
    return nearest;
  }, [snapPoints, snapThreshold]);

  // Handle mouse move for dragging
  useEffect(() => {
    if (!draggingGuide) return;

    const handleMouseMove = (e) => {
      const world = screenToWorld(e.clientX, e.clientY);
      let newPosition = draggingGuide.orientation === 'horizontal' ? world.y : world.x;
      
      // Try to snap to geometry points
      const snapPos = findSnapPoint(newPosition, draggingGuide.orientation);
      if (snapPos !== null) {
        newPosition = snapPos;
      }
      
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
  }, [draggingGuide, screenToWorld, findSnapPoint, onUpdateGuide]);

  // Track mouse position for hover detection
  useEffect(() => {
    const handleMouseMove = (e) => {
      if (draggingGuide) return;
      setMousePos({ x: e.clientX, y: e.clientY });
    };
    
    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, [draggingGuide]);

  // Check which guide is being hovered
  useEffect(() => {
    if (draggingGuide) return;
    
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
    
    const hoverThreshold = 8;
    const worldThreshold = (viewBox.h / svgRect.height) * hoverThreshold;
    
    let found = null;
    for (const guide of guides) {
      const dist = guide.orientation === 'horizontal'
        ? Math.abs(world.y - guide.position)
        : Math.abs(world.x - guide.position);
      
      if (dist < worldThreshold) {
        found = guide;
        break;
      }
    }
    
    setHoveredGuide(found);
  }, [mousePos, guides, draggingGuide, screenToWorld, svgRef, viewBox]);

  const startDrag = useCallback((guide, e) => {
    e.stopPropagation();
    e.preventDefault();
    setDraggingGuide(guide);
  }, []);

  const deleteGuide = useCallback((guide, e) => {
    e.stopPropagation();
    e.preventDefault();
    onRemoveGuide(guide.id);
    setHoveredGuide(null);
  }, [onRemoveGuide]);

  // Render control buttons for a guide
  const renderControls = (guide) => {
    if (!hoveredGuide || hoveredGuide.id !== guide.id) return null;
    if (draggingGuide) return null;
    
    // Position controls at a fixed spot along the guide (near left/top edge of visible area)
    const controlPos = guide.orientation === 'horizontal'
      ? worldToScreen(viewBox.x + viewBox.w * 0.05, guide.position)
      : worldToScreen(guide.position, viewBox.y + viewBox.h * 0.05);
    
    const isHorizontal = guide.orientation === 'horizontal';
    
    return createPortal(
      <div
        key={`controls-${guide.id}`}
        style={{
          position: 'fixed',
          left: controlPos.x - (isHorizontal ? 0 : HANDLE_SIZE),
          top: controlPos.y - (isHorizontal ? HANDLE_SIZE - 2 : 0),
          display: 'flex',
          flexDirection: isHorizontal ? 'row' : 'column',
          gap: 2,
          zIndex: 1000,
          pointerEvents: 'auto',
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
          }}
          title="Drag to move guideline"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#06b6d4" strokeWidth="1.5">
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
          }}
          title="Delete guideline"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="#ef4444" strokeWidth="1.5">
            <path d="M2 2L10 10M10 2L2 10" />
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
                x1={viewBox.x - viewBox.w}
                y1={guide.position}
                x2={viewBox.x + viewBox.w * 2}
                y2={guide.position}
                stroke="transparent"
                strokeWidth="10"
                style={{ cursor: 'pointer' }}
              />
              {/* Visible guideline */}
              <line
                x1={viewBox.x - viewBox.w}
                y1={guide.position}
                x2={viewBox.x + viewBox.w * 2}
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
                y1={viewBox.y - viewBox.h}
                x2={guide.position}
                y2={viewBox.y + viewBox.h * 2}
                stroke="transparent"
                strokeWidth="10"
                style={{ cursor: 'pointer' }}
              />
              {/* Visible guideline */}
              <line
                x1={guide.position}
                y1={viewBox.y - viewBox.h}
                x2={guide.position}
                y2={viewBox.y + viewBox.h * 2}
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
