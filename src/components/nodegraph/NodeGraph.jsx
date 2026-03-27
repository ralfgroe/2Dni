import { useCallback, useState, useRef, useMemo, useEffect } from 'react';
import ReactFlow, {
  Background,
  Controls,
  SelectionMode,
  addEdge as rfAddEdge,
  applyNodeChanges,
  applyEdgeChanges,
} from 'reactflow';
import 'reactflow/dist/style.css';

import { useGraphStore } from '../../store/graphStore';
import { useNodeRegistryStore } from '../../store/nodeRegistryStore';
import GraphNode from './GraphNode';
import NodeSearchPalette from './NodeSearchPalette';
import QuickStartGuide from '../viewport/QuickStartGuide';
import { getPortColor } from '../../utils/portColors';

const nodeTypes = { _custom: GraphNode };

export default function NodeGraph() {
  const reactFlowWrapper = useRef(null);
  const [reactFlowInstance, setReactFlowInstance] = useState(null);
  const [palette, setPalette] = useState(null);
  const [showStartup, setShowStartup] = useState(true);
  const [showGuide, setShowGuide] = useState(false);
  const mousePos = useRef({ x: 0, y: 0 });
  const pendingConnection = useRef(null);

  const nodes = useGraphStore((s) => s.nodes);
  const edges = useGraphStore((s) => s.edges);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const setNodes = useGraphStore((s) => s.setNodes);
  const setEdges = useGraphStore((s) => s.setEdges);
  const selectNode = useGraphStore((s) => s.selectNode);
  const addNode = useGraphStore((s) => s.addNode);
  const duplicateNodes = useGraphStore((s) => s.duplicateNodes);
  const getDefinition = useNodeRegistryStore((s) => s.getDefinition);

  const clipboardRef = useRef(null);

  const rfNodes = useMemo(
    () =>
      nodes.map((n) => ({
        ...n,
        type: '_custom',
      })),
    [nodes]
  );

  const onNodesChange = useCallback(
    (changes) => {
      const updated = applyNodeChanges(changes, nodes);
      setNodes(updated);

      const selectChanges = changes.filter(c => c.type === 'select' && c.selected);
      if (selectChanges.length > 0) {
        selectNode(selectChanges[selectChanges.length - 1].id);
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
      setShowStartup(false);
    },
    [reactFlowInstance]
  );

  const handleKeyDown = useCallback(
    (event) => {
      const isCtrlOrCmd = event.ctrlKey || event.metaKey;

      if (isCtrlOrCmd && event.key === 'c') {
        const selectedIds = nodes.filter(n => n.selected).map(n => n.id);
        if (selectedIds.length > 0) {
          clipboardRef.current = selectedIds;
        } else if (selectedNodeId) {
          clipboardRef.current = [selectedNodeId];
        }
        return;
      }

      if (isCtrlOrCmd && event.key === 'v') {
        if (clipboardRef.current && clipboardRef.current.length > 0) {
          duplicateNodes(clipboardRef.current);
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
        setShowStartup(false);
      }
    },
    [reactFlowInstance, selectedNodeId, nodes, duplicateNodes]
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

  useEffect(() => {
    const el = reactFlowWrapper.current;
    if (!el || !reactFlowInstance) return;
    const onWheel = (e) => {
      const isPinch = e.ctrlKey || e.metaKey;
      if (isPinch) return;

      const hasHorizontal = Math.abs(e.deltaX) > 0;
      const isDiscrete = e.deltaY !== 0 && e.deltaY % 1 === 0 && Math.abs(e.deltaY) >= 50;
      const isMouseWheel = !hasHorizontal && isDiscrete;

      if (!isMouseWheel) {
        e.preventDefault();
        e.stopPropagation();
        const { x, y, zoom } = reactFlowInstance.getViewport();
        reactFlowInstance.setViewport({
          x: x - e.deltaX,
          y: y - e.deltaY,
          zoom,
        });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false, capture: true });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, [reactFlowInstance]);

  return (
    <div
      ref={reactFlowWrapper}
      className="relative h-full w-full"
      onKeyDown={handleKeyDown}
      onMouseMove={handleMouseMove}
      onContextMenu={(e) => e.preventDefault()}
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
        minZoom={0.1}
        deleteKeyCode={["Delete", "Backspace"]}
        selectionOnDrag
        panOnDrag={[1, 2]}
        zoomOnPinch
        selectionMode={SelectionMode.Partial}
        className="nodegraph-flow"
        proOptions={{ hideAttribution: true }}
      >
        <Background
          color={'#dee2e6'}
          gap={20}
          size={1}
        />
        <Controls
          className="nodegraph-controls"
          showInteractive={false}
        />
        
      </ReactFlow>

      {palette && (
        <NodeSearchPalette
          position={palette.screen}
          onSelect={handlePaletteSelect}
          onClose={() => { setPalette(null); pendingConnection.current = null; }}
        />
      )}

      {showStartup && nodes.length === 0 && !showGuide && (
        <div
          style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transform: 'translateY(-36px)',
            pointerEvents: 'none',
          }}
        >
          <div style={{ position: 'relative', width: '756px' }}>
            <img
              src={`${import.meta.env.BASE_URL}start1.svg`}
              alt="Click the red triangle or right-click to start"
              style={{ width: '100%', objectFit: 'contain' }}
              draggable={false}
            />
            <div
              style={{
                position: 'absolute',
                left: '33%',
                top: '56%',
                width: '10%',
                height: '10%',
                cursor: 'pointer',
                pointerEvents: 'auto',
              }}
              onClick={(e) => {
                e.stopPropagation();
                const bounds = reactFlowWrapper.current?.getBoundingClientRect();
                if (!bounds) return;
                const screenPos = { x: bounds.width / 2, y: bounds.height / 2 };
                const flowPos = reactFlowInstance?.screenToFlowPosition({
                  x: bounds.left + bounds.width / 2,
                  y: bounds.top + bounds.height / 2,
                }) || { x: 0, y: 0 };
                setPalette({ screen: screenPos, flow: flowPos, pendingConnection: null });
                setShowStartup(false);
              }}
            />
          </div>
        </div>
      )}

      {showStartup && nodes.length === 0 && !showGuide && (
        <button
          onClick={(e) => { e.stopPropagation(); setShowGuide(true); }}
          style={{
            position: 'absolute',
            top: '58%',
            left: '50%',
            transform: 'translateX(-50%)',
            padding: '8px 24px',
            fontSize: 12,
            fontWeight: 600,
            color: '#fff',
            background: '#4263eb',
            border: 'none',
            borderRadius: 6,
            cursor: 'pointer',
            zIndex: 5,
            transition: 'background 0.15s',
          }}
          onMouseEnter={(e) => { e.target.style.background = '#3b5bdb'; }}
          onMouseLeave={(e) => { e.target.style.background = '#4263eb'; }}
        >
          Quick Start Guide
        </button>
      )}

      {showGuide && (
        <QuickStartGuide onClose={() => { setShowGuide(false); setShowStartup(false); }} />
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
