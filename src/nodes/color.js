export function colorRuntime(params, inputs) {
  const {
    fill_color = '#ffffff',
    stroke_color = '#000000',
    stroke_width = 1,
  } = params;

  const inputGeo = inputs.geometry_in;
  if (!inputGeo) return null;

  return applyColor(inputGeo, fill_color, stroke_color, stroke_width);
}

function applyColor(geo, fill, stroke, strokeWidth) {
  if (!geo) return null;

  switch (geo.type) {
    case 'group':
      return {
        ...geo,
        children: (geo.children || []).map(c => applyColor(c, fill, stroke, strokeWidth)),
      };

    case 'boolean':
      return {
        ...geo,
        children: (geo.children || []).map(c => applyColor(c, fill, stroke, strokeWidth)),
      };

    default:
      return {
        ...geo,
        fill,
        stroke,
        strokeWidth,
      };
  }
}
