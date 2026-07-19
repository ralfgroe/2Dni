export function rectangleRuntime(params) {
  const {
    width = 200,
    height = 100,
    scale = 1,
    rotation = 0,
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

  const geo = {
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

  // Rotation (degrees, about the shape center) is carried on the geometry and
  // honored by the SVG renderer and geoToPaperPath, so every downstream consumer
  // (radius, boolean, physics, export) sees the correct world-space shape
  // without each having to special-case it. bounds stays the AABB of the
  // UNROTATED shape; consumers needing the rotated outline go through
  // geoToPaperPath which applies the rotation.
  if (rotation % 360 !== 0) {
    geo.rotation = rotation;
    geo.rotateCenter = { x, y };
  }

  return geo;
}
