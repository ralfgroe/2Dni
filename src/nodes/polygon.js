export function polygonRuntime(params) {
  const {
    sides = 6,
    size = 100,
    rotation = 0,
    x = 0,
    y = 0,
    fill_color = '#ffffff',
    stroke_color = '#000000',
    stroke_width = 1,
  } = params;

  const n = Math.max(3, Math.min(16, Math.round(sides)));
  const r = size / 2;
  const rotRad = (rotation - 90) * Math.PI / 180;

  const points = [];
  for (let i = 0; i < n; i++) {
    const angle = rotRad + (2 * Math.PI * i) / n;
    points.push({
      x: x + r * Math.cos(angle),
      y: y + r * Math.sin(angle),
    });
  }

  const d = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
    .join(' ') + ' Z';

  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    type: 'booleanResult',
    pathData: d,
    fill: fill_color,
    stroke: stroke_color,
    strokeWidth: stroke_width,
    bounds: {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
    },
  };
}
