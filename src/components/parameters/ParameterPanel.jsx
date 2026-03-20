import { useMemo } from 'react';
import { useGraphStore } from '../../store/graphStore';
import { useNodeRegistryStore } from '../../store/nodeRegistryStore';
import { evaluateGraph } from '../../utils/evaluateGraph';
import { exportSVG, exportPNG } from '../../utils/exportUtils';
import { extractPoints } from '../../utils/geometryPoints';
import WrangleChat from './WrangleChat';

export default function ParameterPanel() {
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const displayNodeId = useGraphStore((s) => s.displayNodeId);
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);
  const definitions = useNodeRegistryStore((s) => s.definitions);
  const getDefinition = useNodeRegistryStore((s) => s.getDefinition);

  const selectedNode = nodes.find((n) => n.id === selectedNodeId);
  const definition = selectedNode
    ? getDefinition(selectedNode.data.definitionId)
    : null;

  const results = useMemo(
    () => evaluateGraph(nodes, edges, definitions, displayNodeId),
    [nodes, edges, definitions, displayNodeId]
  );

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

  const handleExport = () => {
    const geo = results.get(selectedNode.id);
    if (!geo) return;
    const sourceGeo = geo.geometry || geo;
    if (params.format === 'png') {
      exportPNG(sourceGeo, { ...params, canvasWidth: params.canvas_width, canvasHeight: params.canvas_height, backgroundColor: params.background_color });
    } else {
      exportSVG(sourceGeo, { ...params, canvasWidth: params.canvas_width, canvasHeight: params.canvas_height, backgroundColor: params.background_color });
    }
  };

  return (
    <div className="flex h-full w-full flex-col overflow-y-auto overflow-x-hidden bg-bg-primary" style={{ padding: '12px 14px 0 26px' }}>
      {/* Header */}
      <div className="shrink-0 border-b border-border-primary pb-3 pt-10">
        <h2 className="text-sm font-semibold text-text-primary">{definition.label}</h2>
        <span className="text-[11px] text-text-muted">{definition.category}</span>
      </div>

      {/* Parameter list */}
      <div className="flex flex-col gap-3 py-4">
        {definition.parameters.map((paramDef) => {
          if (definition.id === 'circle') {
            const separateXY = params.separate_xy;
            if (!separateXY && (paramDef.id === 'diameter_x' || paramDef.id === 'diameter_y')) return null;
            if (separateXY && paramDef.id === 'diameter') return null;
          }
          if (definition.id === 'geometricstar') {
            if (params.preset !== 'Custom' && paramDef.id === 'points') return null;
            if (!params.tile && (paramDef.id === 'grid_type' || paramDef.id === 'rings')) return null;
          }
          if (definition.id === 'radius' && paramDef.id === 'point_selection') {
            const sourceEdge = edges.find((e) => e.target === selectedNode.id && e.targetHandle === 'geometry_in');
            const sourceGeo = sourceEdge ? results.get(sourceEdge.source) : null;
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
            const sourceEdge = edges.find((e) => e.target === selectedNode.id && e.targetHandle === 'geometry_in');
            const sourceGeo = sourceEdge ? results.get(sourceEdge.source) : null;
            return (
              <div key="pivot_group" style={{ paddingTop: 30 }}>
                <div style={{ marginBottom: 12 }} className="flex items-center gap-2">
                  <button
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-primary bg-bg-secondary text-[10px] text-text-secondary hover:bg-bg-tertiary"
                    title="Center Pivot"
                    onClick={() => {
                      if (!sourceGeo) return;
                      const b = sourceGeo.bounds || (sourceGeo.type === 'rect' || sourceGeo.type === 'roundedRect'
                        ? { x: sourceGeo.x, y: sourceGeo.y, width: sourceGeo.width, height: sourceGeo.height }
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
            />
          );
        })}

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
          const inputGeo = sourceEdge ? results.get(sourceEdge.source) : null;
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

function ParameterRow({ paramDef, value, nodeId }) {
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);

  const handleChange = (newValue) => {
    updateNodeParams(nodeId, { [paramDef.id]: newValue });
  };

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium text-text-secondary">
        {paramDef.label}
      </label>
      <ParameterInput paramDef={paramDef} value={value} onChange={handleChange} />
    </div>
  );
}

function ParameterInput({ paramDef, value, onChange }) {
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
            step={paramDef.max > 10 ? 1 : 0.01}
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

function PointOffsetSlider({ paramDef, value, nodeId, params }) {
  const updateNodeParams = useGraphStore((s) => s.updateNodeParams);
  const beginOperation = useGraphStore((s) => s.beginOperation);
  const endOperation = useGraphStore((s) => s.endOperation);

  const handleChange = (newValue) => {
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

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[11px] font-medium text-text-secondary">
        {paramDef.label}
      </label>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={paramDef.min ?? -500}
          max={paramDef.max ?? 500}
          step={0.01}
          value={value ?? paramDef.default}
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
          value={value ?? paramDef.default}
          onFocus={beginOperation}
          onBlur={endOperation}
          onChange={(e) => handleChange(parseFloat(e.target.value) || 0)}
          className="w-16 rounded border border-border-primary bg-bg-primary px-2 py-1 text-xs text-text-primary outline-none focus:border-accent"
        />
      </div>
    </div>
  );
}
