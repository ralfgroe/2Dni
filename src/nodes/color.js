export function colorRuntime(params, inputs) {
  const {
    show_fill = true,
    fill_color = '#ffffff',
    show_stroke = true,
    stroke_color = '#000000',
    stroke_width = 1,
    opacity = 100,
  } = params;

  const inputGeo = inputs.geometry_in;
  if (!inputGeo) return null;

  const opacityValue = Math.max(0, Math.min(100, opacity)) / 100;
  const fill = show_fill ? fill_color : 'none';
  const stroke = show_stroke ? stroke_color : 'none';
  const strokeWidth = show_stroke ? stroke_width : 0;
  return applyColor(inputGeo, fill, stroke, strokeWidth, opacityValue);
}

function applyColor(geo, fill, stroke, strokeWidth, opacity) {
  if (!geo) return null;

  switch (geo.type) {
    case 'group':
      return {
        ...geo,
        children: (geo.children || []).map(c => applyColor(c, fill, stroke, strokeWidth, opacity)),
      };

    case 'boolean':
      return {
        ...geo,
        children: (geo.children || []).map(c => applyColor(c, fill, stroke, strokeWidth, opacity)),
      };

    default:
      return {
        ...geo,
        fill,
        stroke,
        strokeWidth,
        opacity,
      };
  }
}
