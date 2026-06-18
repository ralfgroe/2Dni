import { memo, useCallback } from 'react';
import { Handle, Position } from 'reactflow';
import { useNodeRegistryStore } from '../../store/nodeRegistryStore';
import { useGraphStore } from '../../store/graphStore';

const NODE_WIDTH = 200;

// Picks black or white text for legibility against a given hex background.
function readableTextColor(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return '#1a1a2e';
  const n = parseInt(m[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6 ? '#1a1a2e' : '#ffffff';
}

export default memo(function GraphNode({ id, data, selected }) {
  const definition = useNodeRegistryStore((s) => s.getDefinition)(data.definitionId);
  const displayNodeId = useGraphStore((s) => s.displayNodeId);
  const toggleBypass = useGraphStore((s) => s.toggleBypass);
  const toggleTemplate = useGraphStore((s) => s.toggleTemplate);
  const setDisplayNode = useGraphStore((s) => s.setDisplayNode);
  const selectNode = useGraphStore((s) => s.selectNode);

  const isBypassed = data.bypassed;
  const isTemplated = data.templated;
  const isDisplay = displayNodeId === id;

  const handleBypassClick = useCallback((e) => {
    e.stopPropagation();
    selectNode(id);
    toggleBypass(id);
  }, [id, selectNode, toggleBypass]);

  const handleTemplateClick = useCallback((e) => {
    e.stopPropagation();
    selectNode(id);
    toggleTemplate(id);
  }, [id, selectNode, toggleTemplate]);

  const handleDisplayClick = useCallback((e) => {
    e.stopPropagation();
    selectNode(id);
    setDisplayNode(id);
  }, [id, selectNode, setDisplayNode]);

  if (!definition) return null;

  const { inputs, outputs } = definition;
  const hasMultiplePorts = inputs.length > 1 && outputs.length > 1;

  // Optional per-node overrides (used by the Null node, but generic): a custom
  // display name and a title-bar tint to mark special points in the flow.
  const params = data.params || {};
  const customName = typeof params.node_name === 'string' ? params.node_name.trim() : '';
  const titleLabel = customName || definition.label;
  const nodeColor = typeof params.node_color === 'string' ? params.node_color.trim() : '';
  const useTint = nodeColor && nodeColor.toLowerCase() !== '#ffffff' && nodeColor !== 'none';
  const titleStyle = useTint
    ? { backgroundColor: nodeColor, color: readableTextColor(nodeColor) }
    : undefined;

  const inputPositions = hasMultiplePorts
    ? inputs.map((_, i) => 35 + i * 30)
    : null;
  const outputPositions = hasMultiplePorts
    ? outputs.map((_, i) => 35 + i * 30)
    : null;

  return (
    <div
      className={`graph-node-houdini ${selected ? 'selected' : ''} ${isBypassed ? 'bypassed' : ''}`}
      style={{ width: NODE_WIDTH }}
    >
      {/* Input ports — top */}
      {hasMultiplePorts ? (
        inputs.map((input, i) => (
          <Handle
            key={input.id}
            type="target"
            position={Position.Top}
            id={input.id}
            className={i === 0 ? 'graph-port-top' : 'graph-port-top-extra'}
            style={{ left: `${inputPositions[i]}%` }}
          />
        ))
      ) : (
        <>
          {inputs[0] && (
            <Handle
              type="target"
              position={Position.Top}
              id={inputs[0].id}
              className="graph-port-top"
            />
          )}
          {inputs.slice(1).map((input, i) => (
            <Handle
              key={input.id}
              type="target"
              position={Position.Top}
              id={input.id}
              className="graph-port-top-extra"
              style={{ left: `${65 + i * 18}%` }}
            />
          ))}
        </>
      )}

      {/* Node body */}
      <div className="graph-node-body-houdini">
        <button
          className={`graph-flag bypass-flag ${isBypassed ? 'active' : ''}`}
          onClick={handleBypassClick}
          title={isBypassed ? 'Enable node' : 'Bypass node'}
        />
        <div style={{ width: '2px', height: '100%', backgroundColor: '#1a1a2e', flexShrink: 0 }} />
        <button
          className={`graph-flag template-flag ${isTemplated ? 'active' : ''}`}
          onClick={handleTemplateClick}
          title={isTemplated ? 'Remove template' : 'Show as template'}
        />
        <div style={{ width: '2px', height: '100%', backgroundColor: '#1a1a2e', flexShrink: 0 }} />
        <div className="graph-node-title" style={titleStyle}>
          {titleLabel}
        </div>
        <div style={{ width: '2px', height: '100%', backgroundColor: '#1a1a2e', flexShrink: 0 }} />
        <button
          className={`graph-flag display-flag ${isDisplay ? 'active' : ''}`}
          onClick={handleDisplayClick}
          title={isDisplay ? 'Remove display flag' : 'Set as display node'}
        />
      </div>

      {/* Output ports — bottom */}
      {hasMultiplePorts ? (
        outputs.map((output, i) => (
          <Handle
            key={output.id}
            type="source"
            position={Position.Bottom}
            id={output.id}
            className={i === 0 ? 'graph-port-bottom' : 'graph-port-bottom-extra'}
            style={{ left: `${outputPositions[i]}%` }}
          />
        ))
      ) : outputs.length === 1 ? (
        <Handle
          key={outputs[0].id}
          type="source"
          position={Position.Bottom}
          id={outputs[0].id}
          className="graph-port-bottom"
        />
      ) : (
        outputs.map((output, i) => {
          const pos = outputs.length === 1 ? 50 : 25 + (i * 50) / (outputs.length - 1);
          return (
            <Handle
              key={output.id}
              type="source"
              position={Position.Bottom}
              id={output.id}
              className="graph-port-bottom-extra"
              style={{ left: `${pos}%` }}
            />
          );
        })
      )}
    </div>
  );
});
