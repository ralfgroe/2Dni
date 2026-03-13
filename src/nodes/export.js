export function exportRuntime(params, inputs) {
  const {
    format = 'svg',
    filename = 'export',
    canvas_width = 1920,
    canvas_height = 1080,
    background_color = '#ffffff',
  } = params;

  const inputGeo = inputs.geometry_in;

  return {
    type: 'export',
    format,
    filename,
    canvasWidth: canvas_width,
    canvasHeight: canvas_height,
    backgroundColor: background_color,
    geometry: inputGeo,
  };
}
