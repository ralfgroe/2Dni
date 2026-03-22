function applyLayer(geo, layer) {
  if (!geo) return null;
  if ((geo.type === 'group' || geo.type === 'boolean') && geo.children) {
    return {
      ...geo,
      layer,
      children: geo.children.map((child) => applyLayer(child, layer)),
    };
  }
  return { ...geo, layer };
}

export function layersRuntime(params, inputs) {
  const { layer = 0 } = params;
  const geo = inputs.geometry_in;
  if (!geo) return null;
  return applyLayer(geo, Math.round(Math.min(4, Math.max(0, layer))));
}
