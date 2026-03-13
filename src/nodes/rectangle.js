export function rectangleRuntime(params) {
  const {
    width = 200,
    height = 100,
    x = 0,
    y = 0,
    fill_color = '#ffffff',
    stroke_color = '#000000',
    stroke_width = 1,
  } = params;

  const drawX = x - width / 2;
  const drawY = y - height / 2;

  return {
    type: 'rect',
    x: drawX,
    y: drawY,
    width,
    height,
    fill: fill_color,
    stroke: stroke_color,
    strokeWidth: stroke_width,
    bounds: { x: drawX, y: drawY, width, height },
  };
}
