export function lineRuntime(params) {
  const { length = 200, angle = 0, stroke_color = '#000000', stroke_width = 2 } = params;
  const rad = (angle * Math.PI) / 180;
  const x2 = length * Math.cos(rad);
  const y2 = length * Math.sin(rad);

  return {
    type: 'line',
    x1: 0,
    y1: 0,
    x2,
    y2,
    stroke: stroke_color,
    strokeWidth: stroke_width,
    bounds: {
      x: Math.min(0, x2) - stroke_width / 2,
      y: Math.min(0, y2) - stroke_width / 2,
      width: Math.max(Math.abs(x2), stroke_width) + stroke_width,
      height: Math.max(Math.abs(y2), stroke_width) + stroke_width,
    },
  };
}
