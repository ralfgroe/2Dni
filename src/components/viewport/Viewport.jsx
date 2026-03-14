import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { useNodeRegistryStore } from '../../store/nodeRegistryStore';
import { useViewportStore } from '../../store/viewportStore';
import { evaluateGraph } from '../../utils/evaluateGraph';
import { renderGeometry } from '../../utils/svgRenderer';
import GimbalHandles from './GimbalHandles';
import CornerPickOverlay from './CornerPickOverlay';
import FreeCurveOverlay from './FreeCurveOverlay';
import BezierOverlay from './BezierOverlay';

export default function Viewport() {
  const svgRef = useRef(null);
  const [viewBox, setViewBox] = useState({ x: -400, y: -300, w: 800, h: 600 });
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef({ active: false, x: 0, y: 0 });
  const [showGrid, setShowGrid] = useState(true);
  const [fontVersion, setFontVersion] = useState(0);

  useEffect(() => {
    const handler = () => setFontVersion((v) => v + 1);
    window.addEventListener('font-loaded', handler);
    return () => window.removeEventListener('font-loaded', handler);
  }, []);

  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const displayNodeId = useGraphStore((s) => s.displayNodeId);
  const selectNode = useGraphStore((s) => s.selectNode);
  const definitions = useNodeRegistryStore((s) => s.definitions);

  const results = useMemo(
    () => evaluateGraph(nodes, edges, definitions, displayNodeId),
    [nodes, edges, definitions, displayNodeId, fontVersion]
  );

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedGeo = selectedNodeId ? results.get(selectedNodeId) : null;
  const selectedDef = selectedNode
    ? definitions[selectedNode.data.definitionId]
    : null;

  const screenToSvg = useCallback(
    (clientX, clientY) => {
      const svg = svgRef.current;
      if (!svg) return { x: 0, y: 0 };
      const ctm = svg.getScreenCTM();
      if (!ctm) return { x: 0, y: 0 };
      const inv = ctm.inverse();
      return {
        x: inv.a * clientX + inv.c * clientY + inv.e,
        y: inv.b * clientX + inv.d * clientY + inv.f,
      };
    },
    [viewBox]
  );

  const handleMouseDown = useCallback(
    (e) => {
      if (e.button === 1 || (e.button === 0 && e.altKey)) {
        e.preventDefault();
        e.stopPropagation();
        panRef.current = { active: true, x: e.clientX, y: e.clientY };
        setIsPanning(true);
      }
    },
    []
  );

  const handleMouseMove = useCallback(
    (e) => {
      if (!panRef.current.active) return;
      const svg = svgRef.current;
      if (!svg) return;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const scale = ctm.a;
      const dx = (e.clientX - panRef.current.x) / scale;
      const dy = (e.clientY - panRef.current.y) / scale;
      panRef.current.x = e.clientX;
      panRef.current.y = e.clientY;
      setViewBox((v) => ({ ...v, x: v.x - dx, y: v.y - dy }));
    },
    []
  );

  const handleMouseUp = useCallback(() => {
    panRef.current.active = false;
    setIsPanning(false);
  }, []);

  const handleWheel = useCallback(
    (e) => {
      e.preventDefault();
      const zoomFactor = e.deltaY > 0 ? 1.1 : 0.9;
      const svg = svgRef.current;
      if (!svg) return;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;
      const inv = ctm.inverse();
      const mx = inv.a * e.clientX + inv.c * e.clientY + inv.e;
      const my = inv.b * e.clientX + inv.d * e.clientY + inv.f;
      const newW = viewBox.w * zoomFactor;
      const newH = viewBox.h * zoomFactor;
      setViewBox({
        x: mx - (mx - viewBox.x) * zoomFactor,
        y: my - (my - viewBox.y) * zoomFactor,
        w: newW,
        h: newH,
      });
    },
    [viewBox]
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onDown = (e) => {
      if (e.button === 1) {
        e.preventDefault();
        handleMouseDown(e);
      }
    };
    svg.addEventListener('mousedown', onDown);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      svg.removeEventListener('mousedown', onDown);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseDown, handleMouseMove, handleMouseUp]);

  const handlePaneClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  const gridSize = 50;

  return (
    <div className="relative h-full w-full bg-bg-primary">
      <button
        onClick={() => setShowGrid((v) => !v)}
        className="absolute top-2 left-2 z-10 rounded border border-border-primary bg-bg-secondary text-[10px] text-text-secondary hover:bg-bg-tertiary"
        style={{ padding: '8px 20px' }}
        title="Toggle grid"
      >
        {showGrid ? 'Grid: On' : 'Grid: Off'}
      </button>

      <svg
        ref={svgRef}
        className="h-full w-full"
        viewBox={`${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}`}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handlePaneClick}
        style={{ cursor: isPanning ? 'grabbing' : 'default' }}
      >
        <defs>
          <filter id="selection-glow" x="-30%" y="-30%" width="160%" height="160%">
            <feDropShadow dx="0" dy="0" stdDeviation="3" floodColor="#4263eb" floodOpacity="0.6" />
          </filter>

          {showGrid && (
            <pattern
              id="grid"
              width={gridSize}
              height={gridSize}
              patternUnits="userSpaceOnUse"
            >
              <path
                d={`M ${gridSize} 0 L 0 0 0 ${gridSize}`}
                fill="none"
                stroke="var(--border-primary)"
                strokeWidth="0.5"
                opacity="0.5"
              />
            </pattern>
          )}
        </defs>

        {showGrid && (
          <rect
            x={viewBox.x}
            y={viewBox.y}
            width={viewBox.w}
            height={viewBox.h}
            fill="url(#grid)"
          />
        )}

        <line x1="-20" y1="0" x2="20" y2="0" stroke="var(--text-muted)" strokeWidth="0.5" opacity="0.4" />
        <line x1="0" y1="-20" x2="0" y2="20" stroke="var(--text-muted)" strokeWidth="0.5" opacity="0.4" />

        {/* Render templated nodes as ghost overlay */}
        {nodes.map((node) => {
          if (!node.data.templated) return null;
          let geo = results.get(node.id);
          if (!geo) return null;
          if (geo.type === 'export' && geo.geometry) geo = geo.geometry;
          if (geo.type === 'export') return null;
          return (
            <g key={`template_${node.id}`} opacity={0.25} style={{ pointerEvents: 'none' }}>
              {renderGeometry(geo, `tmpl_${node.id}`, null, () => {})}
            </g>
          );
        })}

        {/* Only render terminal/display nodes — not intermediate nodes whose
            output feeds into another node */}
        {(() => {
          if (displayNodeId) {
            let geo = results.get(displayNodeId);
            if (geo && geo.type === 'export' && geo.geometry) {
              geo = geo.geometry;
            }
            if (geo) {
              return renderGeometry(geo, displayNodeId, selectedNodeId, selectNode);
            }
            return null;
          }

          const nodesWithDownstream = new Set();
          for (const edge of edges) {
            nodesWithDownstream.add(edge.source);
          }

          return nodes.map((node) => {
            if (nodesWithDownstream.has(node.id)) return null;
            const geo = results.get(node.id);
            if (!geo || geo.type === 'export') return null;
            return renderGeometry(geo, node.id, selectedNodeId, selectNode);
          });
        })()}

        {selectedGeo && selectedNode && selectedDef && (
          <GimbalHandles
            geometry={selectedGeo}
            node={selectedNode}
            definition={selectedDef}
            screenToSvg={screenToSvg}
          />
        )}

        {/* Corner pick overlay for Radius nodes */}
        {selectedNode && selectedDef && selectedDef.id === 'radius' && (() => {
          const sourceEdge = edges.find((e) => e.target === selectedNode.id && e.targetHandle === 'geometry_in');
          const sourceGeo = sourceEdge ? results.get(sourceEdge.source) : null;
          if (sourceGeo && (sourceGeo.type === 'rect' || sourceGeo.type === 'roundedRect' || sourceGeo.type === 'booleanResult')) {
            return (
              <CornerPickOverlay
                geometry={sourceGeo}
                nodeId={selectedNode.id}
              />
            );
          }
          return null;
        })()}

        {/* Free Curve drawing overlay */}
        {selectedNode && selectedDef && selectedDef.id === 'freecurve' && (
          <FreeCurveOverlay
            nodeId={selectedNode.id}
            screenToSvg={screenToSvg}
            results={results}
          />
        )}

        {/* Bezier Curve drawing overlay */}
        {selectedNode && selectedDef && selectedDef.id === 'bezier' && (
          <BezierOverlay
            nodeId={selectedNode.id}
            screenToSvg={screenToSvg}
            results={results}
          />
        )}
      </svg>
    </div>
  );
}
