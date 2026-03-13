const nodeDefinitionModules = import.meta.glob('/node-definitions/*.json', { eager: true });

export function loadNodeDefinitions() {
  const definitions = {};

  for (const [path, module] of Object.entries(nodeDefinitionModules)) {
    const def = module.default || module;
    if (def && def.id) {
      definitions[def.id] = def;
    }
  }

  return definitions;
}
