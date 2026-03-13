import { memo, useCallback } from 'react';
import { Handle, Position } from 'reactflow';
import { useNodeRegistryStore } from '../../store/nodeRegistryStore';
import { useGraphStore } from '../../store/graphStore';

const NODE_WIDTH = 200;

export default memo(function GraphNode({ id, data, selected }) {
  const definition = useNodeRegistryStore((s) => s.getDefinition)(data.definitionId);
  const displayNodeId = useGraphStore((s) => s.displayNodeId);
  const toggleBypass = useGraphStore((s) => s.toggleBypass);
  const toggleTemplate = useGraphStore((s) => s.toggleTemplate);
  const setDisplayNode = useGraphStore((s) => s.setDisplayNode);

  const isBypassed = data.bypassed;
  const isTemplated = data.templated;
  const isDisplay = displayNodeId === id;

  const handleBypassClick = useCallback((e) => {
    e.stopPropagation();
    toggleBypass(id);
  }, [id, toggleBypass]);

  const handleTemplateClick = useCallback((e) => {
    e.stopPropagation();
    toggleTemplate(id);
  }, [id, toggleTemplate]);

  const handleDisplayClick = useCallback((e) => {
    e.stopPropagation();
    setDisplayNode(id);
  }, [id, setDisplayNode]);

  if (!definition) return null;

  const { inputs, outputs } = definition;
  const primaryInput = inputs[0];
  const extraInputs = inputs.slice(1);

  return (
    <div
      className={`graph-node-houdini ${selected ? 'selected' : ''} ${isBypassed ? 'bypassed' : ''}`}
      style={{ width: NODE_WIDTH }}
    >
      {/* Primary input port — top center */}
      {primaryInput && (
        <Handle
          type="target"
          position={Position.Top}
          id={primaryInput.id}
          className="graph-port-top"
        />
      )}

      {/* Extra input ports — top right area */}
      {extraInputs.map((input, i) => (
        <Handle
          key={input.id}
          type="target"
          position={Position.Top}
          id={input.id}
          className="graph-port-top-extra"
          style={{
            left: `${65 + i * 18}%`,
          }}
        />
      ))}

      {/* Node body */}
      <div className="graph-node-body-houdini">
        {/* Bypass flag — left side */}
        <button
          className={`graph-flag bypass-flag ${isBypassed ? 'active' : ''}`}
          onClick={handleBypassClick}
          title={isBypassed ? 'Enable node' : 'Bypass node'}
        />

        {/* Separator */}
        <div style={{ width: '2px', height: '100%', backgroundColor: '#1a1a2e', flexShrink: 0 }} />

        {/* Template flag — next to bypass */}
        <button
          className={`graph-flag template-flag ${isTemplated ? 'active' : ''}`}
          onClick={handleTemplateClick}
          title={isTemplated ? 'Remove template' : 'Show as template'}
        />

        {/* Separator — left of title */}
        <div style={{ width: '2px', height: '100%', backgroundColor: '#1a1a2e', flexShrink: 0 }} />

        {/* Node title */}
        <div className="graph-node-title">
          {definition.label}
        </div>

        {/* Separator — right of title */}
        <div style={{ width: '2px', height: '100%', backgroundColor: '#1a1a2e', flexShrink: 0 }} />

        {/* Display flag — right side */}
        <button
          className={`graph-flag display-flag ${isDisplay ? 'active' : ''}`}
          onClick={handleDisplayClick}
          title={isDisplay ? 'Remove display flag' : 'Set as display node'}
        />
      </div>

      {/* Output port — bottom center */}
      {outputs.map((output) => (
        <Handle
          key={output.id}
          type="source"
          position={Position.Bottom}
          id={output.id}
          className="graph-port-bottom"
        />
      ))}
    </div>
  );
});
