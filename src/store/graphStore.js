import { create } from 'zustand';

let nextNodeId = 1;

function buildDefaultParams(definition) {
  const params = {};
  for (const p of definition.parameters || []) {
    params[p.id] = p.default;
  }
  return params;
}

export const useGraphStore = create((set, get) => ({
  nodes: [],
  edges: [],
  selectedNodeId: null,
  displayNodeId: null,

  addNode: (definition, position = { x: 0, y: 0 }) => {
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
    set((state) => ({
      nodes: state.nodes.map((n) =>
        n.id === nodeId
          ? { ...n, data: { ...n.data, bypassed: !n.data.bypassed } }
          : n
      ),
    }));
  },

  toggleTemplate: (nodeId) => {
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
    set((state) => ({
      edges: [...state.edges, { ...edge, id: `edge_${Date.now()}` }],
    }));
  },

  removeEdge: (edgeId) => {
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
    set({ nodes: [], edges: [], selectedNodeId: null, displayNodeId: null });
  },

  duplicateNode: (nodeId, offset = { x: 40, y: 40 }) => {
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
}));
