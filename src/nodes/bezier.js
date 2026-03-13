// Each anchor: { point: {x,y}, handleIn: {x,y}, handleOut: {x,y} }
// handleIn/handleOut are ABSOLUTE positions (not relative offsets)

export function bezierRuntime(params) {
  const {
    anchors_data = '[]',
    closed = false,
    stroke_color = '#000000',
    stroke_width = 2,
  } = params;

  let anchors;
  try {
    anchors = JSON.parse(anchors_data);
  } catch {
    return null;
  }

  if (!Array.isArray(anchors) || anchors.length < 2) return null;

  const cmds = [];
  const first = anchors[0];
  cmds.push(`M${first.point.x},${first.point.y}`);

  for (let i = 1; i < anchors.length; i++) {
    const prev = anchors[i - 1];
    const curr = anchors[i];
    const cp1 = prev.handleOut || prev.point;
    const cp2 = curr.handleIn || curr.point;
    cmds.push(`C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${curr.point.x},${curr.point.y}`);
  }

  if (closed && anchors.length > 2) {
    const last = anchors[anchors.length - 1];
    const cp1 = last.handleOut || last.point;
    const cp2 = first.handleIn || first.point;
    cmds.push(`C${cp1.x},${cp1.y} ${cp2.x},${cp2.y} ${first.point.x},${first.point.y}`);
    cmds.push('Z');
  }

  const pathData = cmds.join(' ');

  const allPts = [];
  for (const a of anchors) {
    allPts.push(a.point);
    if (a.handleIn) allPts.push(a.handleIn);
    if (a.handleOut) allPts.push(a.handleOut);
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of allPts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  const sw = stroke_width;
  return {
    type: 'booleanResult',
    pathData,
    fill: closed ? '#ffffff' : 'none',
    stroke: stroke_color,
    strokeWidth: sw,
    bounds: {
      x: minX - sw,
      y: minY - sw,
      width: (maxX - minX) + sw * 2,
      height: (maxY - minY) + sw * 2,
    },
  };
}
