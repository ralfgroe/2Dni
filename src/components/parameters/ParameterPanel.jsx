import { useMemo, useState, useRef, useEffect, useCallback } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { useNodeRegistryStore } from '../../store/nodeRegistryStore';
import { useAnimationStore } from '../../store/animationStore';
import { evaluateGraph, buildColliderTracks, buildSpringTracks } from '../../utils/evaluateGraph';
import { resolveAllNodesAtFrame, interpolateValue, EASING_OPTIONS } from '../../utils/interpolation';
import { exportSVG, exportSVGmm, exportDXF, exportPNG, exportJPEG, exportOBJ, exportGEO } from '../../utils/exportUtils';
import { extractPoints } from '../../utils/geometryPoints';
import WrangleChat from './WrangleChat';

// Easing is a property of a keyframe (each keyframe's easing controls the
// interpolation INTO it — see interpolateValue). To let the user edit easing
// even when the playhead is between keyframes, resolve which keyframe the
// easing selector should target:
//   - if there's a keyframe exactly at the current frame, edit that one;
//   - otherwise edit the NEXT keyframe after the current frame (the incoming
//     one that governs the segment we're currently interpolating across);
//   - if we're past the last keyframe, fall back to the last keyframe.
// Returns { frame, easing } or null when the param isn't animated at all.
function resolveEasingTarget(paramKfs, currentFrame) {
  if (!paramKfs) return null;
  const frames = Object.keys(paramKfs).map(Number).sort((a, b) => a - b);
  if (frames.length === 0) return null;
  if (paramKfs[currentFrame] != null) {
    return { frame: currentFrame, easing: paramKfs[currentFrame].easing || 'easeInOut' };
  }
  const next = frames.find((f) => f > currentFrame);
  const target = next != null ? next : frames[frames.length - 1];
  return { frame: target, easing: paramKfs[target].easing || 'easeInOut', incoming: next != null };
}

export default function ParameterPanel() {
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const displayNodeId = useGraphStore((s) => s.displayNodeId);
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);
  const definitions = useNodeRegistryStore((s) => s.definitions);
  const getDefinition = useNodeRegistryStore((s) => s.getDefinition);

  const animEnabled = useAnimationStore((s) => s.enabled);
  const currentFrame = useAnimationStore((s) => s.currentFrame);
  const allKeyframes = useAnimationStore((s) => s.keyframes);
  const animFps = useAnimationStore((s) => s.fps);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const definition = selectedNode
    ? getDefinition(selectedNode.data.definitionId)
    : null;

  const animatedNodes = useMemo(() => {
    if (!animEnabled || Object.keys(allKeyframes).length === 0) return nodes;
    return resolveAllNodesAtFrame(nodes, allKeyframes, currentFrame);
  }, [nodes, animEnabled, allKeyframes, currentFrame]);

  const restNodes = useMemo(() => {
    if (!animEnabled || Object.keys(allKeyframes).length === 0) return nodes;
    return resolveAllNodesAtFrame(nodes, allKeyframes, 0);
  }, [nodes, animEnabled, allKeyframes]);

  const restResults = useMemo(
    () => evaluateGraph(restNodes, edges, definitions, displayNodeId, { frame: 0, fps: animFps }),
    [restNodes, edges, definitions, displayNodeId, animFps]
  );

  const colliderTrack = useMemo(() => {
    if (!animEnabled) return null;
    return buildColliderTracks(nodes, edges, definitions, allKeyframes, currentFrame);
  }, [nodes, edges, definitions, allKeyframes, currentFrame, animEnabled]);

  const springTrack = useMemo(() => {
    if (!animEnabled) return null;
    return buildSpringTracks(nodes, edges, definitions, allKeyframes, currentFrame);
  }, [nodes, edges, definitions, allKeyframes, currentFrame, animEnabled]);

  const evalContext = useMemo(
    () => ({ frame: animEnabled ? currentFrame : 0, fps: animFps, restResults, colliderTrack, springTrack }),
    [animEnabled, currentFrame, animFps, restResults, colliderTrack, springTrack]
  );

  const results = useMemo(
    () => evaluateGraph(animatedNodes, edges, definitions, displayNodeId, evalContext),
    [animatedNodes, edges, definitions, displayNodeId, evalContext]
  );

  function resolveEdgeResult(edge) {
    if (!edge) return null;
    const raw = results.get(edge.source);
    if (raw && raw.__multiOutput && edge.sourceHandle) {
      return raw[edge.sourceHandle] ?? null;
    }
    return raw ?? null;
  }

  if (!selectedNode || !definition) {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center bg-bg-primary px-4" style={{ position: 'relative' }}>
        {nodes.length > 0 && (
          <>
            <span className="text-sm text-text-muted">No node selected</span>
            <span className="mt-1 text-xs text-text-muted opacity-60">
              Click a node in the graph to view its parameters
            </span>
          </>
        )}
      </div>
    );
  }

  const params = selectedNode.data.params;

  const PRESET_MAPS = {
    spirograph: {
      'Classic':      { outer_radius: 120, inner_radius: 75,  pen_offset: 50 },
      'Astroid':      { outer_radius: 120, inner_radius: 30,  pen_offset: 30 },
      'Deltoid':      { outer_radius: 120, inner_radius: 40,  pen_offset: 40 },
      'Rose 5-petal': { outer_radius: 120, inner_radius: 48,  pen_offset: 48 },
      'Rose 8-petal': { outer_radius: 120, inner_radius: 45,  pen_offset: 45 },
      'Tight Loops':  { outer_radius: 120, inner_radius: 100, pen_offset: 80 },
    },
    lissajous: {
      'Figure-8':   { freq_a: 2, freq_b: 1, phase: 90 },
      'Trefoil':    { freq_a: 3, freq_b: 2, phase: 90 },
      'Pentagram':  { freq_a: 5, freq_b: 4, phase: 90 },
      'Bowtie':     { freq_a: 2, freq_b: 3, phase: 0 },
      'Star Knot':  { freq_a: 7, freq_b: 6, phase: 90 },
    },
    lsystem: {
      'Koch Snowflake':      { axiom: 'F--F--F', rule_f: 'F+F--F+F', rule_g: '', angle: 60 },
      'Sierpinski Triangle': { axiom: 'F-G-G', rule_f: 'F-G+F+G-F', rule_g: 'GG', angle: 120 },
      'Dragon Curve':        { axiom: 'F', rule_f: 'F+G', rule_g: 'F-G', angle: 90 },
      'Hilbert Curve':       { axiom: 'A', rule_f: '', rule_g: '', angle: 90 },
      'Fractal Plant':       { axiom: 'X', rule_f: 'FF', rule_g: '', angle: 25 },
      'Penrose':             { axiom: '[X]++[X]++[X]++[X]++[X]', rule_f: '', rule_g: '', angle: 36 },
    },
  };

  // Strange Attractor presets depend on the selected Type (De Jong / Clifford /
  // Lorenz). Kept in sync with the fallback table in src/nodes/strangeattractor.js.
  const ATTRACTOR_PRESETS = {
    'De Jong': {
      Classic: { a: 1.4, b: -2.3, c: 2.4, d: -2.1 },
      Swirl: { a: -2.0, b: -2.0, c: -1.2, d: 2.0 },
      Wings: { a: 1.641, b: 1.902, c: 0.316, d: 1.525 },
      Web: { a: -2.7, b: -0.09, c: -0.65, d: -2.2 },
      Ribbon: { a: 2.01, b: -2.53, c: 1.61, d: -0.33 },
    },
    Clifford: {
      Classic: { a: -1.4, b: 1.6, c: 1.0, d: 0.7 },
      Swirl: { a: -1.7, b: 1.8, c: -1.9, d: -0.4 },
      Wings: { a: 1.5, b: -1.8, c: 1.6, d: 0.9 },
      Web: { a: -1.8, b: -2.0, c: -0.5, d: -0.9 },
      Ribbon: { a: -1.244, b: -1.251, c: -1.815, d: -1.908 },
    },
    Lorenz: {
      Classic: { a: 10, b: 28, c: 2.6667, d: 0 },
      Swirl: { a: 10, b: 99.96, c: 2.6667, d: 0 },
      Wings: { a: 14, b: 28, c: 2.6667, d: 0 },
      Web: { a: 10, b: 28, c: 1.5, d: 0 },
      Ribbon: { a: 16, b: 45.92, c: 4, d: 0 },
    },
  };

  const handlePresetChange = (presetValue) => {
    if (definition.id === 'strangeattractor') {
      const type = params.type ?? 'De Jong';
      const coeffs = ATTRACTOR_PRESETS[type]?.[presetValue];
      if (coeffs) {
        updateNodeParams(selectedNode.id, { preset: presetValue, ...coeffs });
      } else {
        updateNodeParams(selectedNode.id, { preset: presetValue });
      }
      return;
    }
    const presetMap = PRESET_MAPS[definition.id];
    if (presetMap && presetMap[presetValue]) {
      updateNodeParams(selectedNode.id, { preset: presetValue, ...presetMap[presetValue] });
    } else {
      updateNodeParams(selectedNode.id, { preset: presetValue });
    }
  };

  // When the attractor Type changes while a preset is active, re-apply that
  // preset's coefficients for the new type so the sliders stay meaningful.
  const handleAttractorTypeChange = (typeValue) => {
    const preset = params.preset ?? 'Custom';
    const coeffs = preset !== 'Custom' ? ATTRACTOR_PRESETS[typeValue]?.[preset] : null;
    if (coeffs) {
      updateNodeParams(selectedNode.id, { type: typeValue, ...coeffs });
    } else {
      updateNodeParams(selectedNode.id, { type: typeValue });
    }
  };

  const handleExport = () => {
    const fullResults = displayNodeId
      ? evaluateGraph(animatedNodes, edges, definitions, null, evalContext)
      : results;

    const geo = fullResults.get(selectedNode.id);
    if (!geo) return;

    const nodesWithDownstream = new Set();
    for (const edge of edges) {
      nodesWithDownstream.add(edge.source);
    }
    const terminalGeos = [];
    for (const node of nodes) {
      if (nodesWithDownstream.has(node.id)) continue;
      const g = fullResults.get(node.id);
      if (!g) continue;
      if (g.type === 'export' && g.geometry) {
        terminalGeos.push(g.geometry);
      } else if (g.type !== 'export') {
        terminalGeos.push(g);
      }
    }

    let sourceGeo;
    if (terminalGeos.length <= 1) {
      sourceGeo = terminalGeos[0] || geo.geometry || geo;
    } else {
      sourceGeo = { type: 'group', children: terminalGeos, transform: {} };
    }

    const exportParams = (() => {
      const res = params.resolution ?? 'hd';
      let w = params.canvas_width ?? 1920;
      let h = params.canvas_height ?? 1080;
      if (res === 'hd') { w = 1920; h = 1080; }
      else if (res === '4k') { w = 3840; h = 2160; }
      return { ...params, canvasWidth: w, canvasHeight: h, backgroundColor: params.background_color, jpegQuality: params.jpeg_quality, offsetX: params.offset_x ?? 0, offsetY: params.offset_y ?? 0, zoom: params.zoom ?? 1, units_per_mm: params.units_per_mm ?? 1 };
    })();
    switch (params.format) {
      case 'svg_mm': exportSVGmm(sourceGeo, exportParams); break;
      case 'dxf':  exportDXF(sourceGeo, exportParams); break;
      case 'png':  exportPNG(sourceGeo, exportParams); break;
      case 'jpeg': exportJPEG(sourceGeo, exportParams); break;
      case 'obj':  exportOBJ(sourceGeo, exportParams); break;
      case 'geo':  exportGEO(sourceGeo, exportParams); break;
      default:     exportSVG(sourceGeo, exportParams); break;
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto overflow-x-hidden bg-bg-primary" style={{ padding: '12px 14px 32px 26px' }}>
      {/* Header */}
      <div className="shrink-0 border-b border-border-primary pb-3 pt-10">
        <h2 className="text-sm font-semibold text-text-primary">{definition.label}</h2>
        <span className="text-[11px] text-text-muted">{definition.category}</span>
      </div>

      {/* Parameter list */}
      <div className="flex flex-col gap-3 py-4">
        {(() => {
          const renderParam = (origParamDef) => {
          // Schema-level hide: data blobs edited via the canvas, not by hand.
          if (origParamDef.hidden) return null;
          // For the Strange Attractor, the useful coefficient ranges differ by
          // Type: De Jong/Clifford want roughly -5..5, while Lorenz wants much
          // larger values (sigma, rho, beta). Adjust the slider range/labels so
          // the presets' values are reachable on the sliders.
          let paramDef = origParamDef;
          if (definition.id === 'strangeattractor' && ['a', 'b', 'c', 'd'].includes(origParamDef.id)) {
            const t = params.type ?? 'De Jong';
            if (t === 'Lorenz') {
              const LORENZ = {
                a: { label: 'σ (sigma)', min: 0, max: 50, step: 0.01 },
                b: { label: 'ρ (rho)', min: 0, max: 250, step: 0.01 },
                c: { label: 'β (beta)', min: 0, max: 15, step: 0.0001 },
              };
              if (origParamDef.id === 'd') return null; // Lorenz has no 'd'
              paramDef = { ...origParamDef, ...LORENZ[origParamDef.id] };
            } else {
              paramDef = { ...origParamDef, label: origParamDef.id, min: -5, max: 5, step: 0.001 };
            }
          }
          if (definition.id === 'export') {
            const fmt = params.format ?? 'svg';
            const isPixel = fmt === 'svg' || fmt === 'png' || fmt === 'jpeg';
            const isCadMM = fmt === 'svg_mm' || fmt === 'dxf';
            const res = params.resolution ?? 'hd';
            if (!isPixel && (paramDef.id === 'resolution' || paramDef.id === 'canvas_width' || paramDef.id === 'canvas_height' || paramDef.id === 'background_color' || paramDef.id === 'offset_x' || paramDef.id === 'offset_y' || paramDef.id === 'zoom')) return null;
            if (isPixel && res !== 'custom' && (paramDef.id === 'canvas_width' || paramDef.id === 'canvas_height')) return null;
            if (fmt !== 'jpeg' && paramDef.id === 'jpeg_quality') return null;
            // "Units per mm" only matters for the 1:1 CAD exports.
            if (!isCadMM && paramDef.id === 'units_per_mm') return null;
          }
          if (definition.id === 'circle') {
            const separateXY = params.separate_xy;
            if (!separateXY && (paramDef.id === 'diameter_x' || paramDef.id === 'diameter_y')) return null;
            if (separateXY && paramDef.id === 'diameter') return null;
          }
          if (definition.id === 'geometricstar') {
            if (params.preset !== 'Custom' && paramDef.id === 'points') return null;
            if (!params.tile && (paramDef.id === 'grid_type' || paramDef.id === 'rings')) return null;
          }
          if (definition.id === 'scatter') {
            const hasField = edges.some((e) => e.target === selectedNode.id && e.targetHandle === 'scatter_field');
            if (hasField && (paramDef.id === 'width' || paramDef.id === 'height')) return null;
          }
          if (definition.id === 'copymove' && !params.dir2_enabled) {
            if (paramDef.id === 'dir2_copies' || paramDef.id === 'dir2_offset_x' || paramDef.id === 'dir2_offset_y') return null;
          }
          if (definition.id === 'dashes') {
            const style = params.style ?? 'Dashed';
            if (paramDef.id === 'dash_length' && style === 'Dotted') return null;
          }
          if (definition.id === 'radius' && paramDef.id === 'point_selection') {
            const sourceEdge = edges.find((e) => e.target === selectedNode.id && e.targetHandle === 'geometry_in');
            const sourceGeo = resolveEdgeResult(sourceEdge);
            return (
              <CornerSelector
                key={paramDef.id}
                value={params[paramDef.id]}
                nodeId={selectedNode.id}
                sourceGeometry={sourceGeo}
              />
            );
          }
          if (definition.id === 'pointtransform' && paramDef.id === 'point_offsets') {
            return null;
          }
          if (definition.id === 'select' && (paramDef.id === 'selected' || paramDef.id === 'offsets')) {
            return null;
          }
          if (definition.id === 'splitselect' && paramDef.id === 'selected') {
            return null;
          }
          if (definition.id === 'delete' && paramDef.id === 'selected') {
            return null;
          }
          if (definition.id === 'dimension' && paramDef.id === 'dimensions') {
            return (
              <DimensionList
                key={paramDef.id}
                nodeId={selectedNode.id}
                value={params.dimensions}
                units={params.units}
              />
            );
          }
          if (definition.id === 'pointtransform' && paramDef.id === 'scale_points') {
            return null;
          }
          if (definition.id === 'pointtransform' && (paramDef.id === 'offset_x' || paramDef.id === 'offset_y')) {
            return (
              <PointOffsetSlider
                key={paramDef.id}
                paramDef={paramDef}
                value={params[paramDef.id]}
                nodeId={selectedNode.id}
                params={params}
              />
            );
          }
          if (definition.id === 'transform' && paramDef.id === 'rotate') {
            return (
              <div key={paramDef.id} style={{ paddingTop: 24 }}>
                <ParameterRow paramDef={paramDef} value={params[paramDef.id]} nodeId={selectedNode.id} />
              </div>
            );
          }
          if (definition.id === 'transform' && paramDef.id === 'scale') {
            return (
              <div key={paramDef.id} style={{ paddingTop: 30 }}>
                <ParameterRow paramDef={paramDef} value={params[paramDef.id]} nodeId={selectedNode.id} />
              </div>
            );
          }
          if (definition.id === 'transform' && paramDef.id === 'pivot_x') {
            const transformGeo = results.get(selectedNode.id);
            const resolvedGeo = transformGeo && transformGeo.__multiOutput
              ? (() => { const parts = Object.entries(transformGeo).filter(([k]) => k !== '__multiOutput').map(([, v]) => v).filter(Boolean); return parts.length > 0 ? { type: 'group', children: parts, bounds: parts[0].bounds } : null; })()
              : transformGeo;
            return (
              <div key="pivot_group" style={{ paddingTop: 30 }}>
                <div style={{ marginBottom: 12 }} className="flex items-center gap-2">
                  <button
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-primary bg-bg-secondary text-[10px] text-text-secondary hover:bg-bg-tertiary"
                    title="Center Pivot"
                    onClick={() => {
                      if (!resolvedGeo) return;
                      const b = resolvedGeo.bounds || (resolvedGeo.type === 'rect' || resolvedGeo.type === 'roundedRect'
                        ? { x: resolvedGeo.x, y: resolvedGeo.y, width: resolvedGeo.width, height: resolvedGeo.height }
                        : null);
                      if (!b) return;
                      const cx = Math.round((b.x + b.width / 2) * 100) / 100;
                      const cy = Math.round((b.y + b.height / 2) * 100) / 100;
                      updateNodeParams(selectedNode.id, { pivot_x: cx, pivot_y: cy });
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 20 20">
                      <circle cx="10" cy="10" r="7" fill="#fff" stroke="#231f20" strokeWidth="1.2" />
                      <circle cx="10" cy="10" r="2.5" fill="#ec008c" />
                    </svg>
                  </button>
                  <span className="text-[11px] font-medium text-text-secondary">Center Pivot</span>
                </div>
                <ParameterRow
                  paramDef={paramDef}
                  value={params[paramDef.id]}
                  nodeId={selectedNode.id}
                />
              </div>
            );
          }
          return (
            <ParameterRow
              key={paramDef.id}
              paramDef={paramDef}
              value={params[paramDef.id]}
              nodeId={selectedNode.id}
              onPresetChange={
                paramDef.id === 'preset' && (PRESET_MAPS[definition.id] || definition.id === 'strangeattractor')
                  ? handlePresetChange
                  : paramDef.id === 'type' && definition.id === 'strangeattractor'
                  ? handleAttractorTypeChange
                  : null
              }
            />
          );
          };

          // Group consecutive parameters into Houdini-style collapsible folders.
          // A parameter opts in with a `group` field; ungrouped params render
          // inline. We preserve schema order, emitting a section the first time
          // each group is seen.
          const out = [];
          const sectionParams = new Map();
          const sectionOrder = [];
          for (const p of definition.parameters) {
            if (p.hidden) continue;
            if (p.group) {
              if (!sectionParams.has(p.group)) { sectionParams.set(p.group, []); sectionOrder.push(p.group); }
              sectionParams.get(p.group).push(p);
            }
          }
          const emittedSections = new Set();
          for (const p of definition.parameters) {
            if (p.hidden) continue;
            if (p.group) {
              if (emittedSections.has(p.group)) continue;
              emittedSections.add(p.group);
              const groupName = p.group;
              const groupParams = sectionParams.get(groupName);
              out.push(
                <CollapsibleSection key={`sec_${groupName}`} title={groupName} defaultOpen={p.groupOpen !== false}>
                  {groupParams.map((gp) => renderParam(gp)).filter(Boolean)}
                </CollapsibleSection>
              );
            } else {
              const el = renderParam(p);
              if (el) out.push(el);
            }
          }
          return out;
        })()}

        {/* Select node helpers */}
        {definition.id === 'select' && (() => {
          const selectedArr = (() => {
            try { return JSON.parse(params.selected || '[]') || []; } catch { return []; }
          })();
          const hasOffsets = (() => {
            try { return Object.keys(JSON.parse(params.offsets || '{}') || {}).length > 0; } catch { return false; }
          })();
          return (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] text-text-muted">
                Click parts in the viewport to select them. Drag a selected part to move all selected parts.
              </span>
              <span className="text-[11px] font-medium text-text-secondary">
                {selectedArr.length} selected
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => updateNodeParams(selectedNode.id, { selected: '[]' })}
                  className="flex-1 rounded border border-border-primary bg-bg-tertiary text-[10px] text-text-secondary hover:bg-border-primary"
                  style={{ padding: '8px 12px' }}
                >
                  Clear Selection
                </button>
                <button
                  onClick={() => updateNodeParams(selectedNode.id, { offsets: '{}' })}
                  disabled={!hasOffsets}
                  className="flex-1 rounded border border-border-primary bg-bg-tertiary text-[10px] text-text-secondary hover:bg-border-primary disabled:opacity-40"
                  style={{ padding: '8px 12px' }}
                >
                  Reset Moves
                </button>
              </div>
            </div>
          );
        })()}

        {/* Split Select node helpers */}
        {definition.id === 'splitselect' && (() => {
          const selectedArr = (() => {
            try { return JSON.parse(params.selected || '[]') || []; } catch { return []; }
          })();
          return (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] text-text-muted">
                Click components in the viewport to send them to the <span style={{ color: '#2f9e44' }}>Selected</span> output (2nd terminal). Everything else goes to the <span style={{ color: '#4263eb' }}>Rest</span> output (1st terminal).
              </span>
              <span className="text-[11px] font-medium text-text-secondary">
                {selectedArr.length} sent to Selected
              </span>
              <button
                onClick={() => updateNodeParams(selectedNode.id, { selected: '[]' })}
                className="rounded border border-border-primary bg-bg-tertiary text-[10px] text-text-secondary hover:bg-border-primary"
                style={{ padding: '8px 12px' }}
              >
                Clear Selection
              </button>
            </div>
          );
        })()}

        {/* Delete node helpers */}
        {definition.id === 'delete' && (() => {
          const selectedArr = (() => {
            try { return JSON.parse(params.selected || '[]') || []; } catch { return []; }
          })();
          return (
            <div className="flex flex-col gap-2">
              <span className="text-[10px] text-text-muted">
                Click pieces in the viewport to mark them for deletion (they turn <span style={{ color: '#e03131' }}>red</span>). Everything else passes through. Tip: put a <span className="text-text-secondary">Dashes</span> node before this to delete individual dashes/dots.
              </span>
              <span className="text-[11px] font-medium text-text-secondary">
                {selectedArr.length} marked for deletion
              </span>
              <button
                onClick={() => updateNodeParams(selectedNode.id, { selected: '[]' })}
                className="rounded border border-border-primary bg-bg-tertiary text-[10px] text-text-secondary hover:bg-border-primary"
                style={{ padding: '8px 12px' }}
              >
                Clear Selection
              </button>
            </div>
          );
        })()}

        {/* Export button for export nodes */}
        {definition.id === 'export' && (
          <button
            onClick={handleExport}
            className="mt-2 rounded-lg bg-accent text-sm font-medium text-white transition-colors hover:bg-accent-hover"
            style={{ padding: '8px 20px' }}
          >
            Export {(params.format || 'svg').toUpperCase()}
          </button>
        )}

        {/* AI chat for code wrangle nodes */}
        {definition.id === 'code' && (() => {
          const sourceEdge = edges.find((e) => e.target === selectedNode.id && e.targetHandle === 'geometry_in');
          const inputGeo = resolveEdgeResult(sourceEdge);
          return (
            <WrangleChat
              nodeId={selectedNode.id}
              inputGeometry={inputGeo}
              currentCode={params.code}
            />
          );
        })()}
      </div>
    </div>
  );
}

function CollapsibleSection({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 py-1 text-left"
        style={{ userSelect: 'none' }}
      >
        <svg
          width="9" height="9" viewBox="0 0 10 10"
          style={{ transform: open ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 0.12s', opacity: 0.6 }}
        >
          <path d="M3 2l4 3-4 3z" fill="currentColor" className="text-text-secondary" />
        </svg>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary">{title}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-3" style={{ paddingTop: 4, paddingBottom: 4 }}>
          {children}
        </div>
      )}
    </div>
  );
}

function ParameterRow({ paramDef, value, nodeId, onPresetChange }) {
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);
  const animEnabled = useAnimationStore((s) => s.enabled);
  const currentFrame = useAnimationStore((s) => s.currentFrame);
  const setKeyframe = useAnimationStore((s) => s.setKeyframe);
  const setKeyframeEasing = useAnimationStore((s) => s.setKeyframeEasing);
  const allKeyframes = useAnimationStore((s) => s.keyframes);

  const isKeyframeable = paramDef.type === 'number' || paramDef.type === 'color';
  const paramKfs = allKeyframes[nodeId]?.[paramDef.id];
  const hasKf = isKeyframeable && paramKfs && Object.keys(paramKfs).length > 0;
  const hasKfAtFrame = hasKf && paramKfs[currentFrame] != null;
  const easingTarget = hasKf ? resolveEasingTarget(paramKfs, currentFrame) : null;
  const currentEasing = easingTarget ? easingTarget.easing : null;

  const displayValue = useMemo(() => {
    if (!hasKf || !paramKfs) return value;
    const interpolated = interpolateValue(paramKfs, currentFrame);
    return interpolated !== undefined ? interpolated : value;
  }, [hasKf, paramKfs, currentFrame, value]);

  const handleChange = (newValue) => {
    if (onPresetChange) {
      onPresetChange(newValue);
      return;
    }
    if (animEnabled && hasKf) {
      setKeyframe(nodeId, paramDef.id, currentFrame, newValue);
    }
    updateNodeParams(nodeId, { [paramDef.id]: newValue });
  };

  const handleSetKeyframe = (e) => {
    e.stopPropagation();
    const val = displayValue ?? value ?? paramDef.default;
    setKeyframe(nodeId, paramDef.id, currentFrame, val);
  };

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <label
          className="flex-1 text-[11px] font-medium"
          style={{ color: hasKfAtFrame ? '#16a34a' : hasKf ? '#65a30d' : 'var(--text-secondary)' }}
        >
          {paramDef.label}
        </label>
        {animEnabled && isKeyframeable && (
          <button
            onClick={handleSetKeyframe}
            title={
              hasKfAtFrame
                ? `Keyframe set at frame ${currentFrame} — click to update`
                : hasKf
                ? `Animated — click to add keyframe at frame ${currentFrame}`
                : `Set keyframe at frame ${currentFrame}`
            }
            className="flex items-center justify-center rounded hover:bg-bg-tertiary"
            style={{ width: 16, height: 16 }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect
                x="2" y="2" width="6" height="6" rx="0.5"
                transform="rotate(45 5 5)"
                fill={hasKfAtFrame ? '#16a34a' : hasKf ? '#65a30d' : 'none'}
                stroke={hasKfAtFrame ? '#15803d' : hasKf ? '#4d7c0f' : 'var(--text-muted)'}
                strokeWidth="1"
              />
            </svg>
          </button>
        )}
      </div>
      <ParameterInput paramDef={paramDef} value={isKeyframeable ? displayValue : value} onChange={handleChange} nodeId={nodeId} />
      {animEnabled && hasKf && easingTarget && (
        <div className="flex items-center gap-1 mt-0.5">
          <span style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {hasKfAtFrame ? 'Easing:' : `Easing @${easingTarget.frame}:`}
          </span>
          <select
            value={currentEasing}
            onChange={(e) => setKeyframeEasing(nodeId, paramDef.id, easingTarget.frame, e.target.value)}
            style={{
              fontSize: 9,
              height: 18,
              padding: '0 3px',
              borderRadius: 3,
              border: '1px solid var(--border-primary)',
              background: 'var(--bg-primary)',
              color: 'var(--text-secondary)',
              cursor: 'pointer',
              outline: 'none',
            }}
          >
            {EASING_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}

function FontSelect({ options, value, defaultValue, onChange, nodeId, paramId }) {
  const [open, setOpen] = useState(false);
  const [committedValue, setCommittedValue] = useState(value ?? defaultValue);
  const containerRef = useRef(null);
  const listRef = useRef(null);
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);

  useEffect(() => {
    setCommittedValue(value ?? defaultValue);
  }, [value, defaultValue]);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        updateNodeParams(nodeId, { [paramId]: committedValue });
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open, committedValue, nodeId, paramId, updateNodeParams]);

  useEffect(() => {
    if (open && listRef.current) {
      const activeEl = listRef.current.querySelector('[data-active="true"]');
      if (activeEl) activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [open]);

  const handleSelect = useCallback((font) => {
    setCommittedValue(font);
    onChange(font);
    setOpen(false);
  }, [onChange]);

  const handleHover = useCallback((font) => {
    updateNodeParams(nodeId, { [paramId]: font });
  }, [nodeId, paramId, updateNodeParams]);

  const handleMouseLeave = useCallback(() => {
    updateNodeParams(nodeId, { [paramId]: committedValue });
  }, [nodeId, paramId, committedValue, updateNodeParams]);

  const current = value ?? defaultValue;

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full rounded border border-border-primary bg-bg-primary px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent text-left flex items-center justify-between"
        style={{ fontFamily: current }}
      >
        <span className="truncate">{current}</span>
        <svg width="10" height="10" viewBox="0 0 10 10" className="ml-1 shrink-0 opacity-50">
          <path d="M2 4l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <div
          ref={listRef}
          onMouseLeave={handleMouseLeave}
          className="absolute z-50 mt-1 w-full max-h-60 overflow-y-auto rounded border border-border-primary bg-bg-primary shadow-lg"
          style={{ left: 0 }}
        >
          {options.map((font) => (
            <div
              key={font}
              data-active={font === current ? 'true' : undefined}
              onMouseEnter={() => handleHover(font)}
              onClick={() => handleSelect(font)}
              className="px-2 py-1.5 text-xs cursor-pointer hover:bg-accent hover:text-white"
              style={{
                fontFamily: font,
                background: font === committedValue ? 'var(--accent)' : undefined,
                color: font === committedValue ? 'white' : undefined,
              }}
            >
              {font}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ParameterInput({ paramDef, value, onChange, nodeId }) {
  const beginOperation = useGraphStore((s) => s.beginOperation);
  const endOperation = useGraphStore((s) => s.endOperation);

  switch (paramDef.type) {
    case 'number':
      return (
        <div className="flex items-center gap-2">
          <input
            type="range"
            min={paramDef.min ?? 0}
            max={paramDef.max ?? 100}
            step={paramDef.step ?? (paramDef.max > 10 ? 1 : 0.01)}
            value={value ?? paramDef.default}
            onMouseDown={beginOperation}
            onTouchStart={beginOperation}
            onMouseUp={endOperation}
            onTouchEnd={endOperation}
            onChange={(e) => onChange(parseFloat(e.target.value))}
            className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-bg-tertiary accent-accent"
          />
          <input
            type="number"
            min={paramDef.min}
            max={paramDef.max}
            value={value ?? paramDef.default}
            onFocus={beginOperation}
            onBlur={endOperation}
            onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
            className="w-16 rounded border border-border-primary bg-bg-primary px-2 py-1 text-xs text-text-primary outline-none focus:border-accent"
          />
          {paramDef.unit && (
            <span className="shrink-0 text-[10px] text-text-muted" style={{ minWidth: 24 }}>
              {paramDef.unit}
            </span>
          )}
        </div>
      );

    case 'color':
      return (
        <div className="flex items-center gap-2">
          <input
            type="color"
            value={value ?? paramDef.default}
            onChange={(e) => onChange(e.target.value)}
            className="h-7 w-7 cursor-pointer rounded border border-border-primary"
          />
          <input
            type="text"
            value={value ?? paramDef.default}
            onChange={(e) => onChange(e.target.value)}
            className="flex-1 rounded border border-border-primary bg-bg-primary px-2 py-1 text-xs text-text-primary outline-none focus:border-accent"
          />
        </div>
      );

    case 'text':
      return (
        <input
          type="text"
          value={value ?? paramDef.default}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-border-primary bg-bg-primary px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
        />
      );

    case 'boolean':
      return (
        <button
          onClick={() => onChange(!value)}
          className={`
            flex h-7 w-12 items-center rounded-full px-0.5 transition-colors
            ${value ? 'bg-accent' : 'bg-bg-tertiary'}
          `}
        >
          <div
            className={`
              h-6 w-6 rounded-full bg-white shadow transition-transform
              ${value ? 'translate-x-5' : 'translate-x-0'}
            `}
          />
        </button>
      );

    case 'select':
      if (paramDef.id === 'font_family' && nodeId) {
        return (
          <FontSelect
            options={paramDef.options || []}
            value={value}
            defaultValue={paramDef.default}
            onChange={onChange}
            nodeId={nodeId}
            paramId={paramDef.id}
          />
        );
      }
      return (
        <select
          value={value ?? paramDef.default}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-border-primary bg-bg-primary px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
        >
          {(paramDef.options || []).map((opt) => (
            <option key={opt} value={opt}>{opt}</option>
          ))}
        </select>
      );

    case 'code':
      return (
        <textarea
          value={value ?? paramDef.default}
          onChange={(e) => onChange(e.target.value)}
          rows={8}
          spellCheck={false}
          className="w-full rounded border border-border-primary bg-bg-primary px-2 py-1.5 font-mono text-xs text-text-primary outline-none focus:border-accent"
        />
      );

    case 'file':
      return (
        <div className="flex flex-col gap-2">
          <label
            className="flex cursor-pointer items-center justify-center rounded border border-dashed border-border-primary bg-bg-secondary px-3 py-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent hover:text-accent"
          >
            {value ? 'Replace file...' : 'Choose SVG, PNG or JPEG...'}
            <input
              type="file"
              accept=".svg,.png,.jpg,.jpeg,image/svg+xml,image/png,image/jpeg"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => onChange(reader.result);
                reader.readAsDataURL(file);
              }}
            />
          </label>
          {value && (
            <div className="flex items-center gap-2">
              <span className="flex-1 truncate text-[10px] text-text-muted">File loaded</span>
              <button
                onClick={() => onChange('')}
                className="text-[10px] text-red-400 hover:text-red-300"
              >
                Clear
              </button>
            </div>
          )}
        </div>
      );

    default:
      return (
        <input
          type="text"
          value={String(value ?? paramDef.default ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded border border-border-primary bg-bg-primary px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
        />
      );
  }
}

function CornerSelector({ value, nodeId, sourceGeometry }) {
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);

  const allPoints = useMemo(() => extractPoints(sourceGeometry), [sourceGeometry]);
  const sharpPoints = useMemo(() => allPoints.filter((p) => p.sharp), [allPoints]);
  const totalSharp = sharpPoints.length || 4;

  const sel = value ?? '';
  const selected = parseCornerSelection(sel, sharpPoints);

  const toggleCorner = (originalIdx) => {
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
  };

  const selectAll = () => {
    updateNodeParams(nodeId, { point_selection: '*' });
  };

  const selectNone = () => {
    updateNodeParams(nodeId, { point_selection: '' });
  };

  const isSimpleRect = sharpPoints.length === 4 && (sourceGeometry?.type === 'rect' || sourceGeometry?.type === 'roundedRect');

  return (
    <div className="flex flex-col gap-2">
      <label className="text-[11px] font-medium text-text-secondary">
        Point Selection
        <span className="ml-1 font-normal text-text-muted">({selected.size}/{totalSharp})</span>
      </label>
      <span className="text-[10px] text-text-muted">
        Click points in the viewport or toggle below
      </span>

      {isSimpleRect ? (
        <div className="relative mx-auto h-20 w-28 rounded-lg border-2 border-dashed border-border-primary" style={{ marginTop: 12, marginBottom: 12 }}>
          {sharpPoints.map((pt, i) => {
            const isOn = selected.has(pt.idx);
            const labels = ['TL', 'TR', 'BR', 'BL'];
            const positions = [
              'top-0 left-0 -translate-x-1/2 -translate-y-1/2',
              'top-0 right-0 translate-x-1/2 -translate-y-1/2',
              'bottom-0 right-0 translate-x-1/2 translate-y-1/2',
              'bottom-0 left-0 -translate-x-1/2 translate-y-1/2',
            ];
            return (
              <button
                key={pt.idx}
                onClick={() => toggleCorner(pt.idx)}
                className={`absolute ${positions[i]} flex h-6 w-6 items-center justify-center rounded-full text-[8px] font-bold transition-colors ${
                  isOn
                    ? 'bg-accent text-white'
                    : 'bg-bg-tertiary text-text-muted border border-border-primary'
                }`}
                title={`Corner ${pt.idx} (${labels[i] || pt.idx})`}
              >
                {pt.idx}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {sharpPoints.map((pt) => {
            const isOn = selected.has(pt.idx);
            return (
              <button
                key={pt.idx}
                onClick={() => toggleCorner(pt.idx)}
                className={`flex h-6 w-6 items-center justify-center rounded-full text-[7px] font-bold transition-colors ${
                  isOn
                    ? 'bg-accent text-white'
                    : 'bg-bg-tertiary text-text-muted border border-border-primary'
                }`}
                title={`Point ${pt.idx}`}
              >
                {pt.idx}
              </button>
            );
          })}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={selectAll}
          className="flex-1 rounded border border-border-primary bg-bg-tertiary text-[10px] text-text-secondary hover:bg-border-primary"
          style={{ padding: '8px 20px' }}
        >
          All
        </button>
        <button
          onClick={selectNone}
          className="flex-1 rounded border border-border-primary bg-bg-tertiary text-[10px] text-text-secondary hover:bg-border-primary"
          style={{ padding: '8px 20px' }}
        >
          None
        </button>
      </div>
    </div>
  );
}

function parseCornerSelection(sel, sharpPoints = []) {
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

function DimensionList({ nodeId, value, units }) {
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);
  const beginOperation = useGraphStore((s) => s.beginOperation);
  const endOperation = useGraphStore((s) => s.endOperation);

  const dims = useMemo(() => {
    try { const v = JSON.parse(value || '[]'); return Array.isArray(v) ? v : []; }
    catch { return []; }
  }, [value]);

  const setValue = (id, raw) => {
    const num = parseFloat(raw);
    const next = dims.map((d) => {
      if (d.id !== id) return d;
      const isAngle = d.kind === 'angle';
      const valid = isFinite(num) && (isAngle || num > 0);
      return { ...d, value: valid ? num : d.value };
    });
    beginOperation();
    updateNodeParams(nodeId, { dimensions: JSON.stringify(next) });
    endOperation();
  };

  const remove = (id) => {
    beginOperation();
    updateNodeParams(nodeId, { dimensions: JSON.stringify(dims.filter((d) => d.id !== id)) });
    endOperation();
  };

  const kindLabel = (d) => {
    if (d.kind === 'radius') return 'Radius';
    if (d.kind === 'diameter') return 'Diameter';
    if (d.kind === 'angle') return 'Angle';
    if (d.kind === 'relation') return d.relation === 'vertical' ? 'Vertical ⟂' : 'Horizontal —';
    if (d.axis === 'horizontal') return 'Horizontal';
    if (d.axis === 'vertical') return 'Vertical';
    return 'Length';
  };

  return (
    <div className="mb-3">
      <label className="mb-1 block text-xs font-medium text-text-secondary">Dimensions</label>
      {dims.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5 }}>
          Select this node, then use the toolbar in the viewport to add dimensions.
          Pick points to dimension, then double-click a value on the canvas to drive the shape.
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {dims.map((d) => (
            <div key={d.id} className="flex items-center gap-2">
              <span style={{ fontSize: 10, color: 'var(--text-muted)', width: 80, flexShrink: 0 }}>
                {kindLabel(d)}
              </span>
              {d.kind === 'relation' ? (
                <span style={{ fontSize: 11, color: 'var(--text-muted)', flex: 1 }}>locked</span>
              ) : (
                <input
                  type="number"
                  value={d.value ?? ''}
                  onFocus={beginOperation}
                  onBlur={endOperation}
                  onChange={(e) => setValue(d.id, e.target.value)}
                  className="w-20 rounded border border-border-primary bg-bg-primary px-2 py-1 text-xs text-text-primary outline-none focus:border-accent"
                />
              )}
              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                {d.kind === 'angle' ? '\u00b0' : (d.kind === 'relation' ? '' : (units || ''))}
              </span>
              <button
                onClick={() => remove(d.id)}
                title="Remove dimension"
                style={{
                  marginLeft: 'auto', fontSize: 11, lineHeight: 1, width: 20, height: 20,
                  borderRadius: 4, border: '1px solid var(--border-primary)',
                  background: 'var(--bg-primary)', color: 'var(--text-muted)', cursor: 'pointer',
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PointOffsetSlider({ paramDef, value, nodeId, params }) {
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);
  const beginOperation = useGraphStore((s) => s.beginOperation);
  const endOperation = useGraphStore((s) => s.endOperation);
  const animEnabled = useAnimationStore((s) => s.enabled);
  const currentFrame = useAnimationStore((s) => s.currentFrame);
  const setKeyframe = useAnimationStore((s) => s.setKeyframe);
  const setKeyframeEasing = useAnimationStore((s) => s.setKeyframeEasing);
  const allKeyframes = useAnimationStore((s) => s.keyframes);

  const isKeyframeable = paramDef.type === 'number';
  const paramKfs = allKeyframes[nodeId]?.[paramDef.id];
  const hasKf = isKeyframeable && paramKfs && Object.keys(paramKfs).length > 0;
  const hasKfAtFrame = hasKf && paramKfs[currentFrame] != null;
  const easingTarget = hasKf ? resolveEasingTarget(paramKfs, currentFrame) : null;
  const currentEasing = easingTarget ? easingTarget.easing : null;

  const displayValue = useMemo(() => {
    if (!hasKf || !paramKfs) return value;
    const interpolated = interpolateValue(paramKfs, currentFrame);
    return interpolated !== undefined ? interpolated : value;
  }, [hasKf, paramKfs, currentFrame, value]);

  const handleChange = (newValue) => {
    if (animEnabled && hasKf) {
      setKeyframe(nodeId, paramDef.id, currentFrame, newValue);
      updateNodeParams(nodeId, { [paramDef.id]: newValue });
      return;
    }

    const offsets = (() => {
      try { return JSON.parse(params.point_offsets || '{}'); }
      catch { return {}; }
    })();

    const selectedIndices = (params.scale_points || '')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);

    if (selectedIndices.length > 0) {
      const axis = paramDef.id === 'offset_x' ? 0 : 1;
      const newOffsets = { ...offsets };
      for (const idx of selectedIndices) {
        if (!newOffsets[idx]) newOffsets[idx] = [0, 0];
        newOffsets[idx] = [...newOffsets[idx]];
        newOffsets[idx][axis] = newValue;
      }
      updateNodeParams(nodeId, {
        [paramDef.id]: newValue,
        point_offsets: JSON.stringify(newOffsets),
      });
    } else {
      updateNodeParams(nodeId, { [paramDef.id]: newValue });
    }
  };

  const handleSetKeyframe = (e) => {
    e.stopPropagation();
    const val = displayValue ?? value ?? paramDef.default;
    setKeyframe(nodeId, paramDef.id, currentFrame, val);

    const selectedIndices = (params.scale_points || '')
      .split(',')
      .map(x => x.trim())
      .filter(Boolean);
    if (selectedIndices.length > 0) {
      const stored = (() => {
        try { return JSON.parse(params.point_offsets || '{}'); }
        catch { return {}; }
      })();
      const cleaned = { ...stored };
      for (const idx of selectedIndices) delete cleaned[idx];
      updateNodeParams(nodeId, { point_offsets: JSON.stringify(cleaned) });
    }
  };  const sliderValue = isKeyframeable ? (displayValue ?? value ?? paramDef.default) : (value ?? paramDef.default);

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <label
          className="flex-1 text-[11px] font-medium"
          style={{ color: hasKfAtFrame ? '#16a34a' : hasKf ? '#65a30d' : 'var(--text-secondary)' }}
        >
          {paramDef.label}
        </label>
        {animEnabled && isKeyframeable && (
          <button
            onClick={handleSetKeyframe}
            title={
              hasKfAtFrame
                ? `Keyframe set at frame ${currentFrame} — click to update`
                : hasKf
                ? `Animated — click to add keyframe at frame ${currentFrame}`
                : `Set keyframe at frame ${currentFrame}`
            }
            className="flex items-center justify-center rounded hover:bg-bg-tertiary"
            style={{ width: 16, height: 16 }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10">
              <rect
                x="2" y="2" width="6" height="6" rx="0.5"
                transform="rotate(45 5 5)"
                fill={hasKfAtFrame ? '#16a34a' : hasKf ? '#65a30d' : 'none'}
                stroke={hasKfAtFrame ? '#15803d' : hasKf ? '#4d7c0f' : 'var(--text-muted)'}
                strokeWidth="1"
              />
            </svg>
          </button>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={paramDef.min ?? -500}
          max={paramDef.max ?? 500}
          step={0.01}
          value={sliderValue}
          onMouseDown={beginOperation}
          onTouchStart={beginOperation}
          onMouseUp={endOperation}
          onTouchEnd={endOperation}
          onChange={(e) => handleChange(parseFloat(e.target.value))}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-bg-tertiary accent-accent"
        />
        <input
          type="number"
          min={paramDef.min}
          max={paramDef.max}
          value={sliderValue}
          onFocus={beginOperation}
          onBlur={endOperation}
          onChange={(e) => handleChange(parseFloat(e.target.value) || 0)}
          className="w-16 rounded border border-border-primary bg-bg-primary px-2 py-1 text-xs text-text-primary outline-none focus:border-accent"
        />
      </div>
      {animEnabled && hasKf && easingTarget && (
        <div className="flex items-center gap-1 mt-0.5">
          <span style={{ fontSize: 9, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
            {hasKfAtFrame ? 'Easing:' : `Easing @${easingTarget.frame}:`}
          </span>
          <select
            value={currentEasing}
            onChange={(e) => setKeyframeEasing(nodeId, paramDef.id, easingTarget.frame, e.target.value)}
            style={{
              fontSize: 9, height: 18, padding: '0 3px', borderRadius: 3,
              border: '1px solid var(--border-primary)', background: 'var(--bg-primary)',
              color: 'var(--text-secondary)', cursor: 'pointer', outline: 'none',
            }}
          >
            {EASING_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
