import { create } from 'zustand';
import { loadNodeDefinitions } from '../utils/nodeLoader';

export const useNodeRegistryStore = create((set, get) => ({
  definitions: {},
  categories: [],
  loaded: false,

  loadDefinitions: () => {
    const definitions = loadNodeDefinitions();

    const categoryOrder = ['Geometry', 'Transform', 'Appearance', 'Output'];
    const categorySet = new Set();
    for (const def of Object.values(definitions)) {
      if (def.category) categorySet.add(def.category);
    }
    const categories = categoryOrder.filter((c) => categorySet.has(c));
    for (const c of categorySet) {
      if (!categories.includes(c)) categories.push(c);
    }

    set({
      definitions,
      categories,
      loaded: true,
    });
  },

  getDefinition: (id) => get().definitions[id] || null,

  getDefinitionsByCategory: (category) =>
    Object.values(get().definitions)
      .filter((d) => d.category === category)
      .sort((a, b) => a.label.localeCompare(b.label)),

  getAllDefinitions: () =>
    Object.values(get().definitions).sort((a, b) => a.label.localeCompare(b.label)),
}));
