import { create } from 'zustand';

export const useViewportStore = create((set, get) => ({
  mode: 'default',
  pickTargetNodeId: null,

  enterPointPick: (nodeId) => {
    set({ mode: 'pointpick', pickTargetNodeId: nodeId });
  },

  exitPointPick: () => {
    set({ mode: 'default', pickTargetNodeId: null });
  },
}));
