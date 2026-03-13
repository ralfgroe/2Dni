import { useCallback, useState, useRef, useMemo } from 'react';
import ReactFlow, {
  Background,
  Controls,
  MiniMap,
  addEdge as rfAddEdge,
  applyNodeChanges,
  applyEdgeChanges,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useGraphStore } from '../../store/graphStore';
import { useNodeRegistryStore } from '../../store/nodeRegistryStore';
import { useThemeStore } from '../../store/themeStore';
import GraphNode from './GraphNode';
import NodeSearchPalette from './NodeSearchPalette';
import { getPortColor } from '../../utils/portColors';

const nodeTypes = { _custom: GraphNode };

export default function NodeGraph() {
  const reactFlowWrapper = useRef(null);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [palette, setPalette] = useState(null);
  const mousePos = useRef({ x: 0, y: 0 });
  const pendingConnection = useRef(null);

  const theme = useThemeStore((s) => s.theme);

  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const setNodes = useGraphStore((s) => s.setNodes);
  const setEdges = useGraphStore((s) => s.setEdges);
  const selectNode = useGraphStore((s) => s.selectNode);
  const addNode = useGraphStore((s) => s.addNode);
  const duplicateNode = useGraphStore((s) => s.duplicateNode);

  const getDefinition = useNodeRegistryStore((s) => s.getDefinition);

  const clipboardRef = useRef(null);

  const rfNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        type: '_custom',
        selected: n.id === selectedNodeId,
      })),
    [nodes, selectedNodeId]
  );

  const onNodesChange = useCallback(
    (changes) => {
      setNodes(applyNodeChanges(changes, nodes));

      for (const change of changes) {
        if (change.type === 'select' && change.selected) {
          selectNode(change.id);
        }
      }
    },
    [nodes, setNodes, selectNode]
  );

  const onEdgesChange = useCallback(
    (changes) => {
      setEdges(applyEdgeChanges(changes, edges));
    },
    [edges, setEdges]
  );

  const onConnect = useCallback(
    (connection) => {
      setEdges(rfAddEdge(connection, edges));
    },
    [edges, setEdges]
  );

  const onConnectStart = useCallback((event, params) => {
    pendingConnection.current = params;
  }, []);

  const onConnectEnd = useCallback(
    (event) => {
      if (!pendingConnection.current) return;

      const targetIsPane = event.target.classList.contains('react-flow__pane');
      if (!targetIsPane) {
        pendingConnection.current = null;
        return;
      }

      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!bounds) return;

      const screenPos = {
        x: event.clientX - bounds.left,
        y: event.clientY - bounds.top,
      };
      const flowPos = reactFlowInstance?.screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      }) || { x: 0, y: 0 };

      setPalette({
        screen: screenPos,
        flow: flowPos,
        pendingConnection: pendingConnection.current,
      });
    },
    [reactFlowInstance]
  );

  const handlePaletteSelect = useCallback(
    (definition) => {
      const position = palette?.flow || { x: 0, y: 0 };
      const newNodeId = addNode(definition, position);

      if (palette?.pendingConnection && newNodeId) {
        const pending = palette.pendingConnection;
        const newDef = getDefinition(definition.id);

        if (pending.handleType === 'source') {
          const targetInput = newDef?.inputs?.[0];
          if (targetInput) {
            const connection = {
              source: pending.nodeId,
              sourceHandle: pending.handleId,
              target: newNodeId,
              targetHandle: targetInput.id,
            };
            setEdges(rfAddEdge(connection, useGraphStore.getState().edges));
          }
        } else {
          const sourceOutput = newDef?.outputs?.[0];
          if (sourceOutput) {
            const connection = {
              source: newNodeId,
              sourceHandle: sourceOutput.id,
              target: pending.nodeId,
              targetHandle: pending.handleId,
            };
            setEdges(rfAddEdge(connection, useGraphStore.getState().edges));
          }
        }
      }

      pendingConnection.current = null;
      setPalette(null);
    },
    [addNode, palette, getDefinition, setEdges]
  );

  const handleMouseMove = useCallback((event) => {
    mousePos.current = { x: event.clientX, y: event.clientY };
  }, []);

  const onPaneClick = useCallback(() => {
    selectNode(null);
    setPalette(null);
    pendingConnection.current = null;
  }, [selectNode]);

  const onEdgeClick = useCallback(() => {
    selectNode(null);
  }, [selectNode]);

  const onPaneContextMenu = useCallback(
    (event) => {
      event.preventDefault();
      const bounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!bounds) return;
      setPalette({
        screen: { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        flow: reactFlowInstance?.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        }) || { x: 0, y: 0 },
      });
    },
    [reactFlowInstance]
  );

  const handleKeyDown = useCallback(
    (event) => {
      const isCtrlOrCmd = event.ctrlKey || event.metaKey;

      if (isCtrlOrCmd && event.key === 'c') {
        if (selectedNodeId) {
          clipboardRef.current = selectedNodeId;
        }
        return;
      }

      if (isCtrlOrCmd && event.key === 'v') {
        if (clipboardRef.current) {
          duplicateNode(clipboardRef.current);
        }
        return;
      }

      if (event.key === 'Tab') {
        event.preventDefault();
        const bounds = reactFlowWrapper.current?.getBoundingClientRect();
        if (!bounds) return;

        const mx = mousePos.current.x;
        const my = mousePos.current.y;
        const inBounds =
          mx >= bounds.left && mx <= bounds.right &&
          my >= bounds.top && my <= bounds.bottom;

        const screenPos = inBounds
          ? { x: mx - bounds.left, y: my - bounds.top }
          : { x: bounds.width / 2, y: bounds.height / 2 };

        const flowPos = reactFlowInstance?.screenToFlowPosition({
          x: inBounds ? mx : bounds.left + bounds.width / 2,
          y: inBounds ? my : bounds.top + bounds.height / 2,
        }) || { x: 0, y: 0 };

        setPalette({ screen: screenPos, flow: flowPos, pendingConnection: pendingConnection.current || null });
      }
    },
    [reactFlowInstance, selectedNodeId, duplicateNode]
  );

  const isValidConnection = useCallback(
    (connection) => {
      const sourceNode = nodes.find((n) => n.id === connection.source);
      const targetNode = nodes.find((n) => n.id === connection.target);
      if (!sourceNode || !targetNode) return false;

      const sourceDef = getDefinition(sourceNode.data.definitionId);
      const targetDef = getDefinition(targetNode.data.definitionId);
      if (!sourceDef || !targetDef) return false;

      const sourcePort = sourceDef.outputs.find((o) => o.id === connection.sourceHandle);
      const targetPort = targetDef.inputs.find((i) => i.id === connection.targetHandle);
      if (!sourcePort || !targetPort) return false;

      if (sourcePort.type === 'any' || targetPort.type === 'any') return true;
      return sourcePort.type === targetPort.type;
    },
    [nodes, getDefinition]
  );

  const defaultEdgeOptions = useMemo(
    () => ({
      type: 'default',
      animated: false,
      style: { strokeWidth: 2, stroke: 'var(--accent)' },
      interactionWidth: 20,
    }),
    []
  );

  const getClosestEdge = useCallback(
    (node) => {
      if (!reactFlowInstance) return null;
      const NODE_W = 150;
      const NODE_H = 40;
      const nodeCenterX = node.position.x + NODE_W / 2;
      const nodeCenterY = node.position.y + NODE_H / 2;
      const THRESHOLD = 50;

      let closest = null;
      let closestDist = THRESHOLD;

      for (const edge of edges) {
        const sourceNode = nodes.find((n) => n.id === edge.source);
        const targetNode = nodes.find((n) => n.id === edge.target);
        if (!sourceNode || !targetNode) continue;
        if (edge.source === node.id || edge.target === node.id) continue;

        const sx = sourceNode.position.x + NODE_W / 2;
        const sy = sourceNode.position.y + NODE_H;
        const tx = targetNode.position.x + NODE_W / 2;
        const ty = targetNode.position.y;

        const dist = pointToSegmentDist(nodeCenterX, nodeCenterY, sx, sy, tx, ty);
        if (dist < closestDist) {
          closestDist = dist;
          closest = edge;
        }
      }
      return closest;
    },
    [edges, nodes, reactFlowInstance]
  );

  const onNodeDragStop = useCallback(
    (event, draggedNode) => {
      const edge = getClosestEdge(draggedNode);
      if (!edge) return;

      const droppedNode = nodes.find((n) => n.id === draggedNode.id);
      if (!droppedNode) return;
      const droppedDef = getDefinition(droppedNode.data.definitionId);
      if (!droppedDef) return;

      const firstInput = droppedDef.inputs?.[0];
      const firstOutput = droppedDef.outputs?.[0];
      if (!firstInput || !firstOutput) return;

      const currentEdges = useGraphStore.getState().edges;
      const withoutOld = currentEdges.filter((e) => e.id !== edge.id);

      const edgeToNew = {
        id: `edge_${Date.now()}_a`,
        source: edge.source,
        sourceHandle: edge.sourceHandle,
        target: draggedNode.id,
        targetHandle: firstInput.id,
      };
      const edgeFromNew = {
        id: `edge_${Date.now()}_b`,
        source: draggedNode.id,
        sourceHandle: firstOutput.id,
        target: edge.target,
        targetHandle: edge.targetHandle,
      };

      setEdges([...withoutOld, edgeToNew, edgeFromNew]);
    },
    [getClosestEdge, nodes, getDefinition, setEdges]
  );

  return (
    <div
      ref={reactFlowWrapper}
      className="relative h-full w-full"
      onKeyDown={handleKeyDown}
      onMouseMove={handleMouseMove}
      tabIndex={0}
    >
      <ReactFlow
        nodes={rfNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        onNodeDragStop={onNodeDragStop}
        onPaneClick={onPaneClick}
        onEdgeClick={onEdgeClick}
        onPaneContextMenu={onPaneContextMenu}
        onInit={setReactFlowInstance}
        isValidConnection={isValidConnection}
        defaultEdgeOptions={defaultEdgeOptions}
        edgesFocusable
        fitView={false}
        deleteKeyCode="Delete"
        className="nodegraph-flow"
        proOptions={{ hideAttribution: true }}
      >
        <Background
          color={theme === 'dark' ? '#373a40' : '#dee2e6'}
          gap={20}
          size={1}
        />
        <Controls
          className="nodegraph-controls"
          showInteractive={false}
        />
        <MiniMap
          className="nodegraph-minimap"
          nodeColor={(n) => {
            if (n.data?.bypassed) return '#868e96';
            const def = getDefinition(n.data?.definitionId);
            if (!def) return '#868e96';
            const firstOutput = def.outputs[0];
            return firstOutput ? getPortColor(firstOutput.type) : '#868e96';
          }}
          maskColor={theme === 'dark' ? 'rgba(0,0,0,0.6)' : 'rgba(255,255,255,0.6)'}
        />
      </ReactFlow>

      {palette && (
        <NodeSearchPalette
          position={palette.screen}
          onSelect={handlePaletteSelect}
          onClose={() => { setPalette(null); pendingConnection.current = null; }}
        />
      )}

      {nodes.length === 0 && (
        <div
          style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            pointerEvents: 'none',
          }}
        >
          <img
            src="/welcome-nodegraph.png"
            alt=""
            style={{ width: '389px', height: '389px', objectFit: 'contain' }}
            draggable={false}
          />
        </div>
      )}
    </div>
  );
}

function pointToSegmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);

  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const closestX = ax + t * dx;
  const closestY = ay + t * dy;
  return Math.hypot(px - closestX, py - closestY);
}
