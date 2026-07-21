import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { useNodeRegistryStore } from '../../store/nodeRegistryStore';
import { useViewportStore } from '../../store/viewportStore';
import { useAnimationStore, RESOLUTION_PRESETS } from '../../store/animationStore';
import { evaluateGraph, buildColliderTracks } from '../../utils/evaluateGraph';
import { resolveAllNodesAtFrame } from '../../utils/interpolation';
import { renderGeometry } from '../../utils/svgRenderer';
import { extractPoints } from '../../utils/geometryPoints';
import { centerTranslate } from '../../utils/exportUtils';
import GimbalHandles from './GimbalHandles';
import CornerPickOverlay from './CornerPickOverlay';
import FreeCurveOverlay from './FreeCurveOverlay';
import FloorplanOverlay from './FloorplanOverlay';
import FurnitureOverlay from './FurnitureOverlay';
import BezierOverlay from './BezierOverlay';
import PointTransformOverlay from './PointTransformOverlay';
import ResampleOverlay from './ResampleOverlay';
import SelectOverlay from './SelectOverlay';
import SplitSelectOverlay from './SplitSelectOverlay';
import DeleteOverlay from './DeleteOverlay';
import DimensionOverlay from './DimensionOverlay';
import GeometryErrorBoundary from './GeometryErrorBoundary';
import Timeline from '../timeline/Timeline';

export default function Viewport() {
  const svgRef = useRef(null);
  const [viewBox, setViewBox] = useState({ x: -400, y: -300, w: 800, h: 600 });
  const [isPanning, setIsPanning] = useState(false);
  const panRef = useRef({ active: false, x: 0, y: 0 });
  const [showGrid, setShowGrid] = useState(false);
  const [snapPoints, setSnapPoints] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const [fontVersion, setFontVersion] = useState(0);
  const exportPanRef = useRef({ active: false, x: 0, y: 0 });
  const exportFrameRef = useRef(null);

  useEffect(() => {
    const handler = () => setFontVersion((v) => v + 1);
    window.addEventListener('font-loaded', handler);
    window.addEventListener('import-image-loaded', handler);
    return () => {
      window.removeEventListener('font-loaded', handler);
      window.removeEventListener('import-image-loaded', handler);
    };
  }, []);

  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const displayNodeId = useGraphStore((s) => s.displayNodeId);
  const selectNode = useGraphStore((s) => s.selectNode);
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);
  const definitions = useNodeRegistryStore((s) => s.definitions);

  const animEnabled = useAnimationStore((s) => s.enabled);
  const currentFrame = useAnimationStore((s) => s.currentFrame);
  const allKeyframes = useAnimationStore((s) => s.keyframes);
  const showCameraFrame = useAnimationStore((s) => s.showCameraFrame);
  const resolution = useAnimationStore((s) => s.resolution);
  const fps = useAnimationStore((s) => s.fps);

  const cameraRect = useMemo(() => {
    if (!animEnabled || !showCameraFrame) return null;
    const preset = RESOLUTION_PRESETS.find((p) => p.id === resolution) || RESOLUTION_PRESETS[1];
    const aspect = preset.width / preset.height;
    const cx = viewBox.x + viewBox.w / 2;
    const cy = viewBox.y + viewBox.h / 2;
    const vbAspect = viewBox.w / viewBox.h;
    let fw, fh;
    if (vbAspect > aspect) {
      fh = viewBox.h * 0.85;
      fw = fh * aspect;
    } else {
      fw = viewBox.w * 0.85;
      fh = fw / aspect;
    }
    return { x: cx - fw / 2, y: cy - fh / 2, w: fw, h: fh };
  }, [animEnabled, showCameraFrame, resolution, viewBox]);

  const animatedNodes = useMemo(() => {
    if (!animEnabled || Object.keys(allKeyframes).length === 0) return nodes;
    return resolveAllNodesAtFrame(nodes, allKeyframes, currentFrame);
  }, [nodes, animEnabled, allKeyframes, currentFrame]);

  // Frame-0 (rest pose) nodes, used to give stateful runtimes (physics) a
  // deterministic starting pose for inputs like an animated collider.
  const restNodes = useMemo(() => {
    if (!animEnabled || Object.keys(allKeyframes).length === 0) return nodes;
    return resolveAllNodesAtFrame(nodes, allKeyframes, 0);
  }, [nodes, animEnabled, allKeyframes]);

  const restResults = useMemo(
    () => evaluateGraph(restNodes, edges, definitions, displayNodeId, { frame: 0, fps }),
    [restNodes, edges, definitions, displayNodeId, fontVersion, fps]
  );

  // Per-frame motion track for any animated physics collider, so a moving
  // obstacle follows its true keyframe path and then holds still (letting the
  // bodies it disturbed actually settle). Only built when animating.
  const colliderTrack = useMemo(() => {
    if (!animEnabled) return null;
    return buildColliderTracks(nodes, edges, definitions, allKeyframes, currentFrame);
  }, [nodes, edges, definitions, allKeyframes, currentFrame, animEnabled, fontVersion]);

  const evalContext = useMemo(
    () => ({ frame: animEnabled ? currentFrame : 0, fps, restResults, colliderTrack }),
    [animEnabled, currentFrame, fps, restResults, colliderTrack]
  );

  const results = useMemo(
    () => evaluateGraph(animatedNodes, edges, definitions, displayNodeId, evalContext),
    [animatedNodes, edges, definitions, displayNodeId, fontVersion, evalContext]
  );

  // Changes whenever the evaluated graph output changes; used to reset the
  // geometry error boundary so it recovers after the user fixes a bad value.
  const renderResetKey = useMemo(() => `${displayNodeId || ''}:${Date.now()}`, [results, displayNodeId]);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const selectedGeoRaw = selectedNodeId ? results.get(selectedNodeId) : null;
  const selectedGeo = selectedGeoRaw && selectedGeoRaw.__multiOutput
    ? (() => { const parts = Object.entries(selectedGeoRaw).filter(([k]) => k !== '__multiOutput').map(([, v]) => v).filter(Boolean); return parts.length > 0 ? { type: 'group', children: parts, bounds: parts[0].bounds } : null; })()
    : selectedGeoRaw;
  const selectedDef = selectedNode
    ? definitions[selectedNode.data.definitionId]
    : null;

  // Snap-to-points: gather the vertices of every OTHER piece of geometry so a
  // dragged shape can latch onto them. Only computed while the snap toggle is on
  // and something is selected, so it stays cheap when unused.
  const snapCandidates = useMemo(() => {
    if (!snapPoints || !selectedNodeId) return [];
    const pts = [];
    const seen = new Set();
    const push = (geo) => {
      if (!geo) return;
      let g = geo;
      if (g.__multiOutput) {
        for (const [k, v] of Object.entries(g)) {
          if (k !== '__multiOutput' && v) push(v);
        }
        return;
      }
      if (g.type === 'export') g = g.geometry;
      if (!g) return;
      let vs = [];
      try {
        vs = extractPoints(g);
      } catch {
        vs = [];
      }
      for (const p of vs) {
        if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
        const key = `${Math.round(p.x * 10)},${Math.round(p.y * 10)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        pts.push({ x: p.x, y: p.y });
      }
    };
    for (const [nodeId, geo] of results.entries()) {
      if (nodeId === selectedNodeId) continue;
      push(geo);
    }
    return pts;
  }, [snapPoints, selectedNodeId, results]);

  // Magical reveal: the grid stays hidden until a Polyline turns on Snap to Grid,
  // then it appears so you can see what you're snapping to. We only auto-enable
  // (never force-off), so the manual grid toggle still works afterward.
  const anySnapGrid = useMemo(
    () => nodes.some(
      (n) =>
        (n.data.definitionId === 'freecurve' || n.data.definitionId === 'floorplan') &&
        n.data.params?.snap_grid === true,
    ),
    [nodes],
  );
  useEffect(() => {
    if (anySnapGrid) setShowGrid(true);
  }, [anySnapGrid]);

  const exportFrameRect = useMemo(() => {
    if (!selectedNode) return null;
    const def = definitions[selectedNode.data.definitionId];
    if (!def || def.id !== 'export') return null;
    const p = selectedNode.data.params || {};
    const fmt = p.format ?? 'svg';
    // OBJ/GEO have no 2D canvas frame; the 1:1 CAD exports (dxf/svg_mm) use the
    // part's true bounds rather than a pixel canvas, so no fit-frame is shown.
    if (fmt === 'obj' || fmt === 'geo' || fmt === 'dxf' || fmt === 'svg_mm') return null;

    const res = p.resolution ?? 'hd';
    let ew, eh;
    if (res === 'hd') { ew = 1920; eh = 1080; }
    else if (res === '4k') { ew = 3840; eh = 2160; }
    else { ew = p.canvas_width ?? 1920; eh = p.canvas_height ?? 1080; }

    const offsetX = p.offset_x ?? 0;
    const offsetY = p.offset_y ?? 0;
    const zoom = p.zoom ?? 1;

    const geo = results.get(selectedNode.id);
    const sourceGeo = geo && geo.geometry ? geo.geometry : geo;

    const { tx, ty, zoom: z } = centerTranslate(sourceGeo, ew, eh, offsetX, offsetY, zoom);

    const worldX = (0 - tx) / z;
    const worldY = (0 - ty) / z;
    const worldW = ew / z;
    const worldH = eh / z;

    return { x: worldX, y: worldY, w: worldW, h: worldH, canvasW: ew, canvasH: eh };
  }, [selectedNode, definitions, results]);

  useEffect(() => {
    exportFrameRef.current = exportFrameRect && !cameraRect
      ? { rect: exportFrameRect, nodeId: selectedNode?.id, params: selectedNode?.data?.params }
      : null;
  });

  const prevExportNodeRef = useRef(null);
  useEffect(() => {
    if (!exportFrameRect || cameraRect) {
      prevExportNodeRef.current = null;
      return;
    }
    const key = selectedNode?.id;
    if (key && key !== prevExportNodeRef.current) {
      prevExportNodeRef.current = key;
      const pad = 1.15;
      const fw = exportFrameRect.w * pad;
      const fh = exportFrameRect.h * pad;
      const svg = svgRef.current;
      if (svg) {
        const rect = svg.getBoundingClientRect();
        const aspect = rect.width / rect.height;
        const vw = Math.max(fw, fh * aspect);
        const vh = vw / aspect;
        const cx = exportFrameRect.x + exportFrameRect.w / 2;
        const cy = exportFrameRect.y + exportFrameRect.h / 2;
        setViewBox({ x: cx - vw / 2, y: cy - vh / 2, w: vw, h: vh });
      }
    }
  }, [exportFrameRect, cameraRect, selectedNode]);

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
      if (e.button === 1 || e.button === 2 || (e.button === 0 && e.altKey)) {
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
      const svg = svgRef.current;
      if (!svg) return;
      const ctm = svg.getScreenCTM();
      if (!ctm) return;

      const ef = exportFrameRef.current;
      if (ef) {
        const inv = ctm.inverse();
        const mx = inv.a * e.clientX + inv.c * e.clientY + inv.e;
        const my = inv.b * e.clientX + inv.d * e.clientY + inv.f;
        const fr = ef.rect;
        if (mx >= fr.x && mx <= fr.x + fr.w && my >= fr.y && my <= fr.y + fr.h) {
          const isPinch = e.ctrlKey || e.metaKey;
          const isDiscrete = e.deltaY !== 0 && e.deltaY % 1 === 0 && Math.abs(e.deltaY) >= 50;
          const isMouseWheel = !isPinch && isDiscrete;
          if (isPinch || isMouseWheel) {
            const p = ef.params || {};
            const oldZoom = p.zoom ?? 1;
            const factor = isPinch
              ? Math.pow(2, -e.deltaY * 0.01)
              : (e.deltaY > 0 ? 0.9 : 1.1);
            const newZoom = Math.max(0.01, Math.min(20, oldZoom * factor));
            useGraphStore.getState().updateNodeParams(ef.nodeId, { zoom: Math.round(newZoom * 100) / 100 });
            return;
          }
        }
      }

      const isPinch = e.ctrlKey || e.metaKey;
      const hasHorizontal = Math.abs(e.deltaX) > 0;
      const isDiscrete = e.deltaY !== 0 && e.deltaY % 1 === 0 && Math.abs(e.deltaY) >= 50;
      const isMouseWheel = !isPinch && !hasHorizontal && isDiscrete;
      const shouldPan = !isPinch && !isMouseWheel;

      if (shouldPan) {
        const scale = ctm.a;
        const dx = e.deltaX / scale;
        const dy = e.deltaY / scale;
        setViewBox(v => ({ ...v, x: v.x + dx, y: v.y + dy }));
      } else {
        const zoomFactor = isPinch
          ? Math.pow(2, e.deltaY * 0.01)
          : (e.deltaY > 0 ? 1.1 : 0.9);
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
      }
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
      if (e.button === 1 || e.button === 2) {
        e.preventDefault();
        handleMouseDown(e);
      }
    };
    const onCtx = (e) => e.preventDefault();
    svg.addEventListener('mousedown', onDown);
    svg.addEventListener('contextmenu', onCtx);
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      svg.removeEventListener('mousedown', onDown);
      svg.removeEventListener('contextmenu', onCtx);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [handleMouseDown, handleMouseMove, handleMouseUp]);

  const handlePaneClick = useCallback((e) => {
    selectNode(null);
  }, [selectNode]);

  const zoomIn = useCallback(() => {
    setViewBox(v => {
      const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
      const f = 0.8;
      return { x: cx - (v.w * f) / 2, y: cy - (v.h * f) / 2, w: v.w * f, h: v.h * f };
    });
  }, []);

  const zoomOut = useCallback(() => {
    setViewBox(v => {
      const cx = v.x + v.w / 2, cy = v.y + v.h / 2;
      const f = 1.25;
      return { x: cx - (v.w * f) / 2, y: cy - (v.h * f) / 2, w: v.w * f, h: v.h * f };
    });
  }, []);

  const fitAll = useCallback(() => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    let found = false;
    for (const [, geo] of results) {
      if (!geo || geo.type === 'export') continue;
      const b = geo.bounds;
      if (b) {
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width);
        maxY = Math.max(maxY, b.y + b.height);
        found = true;
      }
    }
    if (!found) {
      setViewBox({ x: -400, y: -300, w: 800, h: 600 });
      return;
    }
    const padding = 60;
    const w = (maxX - minX) + padding * 2;
    const h = (maxY - minY) + padding * 2;
    const svg = svgRef.current;
    if (svg) {
      const rect = svg.getBoundingClientRect();
      const aspect = rect.width / rect.height;
      const vw = Math.max(w, h * aspect);
      const vh = vw / aspect;
      const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
      setViewBox({ x: cx - vw / 2, y: cy - vh / 2, w: vw, h: vh });
    } else {
      setViewBox({ x: minX - padding, y: minY - padding, w, h });
    }
  }, [results]);

  const isExportFrameActive = exportFrameRect && !cameraRect;

  const handleExportFrameDown = useCallback((e) => {
    if (!isExportFrameActive || !selectedNode) return;
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    exportPanRef.current = { active: true, x: e.clientX, y: e.clientY };
    setIsPanning(true);
  }, [isExportFrameActive, selectedNode]);

  const handleExportFrameMove = useCallback((e) => {
    if (!exportPanRef.current.active || !selectedNode) return;
    const svg = svgRef.current;
    if (!svg) return;
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const scale = ctm.a;
    const dx = (e.clientX - exportPanRef.current.x) / scale;
    const dy = (e.clientY - exportPanRef.current.y) / scale;
    exportPanRef.current.x = e.clientX;
    exportPanRef.current.y = e.clientY;

    const p = selectedNode.data.params || {};
    const z = p.zoom ?? 1;
    const newOffX = (p.offset_x ?? 0) - dx * z;
    const newOffY = (p.offset_y ?? 0) - dy * z;
    updateNodeParams(selectedNode.id, { offset_x: newOffX, offset_y: newOffY });
  }, [selectedNode, updateNodeParams]);

  const handleExportFrameUp = useCallback(() => {
    exportPanRef.current.active = false;
    setIsPanning(false);
  }, []);

  useEffect(() => {
    if (!isExportFrameActive) return;
    window.addEventListener('mousemove', handleExportFrameMove);
    window.addEventListener('mouseup', handleExportFrameUp);
    return () => {
      window.removeEventListener('mousemove', handleExportFrameMove);
      window.removeEventListener('mouseup', handleExportFrameUp);
    };
  }, [isExportFrameActive, handleExportFrameMove, handleExportFrameUp]);

  const gridSize = 50;
  const splashVisible = showSplash && nodes.length === 0;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="relative flex-1 w-full bg-bg-primary" style={{ minHeight: 0 }} data-viewport-canvas>
      <button
        onClick={() => setShowGrid((v) => !v)}
        className="absolute top-2 left-2 z-10 flex items-center gap-1 rounded border border-border-primary bg-bg-secondary text-[10px] text-text-secondary hover:bg-bg-tertiary"
        style={{ padding: '2px 8px', height: 22 }}
        title="Toggle grid"
      >
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1" opacity={showGrid ? 1 : 0.4}>
          <path d="M0 3.3h10M0 6.6h10M3.3 0v10M6.6 0v10"/>
        </svg>
      </button>

      <button
        onClick={() => setSnapPoints((v) => !v)}
        className={`absolute top-2 z-10 flex items-center gap-1 rounded border border-border-primary text-[10px] hover:bg-bg-tertiary ${snapPoints ? 'bg-accent text-white' : 'bg-bg-secondary text-text-secondary'}`}
        style={{ padding: '2px 8px', height: 22, left: 40 }}
        title="Snap to points — dragged shapes latch onto vertices of other geometry"
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" opacity={snapPoints ? 1 : 0.5}>
          <circle cx="6" cy="6" r="2.4" fill="currentColor" stroke="none" />
        </svg>
      </button>

      <div className="absolute left-3 z-10 flex flex-col overflow-hidden rounded-lg border border-border-primary bg-white shadow-sm"
        style={{ borderRadius: 8, bottom: 12 }}
      >
        <button
          onClick={zoomIn}
          className="flex h-[26px] w-[26px] items-center justify-center border-b border-border-primary text-text-secondary hover:bg-bg-tertiary"
          title="Zoom in"
        >
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 0v12M0 6h12" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
        </button>
        <button
          onClick={zoomOut}
          className="flex h-[26px] w-[26px] items-center justify-center border-b border-border-primary text-text-secondary hover:bg-bg-tertiary"
          title="Zoom out"
        >
          <svg width="12" height="12" viewBox="0 0 12 12"><path d="M0 6h12" stroke="currentColor" strokeWidth="1.5" fill="none"/></svg>
        </button>
        <button
          onClick={fitAll}
          className="flex h-[26px] w-[26px] items-center justify-center text-text-secondary hover:bg-bg-tertiary"
          title="Fit all geometry"
        >
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
            <path d="M1 4V1h3M8 1h3v3M11 8v3H8M4 11H1V8"/>
          </svg>
        </button>
      </div>

      <svg
        id="viewport-svg"
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
          <filter id="selection-glow" x="-15%" y="-15%" width="130%" height="130%">
            <feDropShadow dx="0" dy="0" stdDeviation="1" floodColor="#4263eb" floodOpacity="0.8" />
          </filter>

          {showGrid && !splashVisible && (
            <pattern
              id="gridMajor"
              width={gridSize * 5}
              height={gridSize * 5}
              patternUnits="userSpaceOnUse"
            >
              {/* minor lines every cell */}
              {[1, 2, 3, 4].map((i) => (
                <g key={`m${i}`}>
                  <line
                    x1={gridSize * i} y1="0" x2={gridSize * i} y2={gridSize * 5}
                    stroke="var(--text-muted)" strokeWidth="1"
                    vectorEffect="non-scaling-stroke" opacity="0.4"
                  />
                  <line
                    x1="0" y1={gridSize * i} x2={gridSize * 5} y2={gridSize * i}
                    stroke="var(--text-muted)" strokeWidth="1"
                    vectorEffect="non-scaling-stroke" opacity="0.4"
                  />
                </g>
              ))}
              {/* heavier major line at the block edge */}
              <path
                d={`M ${gridSize * 5} 0 L 0 0 0 ${gridSize * 5}`}
                fill="none" stroke="var(--text-muted)" strokeWidth="1.5"
                vectorEffect="non-scaling-stroke" opacity="0.85"
              />
            </pattern>
          )}
        </defs>

        {showGrid && !splashVisible && (
          <rect
            x={viewBox.x - viewBox.w}
            y={viewBox.y - viewBox.h}
            width={viewBox.w * 3}
            height={viewBox.h * 3}
            fill="url(#gridMajor)"
          />
        )}

        <line x1="-20" y1="0" x2="20" y2="0" stroke="var(--text-muted)" strokeWidth="0.5" opacity="0.4" />
        <line x1="0" y1="-20" x2="0" y2="20" stroke="var(--text-muted)" strokeWidth="0.5" opacity="0.4" />

        {/* Geometry rendering is wrapped in an error boundary so a single
            malformed shape (e.g. from an extreme dimension edit) shows an
            inline notice instead of blanking the entire viewport. */}
        <GeometryErrorBoundary resetKey={renderResetKey}>
        {/* Render templated nodes as ghost overlay */}
        {nodes.map((node) => {
          if (!node.data.templated) return null;
          let geo = results.get(node.id);
          if (!geo) return null;
          if (geo.__multiOutput) {
            const parts = Object.entries(geo).filter(([k]) => k !== '__multiOutput').map(([, v]) => v).filter(Boolean);
            if (parts.length === 0) return null;
            geo = { type: 'group', children: parts, bounds: parts[0].bounds };
          }
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
            if (geo && geo.__multiOutput) {
              const parts = Object.entries(geo).filter(([k]) => k !== '__multiOutput').map(([, v]) => v).filter(Boolean);
              geo = parts.length > 0 ? { type: 'group', children: parts, bounds: parts[0].bounds } : null;
            }
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
            let geo = results.get(node.id);
            if (!geo || geo.type === 'export') return null;
            if (geo.__multiOutput) {
              const parts = Object.entries(geo).filter(([k]) => k !== '__multiOutput').map(([, v]) => v).filter(Boolean);
              if (parts.length === 0) return null;
              geo = { type: 'group', children: parts, bounds: parts[0].bounds };
            }
            return renderGeometry(geo, node.id, selectedNodeId, selectNode);
          });
        })()}
        </GeometryErrorBoundary>

        {snapPoints && snapCandidates.length > 0 && (() => {
          const u = viewBox.w / 800;
          return (
            <g pointerEvents="none">
              {snapCandidates.map((p, i) => (
                <circle
                  key={`snapcand${i}`}
                  cx={p.x}
                  cy={p.y}
                  r={4 * u}
                  fill="#e8590c"
                  fillOpacity={0.9}
                  stroke="#ffffff"
                  strokeWidth={1 * u}
                />
              ))}
            </g>
          );
        })()}

        {selectedGeo && selectedNode && selectedDef && (
          <GimbalHandles
            geometry={selectedGeo}
            node={selectedNode}
            definition={selectedDef}
            screenToSvg={screenToSvg}
            viewBox={viewBox}
            snapEnabled={snapPoints}
            snapCandidates={snapCandidates}
          />
        )}

        {/* Corner pick overlay for Radius nodes */}
        {selectedNode && selectedDef && selectedDef.id === 'radius' && (() => {
          const sourceEdge = edges.find((e) => e.target === selectedNode.id && e.targetHandle === 'geometry_in');
          const sourceGeoRaw = sourceEdge ? results.get(sourceEdge.source) : null;
          const sourceGeo = sourceGeoRaw && sourceGeoRaw.__multiOutput && sourceEdge.sourceHandle
            ? sourceGeoRaw[sourceEdge.sourceHandle] : sourceGeoRaw;
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
            gridSize={gridSize}
          />
        )}

        {/* Floorplan multi-wall drawing overlay */}
        {selectedNode && selectedDef && selectedDef.id === 'floorplan' && (
          <FloorplanOverlay
            nodeId={selectedNode.id}
            screenToSvg={screenToSvg}
            results={results}
            gridSize={gridSize}
            viewBox={viewBox}
          />
        )}

        {/* Furniture placement overlay */}
        {selectedNode && selectedDef && selectedDef.id === 'furniture' && (
          <FurnitureOverlay
            nodeId={selectedNode.id}
            screenToSvg={screenToSvg}
            gridSize={gridSize}
            viewBox={viewBox}
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

        {/* Point Transform overlay */}
        {selectedNode && selectedDef && selectedDef.id === 'pointtransform' && (
          <PointTransformOverlay
            nodeId={selectedNode.id}
            screenToSvg={screenToSvg}
            edges={edges}
            results={results}
          />
        )}

        {/* Resample control-point preview */}
        {selectedNode && selectedDef && selectedDef.id === 'resample' && (
          <ResampleOverlay
            nodeId={selectedNode.id}
            edges={edges}
            results={results}
            viewBox={viewBox}
          />
        )}

        {/* Select parts overlay */}
        {selectedNode && selectedDef && selectedDef.id === 'select' && (
          <SelectOverlay
            nodeId={selectedNode.id}
            screenToSvg={screenToSvg}
            edges={edges}
            results={results}
            viewBox={viewBox}
          />
        )}

        {/* Split Select component picker overlay */}
        {selectedNode && selectedDef && selectedDef.id === 'splitselect' && (
          <SplitSelectOverlay
            nodeId={selectedNode.id}
            edges={edges}
            results={results}
            viewBox={viewBox}
          />
        )}

        {/* Delete component picker overlay */}
        {selectedNode && selectedDef && selectedDef.id === 'delete' && (
          <DeleteOverlay
            nodeId={selectedNode.id}
            edges={edges}
            results={results}
            viewBox={viewBox}
          />
        )}

        {/* Dimension (parametric sketch) overlay */}
        {selectedNode && selectedDef && selectedDef.id === 'dimension' && (
          <DimensionOverlay
            nodeId={selectedNode.id}
            screenToSvg={screenToSvg}
            edges={edges}
            results={results}
            viewBox={viewBox}
          />
        )}

        {/* Camera frame overlay */}
        {cameraRect && (
          <g style={{ pointerEvents: 'none' }}>
            <rect
              x={cameraRect.x} y={cameraRect.y}
              width={cameraRect.w} height={cameraRect.h}
              fill="none" stroke="#ef4444" strokeWidth={viewBox.w * 0.002}
              strokeDasharray={`${viewBox.w * 0.008} ${viewBox.w * 0.004}`}
              opacity={0.8}
            />
            <rect x={viewBox.x} y={viewBox.y} width={viewBox.w} height={cameraRect.y - viewBox.y}
              fill="black" opacity={0.08} />
            <rect x={viewBox.x} y={cameraRect.y + cameraRect.h} width={viewBox.w} height={viewBox.y + viewBox.h - cameraRect.y - cameraRect.h}
              fill="black" opacity={0.08} />
            <rect x={viewBox.x} y={cameraRect.y} width={cameraRect.x - viewBox.x} height={cameraRect.h}
              fill="black" opacity={0.08} />
            <rect x={cameraRect.x + cameraRect.w} y={cameraRect.y} width={viewBox.x + viewBox.w - cameraRect.x - cameraRect.w} height={cameraRect.h}
              fill="black" opacity={0.08} />
          </g>
        )}

        {/* Export preview frame overlay */}
        {exportFrameRect && !cameraRect && (() => {
          const fr = exportFrameRect;
          const vl = viewBox.x, vt = viewBox.y, vr = viewBox.x + viewBox.w, vb = viewBox.y + viewBox.h;
          const fl = fr.x, ft = fr.y, fRight = fr.x + fr.w, fb = fr.y + fr.h;
          const clampedTop = Math.max(0, Math.min(ft, vb) - vt);
          const clampedBot = Math.max(0, vb - Math.max(fb, vt));
          const midT = Math.max(ft, vt);
          const midB = Math.min(fb, vb);
          const midH = Math.max(0, midB - midT);
          const clampedLeft = Math.max(0, Math.min(fl, vr) - vl);
          const clampedRight = Math.max(0, vr - Math.max(fRight, vl));
          return (
          <g>
            <rect
              x={fr.x} y={fr.y}
              width={fr.w} height={fr.h}
              fill="transparent"
              style={{ cursor: 'grab' }}
              onMouseDown={handleExportFrameDown}
            />
            <g style={{ pointerEvents: 'none' }}>
              <rect
                x={fr.x} y={fr.y}
                width={fr.w} height={fr.h}
                fill="none" stroke="#ef4444" strokeWidth={viewBox.w * 0.002}
                opacity={0.9}
              />
              {clampedTop > 0 && <rect x={vl} y={vt} width={viewBox.w} height={clampedTop} fill="black" opacity={0.08} />}
              {clampedBot > 0 && <rect x={vl} y={Math.max(fb, vt)} width={viewBox.w} height={clampedBot} fill="black" opacity={0.08} />}
              {midH > 0 && clampedLeft > 0 && <rect x={vl} y={midT} width={clampedLeft} height={midH} fill="black" opacity={0.08} />}
              {midH > 0 && clampedRight > 0 && <rect x={Math.max(fRight, vl)} y={midT} width={clampedRight} height={midH} fill="black" opacity={0.08} />}
              <text
                x={fr.x + fr.w / 2}
                y={fr.y - viewBox.h * 0.012}
                textAnchor="middle"
                fill="#ef4444" fontSize={viewBox.h * 0.022} opacity={0.7}
              >{fr.canvasW} x {fr.canvasH}</text>
            </g>
          </g>
          );
        })()}
      </svg>

      {splashVisible && (
        <div
          style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'auto',
            gap: 20,
          }}
        >
          <img
            src={`${import.meta.env.BASE_URL}starcover.svg`}
            alt="Welcome"
            style={{ width: '756px', objectFit: 'contain', cursor: 'pointer' }}
            draggable={false}
            onClick={() => setShowSplash(false)}
          />
        </div>
      )}

      </div>

      {animEnabled && (
        <div style={{ flexShrink: 0, borderTop: '1px solid var(--border-primary)' }}>
          <Timeline />
        </div>
      )}
    </div>
  );
}
