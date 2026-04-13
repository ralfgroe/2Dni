export function rectangleRuntime(params) {
  const {
    width = 200,
    height = 100,
    scale = 1,
    x = 0,
    y = 0,
    fill_color = '#ffffff',
    stroke_color = '#000000',
    stroke_width = 1,
  } = params;

  const w = width * scale;
  const h = height * scale;
  const drawX = x - w / 2;
  const drawY = y - h / 2;

  return {
    type: 'rect',
    x: drawX,
    y: drawY,
    width: w,
    height: h,
    fill: fill_color,
    stroke: stroke_color,
    strokeWidth: stroke_width,
    bounds: { x: drawX, y: drawY, width: w, height: h },
  };
}
