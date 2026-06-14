export function colorRuntime(params, inputs) {
  const {
    show_fill = true,
    fill_color = '#ffffff',
    show_stroke = true,
    stroke_color = '#000000',
    stroke_width = 1,
    opacity = 100,
    line_style = 'Solid',
    dash_length = 8,
    gap_length = 8,
  } = params;

  const inputGeo = inputs.geometry_in;
  if (!inputGeo) return null;

  const opacityValue = Math.max(0, Math.min(100, opacity)) / 100;
  const fill = show_fill ? fill_color : 'none';
  const stroke = show_stroke ? stroke_color : 'none';
  const strokeWidth = show_stroke ? stroke_width : 0;

  // Build dash settings. Round caps give the dots/dashes rounded ends.
  let strokeDasharray;
  let strokeLinecap;
  if (show_stroke && line_style !== 'Solid' && strokeWidth > 0) {
    strokeLinecap = 'round';
    const gap = Math.max(0.01, gap_length);
    if (line_style === 'Dotted') {
      // A near-zero dash with a round cap renders as a circular dot whose
      // diameter equals the stroke width. The gap controls dot spacing.
      strokeDasharray = `0 ${gap + strokeWidth}`;
    } else {
      // Dashed: dash_length controls the visible segment length, gap_length the
      // space between. Round caps extend each dash by ~half the stroke width on
      // each end, so subtract it back out to keep the requested length honest.
      const dash = Math.max(0.01, dash_length - strokeWidth);
      strokeDasharray = `${dash} ${gap + strokeWidth}`;
    }
  }

  return applyColor(inputGeo, fill, stroke, strokeWidth, opacityValue, strokeDasharray, strokeLinecap);
}

function applyColor(geo, fill, stroke, strokeWidth, opacity, strokeDasharray, strokeLinecap) {
  if (!geo) return null;

  switch (geo.type) {
    case 'group':
      return {
        ...geo,
        children: (geo.children || []).map(c => applyColor(c, fill, stroke, strokeWidth, opacity, strokeDasharray, strokeLinecap)),
      };

    case 'boolean':
      return {
        ...geo,
        children: (geo.children || []).map(c => applyColor(c, fill, stroke, strokeWidth, opacity, strokeDasharray, strokeLinecap)),
      };

    default:
      return {
        ...geo,
        fill,
        stroke,
        strokeWidth,
        opacity,
        strokeDasharray: strokeDasharray ?? undefined,
        strokeLinecap: strokeLinecap ?? undefined,
      };
  }
}
