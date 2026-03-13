import { create } from 'zustand';
import { loadNodeDefinitions } from '../utils/nodeLoader';

export const useNodeRegistryStore = create((set, get) => ({
  definitions: {},
  categories: [],
  loaded: false,

  loadDefinitions: () => {
    const definitions = loadNodeDefinitions();

    const categorySet = new Set();
    for (const def of Object.values(definitions)) {
      if (def.category) categorySet.add(def.category);
    }

    set({
      definitions,
      categories: [...categorySet].sort(),
      loaded: true,
    });
  },

  getDefinition: (id) => get().definitions[id] || null,

  getDefinitionsByCategory: (category) =>
    Object.values(get().definitions).filter((d) => d.category === category),

  getAllDefinitions: () => Object.values(get().definitions),
}));
