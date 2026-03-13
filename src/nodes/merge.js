export function mergeRuntime(params, inputs) {
  const children = [
    inputs.geometry_a,
    inputs.geometry_b,
  ].filter(Boolean);

  if (children.length === 0) return null;
  if (children.length === 1) return children[0];

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const child of children) {
    if (child.bounds) {
      minX = Math.min(minX, child.bounds.x);
      minY = Math.min(minY, child.bounds.y);
      maxX = Math.max(maxX, child.bounds.x + child.bounds.width);
      maxY = Math.max(maxY, child.bounds.y + child.bounds.height);
    }
  }

  return {
    type: 'group',
    children,
    transform: {},
    bounds: {
      x: isFinite(minX) ? minX : 0,
      y: isFinite(minY) ? minY : 0,
      width: isFinite(maxX - minX) ? maxX - minX : 0,
      height: isFinite(maxY - minY) ? maxY - minY : 0,
    },
  };
}
