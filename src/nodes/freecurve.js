export function freecurveRuntime(params) {
  const {
    points_data = '[]',
    closed = false,
    stroke_color = '#000000',
    stroke_width = 2,
  } = params;

  let points;
  try {
    points = JSON.parse(points_data);
  } catch {
    return null;
  }

  if (!Array.isArray(points) || points.length < 2) return null;

  const cmds = [`M${points[0].x},${points[0].y}`];
  for (let i = 1; i < points.length; i++) {
    cmds.push(`L${points[i].x},${points[i].y}`);
  }
  if (closed) cmds.push('Z');

  const pathData = cmds.join(' ');

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  const sw = stroke_width;
  return {
    type: 'booleanResult',
    pathData,
    fill: closed ? '#ffffff' : 'none',
    stroke: stroke_color,
    strokeWidth: sw,
    bounds: {
      x: minX - sw,
      y: minY - sw,
      width: (maxX - minX) + sw * 2,
      height: (maxY - minY) + sw * 2,
    },
  };
}
