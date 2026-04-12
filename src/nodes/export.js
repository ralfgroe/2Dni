export function exportRuntime(params, inputs) {
  const {
    format = 'svg',
    resolution = 'hd',
    filename = 'export',
    canvas_width = 1920,
    canvas_height = 1080,
    jpeg_quality = 92,
    offset_x = 0,
    offset_y = 0,
    zoom = 1,
    background_color = '#ffffff',
  } = params;

  let w = canvas_width;
  let h = canvas_height;
  if (resolution === 'hd') { w = 1920; h = 1080; }
  else if (resolution === '4k') { w = 3840; h = 2160; }

  const inputGeo = inputs.geometry_in;

  return {
    type: 'export',
    format,
    resolution,
    filename,
    canvasWidth: w,
    canvasHeight: h,
    jpegQuality: jpeg_quality,
    offsetX: offset_x,
    offsetY: offset_y,
    zoom,
    backgroundColor: background_color,
    geometry: inputGeo,
  };
}
