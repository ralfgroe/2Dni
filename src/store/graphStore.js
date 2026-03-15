import { create } from 'zustand';

let nextNodeId = 1;
const MAX_HISTORY = 10;

function buildDefaultParams(definition) {
  const params = {};
  for (const p of definition.parameters || []) {
    params[p.id] = p.default;
  }
  return params;
}

function snapshot(state) {
  return {
    nodes: JSON.parse(JSON.stringify(state.nodes)),
    edges: JSON.parse(JSON.stringify(state.edges)),
    selectedNodeId: state.selectedNodeId,
    displayNodeId: state.displayNodeId,
  };
}

export const useGraphStore = create((rawSet, get) => {
  const history = [];
  let operationActive = false;

  const pushHistory = () => {
    if (operationActive) return;
    const state = get();
    history.push(snapshot(state));
    if (history.length > MAX_HISTORY) history.shift();
  };

  const set = (updater) => rawSet(updater);

  return {
  nodes: [],
  edges: [],
  selectedNodeId: null,
  displayNodeId: null,

  beginOperation: () => {
    if (!operationActive) {
      const state = get();
      history.push(snapshot(state));
      if (history.length > MAX_HISTORY) history.shift();
      operationActive = true;
    }
  },

  endOperation: () => {
    operationActive = false;
  },

  undo: () => {
    if (history.length === 0) return;
    const prev = history.pop();
    rawSet(prev);
  },

  addNode: (definition, position = { x: 0, y: 0 }) => {
    pushHistory();
    const id = `node_${nextNodeId++}`;
    const newNode = {
      id,
      type: definition.id,
      position,
      data: {
        label: definition.label,
        definitionId: definition.id,
        params: buildDefaultParams(definition),
        bypassed: false,
        templated: false,
      },
    };

    set((state) => ({
      nodes: [...state.nodes, newNode],
    }));

    return id;
  },

  removeNode: (nodeId) => {
    pushHistory();
    set((state) => ({
      nodes: state.nodes.filter((n) => n.id !== nodeId),
      edges: state.edges.filter(
        (e) => e.source !== nodeId && e.target !== nodeId
      ),
      selectedNodeId:
        state.selectedNodeId === nodeId ? null : state.selectedNodeId,
      displayNodeId:
        state.displayNodeId === nodeId ? null : state.displayNodeId,
    }));
  },

  selectNode: (nodeId) => {
    set({ selectedNodeId: nodeId });
  },

  toggleBypass: (nodeId) => {
    pushHistory();
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, bypassed: !n.data.bypassed } }
          : n
      ),
    }));
  },

  toggleTemplate: (nodeId) => {
    pushHistory();
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, templated: !n.data.templated } }
          : n
      ),
    }));
  },

  setDisplayNode: (nodeId) => {
    set((state) => ({
      displayNodeId: state.displayNodeId === nodeId ? null : nodeId,
    }));
  },

  updateNodeParams: (nodeId, params) => {
    pushHistory();
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, params: { ...n.data.params, ...params } } }
          : n
      ),
    }));
  },

  updateNodePosition: (nodeId, position) => {
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId ? { ...n, position } : n
      ),
    }));
  },

  setNodes: (nodes) => set({ nodes }),

  addEdge: (edge) => {
    pushHistory();
    set((state) => ({
      edges: [...state.edges, { ...edge, id: `edge_${Date.now()}` }],
    }));
  },

  removeEdge: (edgeId) => {
    pushHistory();
    set((state) => ({
      edges: state.edges.filter((e) => e.id !== edgeId),
    }));
  },

  setEdges: (edges) => set({ edges }),

  getSelectedNode: () => {
    const { nodes, selectedNodeId } = get();
    return nodes.find((n) => n.id === selectedNodeId) || null;
  },

  clearGraph: () => {
    pushHistory();
    set({ nodes: [], edges: [], selectedNodeId: null, displayNodeId: null });
  },

  duplicateNode: (nodeId, offset = { x: 40, y: 40 }) => {
    pushHistory();
    const { nodes } = get();
    const source = nodes.find((n) => n.id === nodeId);
    if (!source) return null;

    const id = `node_${nextNodeId++}`;
    const newNode = {
      id,
      type: source.type,
      position: {
        x: source.position.x + offset.x,
        y: source.position.y + offset.y,
      },
      data: {
        ...source.data,
        params: { ...source.data.params },
        bypassed: false,
        templated: false,
      },
    };

    set((state) => ({
      nodes: [...state.nodes, newNode],
      selectedNodeId: id,
    }));

    return id;
  },

  duplicateNodes: (nodeIds, offset = { x: 40, y: 40 }) => {
    pushHistory();
    const { nodes, edges } = get();
    const idMap = {};
    const newNodes = [];

    for (const oldId of nodeIds) {
      const source = nodes.find((n) => n.id === oldId);
      if (!source) continue;
      const newId = `node_${nextNodeId++}`;
      idMap[oldId] = newId;
      newNodes.push({
        id: newId,
        type: source.type,
        position: {
          x: source.position.x + offset.x,
          y: source.position.y + offset.y,
        },
        selected: true,
        data: {
          ...source.data,
          params: { ...source.data.params },
          bypassed: false,
          templated: false,
        },
      });
    }

    const newEdges = [];
    for (const edge of edges) {
      if (idMap[edge.source] && idMap[edge.target]) {
        newEdges.push({
          ...edge,
          id: `e_${idMap[edge.source]}_${edge.sourceHandle}_${idMap[edge.target]}_${edge.targetHandle}`,
          source: idMap[edge.source],
          target: idMap[edge.target],
        });
      }
    }

    const deselectedNodes = nodes.map(n => ({ ...n, selected: false }));

    set((state) => ({
      nodes: [...deselectedNodes, ...newNodes],
      edges: [...state.edges, ...newEdges],
      selectedNodeId: newNodes.length > 0 ? newNodes[newNodes.length - 1].id : state.selectedNodeId,
    }));
  },
};
});
