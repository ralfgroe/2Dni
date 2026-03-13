export function circleRuntime(params) {
  const {
    diameter = 100,
    separate_xy = false,
    diameter_x = 100,
    diameter_y = 100,
    arc_start = 0,
    arc_end = 360,
    x = 0,
    y = 0,
    fill_color = '#ffffff',
    stroke_color = '#000000',
    stroke_width = 1,
  } = params;

  const rx = separate_xy ? diameter_x / 2 : diameter / 2;
  const ry = separate_xy ? diameter_y / 2 : diameter / 2;

  const cx = x;
  const cy = y;

  const sweep = arc_end - arc_start;
  const isFullCircle = sweep >= 360 || sweep <= -360;

  if (isFullCircle) {
    return {
      type: 'ellipse',
      cx,
      cy,
      rx,
      ry,
      fill: fill_color,
      stroke: stroke_color,
      strokeWidth: stroke_width,
      bounds: { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 },
    };
  }

  const startRad = (arc_start - 90) * Math.PI / 180;
  const endRad = (arc_end - 90) * Math.PI / 180;

  const x1 = cx + rx * Math.cos(startRad);
  const y1 = cy + ry * Math.sin(startRad);
  const x2 = cx + rx * Math.cos(endRad);
  const y2 = cy + ry * Math.sin(endRad);

  const largeArc = Math.abs(sweep) > 180 ? 1 : 0;
  const sweepFlag = sweep > 0 ? 1 : 0;

  const pathData = [
    `M ${cx} ${cy}`,
    `L ${x1} ${y1}`,
    `A ${rx} ${ry} 0 ${largeArc} ${sweepFlag} ${x2} ${y2}`,
    'Z',
  ].join(' ');

  return {
    type: 'arc',
    pathData,
    cx,
    cy,
    rx,
    ry,
    arcStart: arc_start,
    arcEnd: arc_end,
    fill: fill_color,
    stroke: stroke_color,
    strokeWidth: stroke_width,
    bounds: { x: cx - rx, y: cy - ry, width: rx * 2, height: ry * 2 },
  };
}
