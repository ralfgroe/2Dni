export function objectsRuntime(params) {
  const {
    shape = 'Heart',
    size = 100,
    x = 0,
    y = 0,
    fill_color = '#ffffff',
    stroke_color = '#000000',
    stroke_width = 1,
  } = params;

  const pathData = buildShapePath(shape, size, x, y);

  const pts = parsePathPoints(pathData);
  const xs = pts.map(p => p.x);
  const ys = pts.map(p => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return {
    type: 'booleanResult',
    pathData,
    fill: fill_color,
    stroke: stroke_color,
    strokeWidth: stroke_width,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}

function parsePathPoints(d) {
  const nums = d.match(/-?\d+(\.\d+)?/g);
  if (!nums) return [{ x: 0, y: 0 }];
  const pts = [];
  for (let i = 0; i < nums.length - 1; i += 2) {
    pts.push({ x: parseFloat(nums[i]), y: parseFloat(nums[i + 1]) });
  }
  return pts.length > 0 ? pts : [{ x: 0, y: 0 }];
}

function buildShapePath(shape, size, cx, cy) {
  const s = size / 2;

  switch (shape) {
    case 'Heart':
      return heartPath(s, cx, cy);
    case 'Spade':
      return spadePath(s, cx, cy);
    case 'Diamond':
      return diamondPath(s, cx, cy);
    case 'Club':
      return clubPath(s, cx, cy);
    case 'T-Shirt':
      return tshirtPath(s, cx, cy);
    default:
      return heartPath(s, cx, cy);
  }
}

function heartPath(s, cx, cy) {
  const sc = s / 50;
  const ox = cx, oy = cy + s * 0.1;
  return [
    `M ${ox} ${oy + 18 * sc}`,
    `C ${ox} ${oy + 14 * sc} ${ox - 5 * sc} ${oy + 8 * sc} ${ox - 14 * sc} ${oy + 8 * sc}`,
    `C ${ox - 28 * sc} ${oy + 8 * sc} ${ox - 42 * sc} ${oy + 22 * sc} ${ox - 42 * sc} ${oy + 36 * sc}`,
    `C ${ox - 42 * sc} ${oy + 60 * sc} ${ox} ${oy + 80 * sc} ${ox} ${oy + 80 * sc}`,
    `C ${ox} ${oy + 80 * sc} ${ox + 42 * sc} ${oy + 60 * sc} ${ox + 42 * sc} ${oy + 36 * sc}`,
    `C ${ox + 42 * sc} ${oy + 22 * sc} ${ox + 28 * sc} ${oy + 8 * sc} ${ox + 14 * sc} ${oy + 8 * sc}`,
    `C ${ox + 5 * sc} ${oy + 8 * sc} ${ox} ${oy + 14 * sc} ${ox} ${oy + 18 * sc}`,
    'Z',
  ].join(' ');
}

function spadePath(s, cx, cy) {
  const sc = s / 50;
  const ox = cx, oy = cy;
  return [
    `M ${ox} ${oy - 44 * sc}`,
    `C ${ox} ${oy - 44 * sc} ${ox - 42 * sc} ${oy - 10 * sc} ${ox - 42 * sc} ${oy + 10 * sc}`,
    `C ${ox - 42 * sc} ${oy + 28 * sc} ${ox - 24 * sc} ${oy + 38 * sc} ${ox - 10 * sc} ${oy + 34 * sc}`,
    `C ${ox - 16 * sc} ${oy + 42 * sc} ${ox - 8 * sc} ${oy + 48 * sc} ${ox - 8 * sc} ${oy + 48 * sc}`,
    `L ${ox + 8 * sc} ${oy + 48 * sc}`,
    `C ${ox + 8 * sc} ${oy + 48 * sc} ${ox + 16 * sc} ${oy + 42 * sc} ${ox + 10 * sc} ${oy + 34 * sc}`,
    `C ${ox + 24 * sc} ${oy + 38 * sc} ${ox + 42 * sc} ${oy + 28 * sc} ${ox + 42 * sc} ${oy + 10 * sc}`,
    `C ${ox + 42 * sc} ${oy - 10 * sc} ${ox} ${oy - 44 * sc} ${ox} ${oy - 44 * sc}`,
    'Z',
  ].join(' ');
}

function diamondPath(s, cx, cy) {
  const w = s * 0.65;
  const h = s;
  return [
    `M ${cx} ${cy - h}`,
    `L ${cx + w} ${cy}`,
    `L ${cx} ${cy + h}`,
    `L ${cx - w} ${cy}`,
    'Z',
  ].join(' ');
}

function clubPath(s, cx, cy) {
  const sc = s / 50;
  const ox = cx, oy = cy;
  const r = 16 * sc;
  const topY = oy - 22 * sc;
  const sideY = oy + 2 * sc;
  const sideX = 22 * sc;

  const circleApprox = (ccx, ccy, radius) => {
    const k = radius * 0.5522847498;
    return [
      `M ${ccx} ${ccy - radius}`,
      `C ${ccx + k} ${ccy - radius} ${ccx + radius} ${ccy - k} ${ccx + radius} ${ccy}`,
      `C ${ccx + radius} ${ccy + k} ${ccx + k} ${ccy + radius} ${ccx} ${ccy + radius}`,
      `C ${ccx - k} ${ccy + radius} ${ccx - radius} ${ccy + k} ${ccx - radius} ${ccy}`,
      `C ${ccx - radius} ${ccy - k} ${ccx - k} ${ccy - radius} ${ccx} ${ccy - radius}`,
    ].join(' ');
  };

  const topLobe = circleApprox(ox, topY, r);
  const leftLobe = circleApprox(ox - sideX, sideY, r);
  const rightLobe = circleApprox(ox + sideX, sideY, r);

  const stem = [
    `M ${ox - 8 * sc} ${sideY + 10 * sc}`,
    `C ${ox - 10 * sc} ${oy + 30 * sc} ${ox - 14 * sc} ${oy + 44 * sc} ${ox - 14 * sc} ${oy + 44 * sc}`,
    `L ${ox + 14 * sc} ${oy + 44 * sc}`,
    `C ${ox + 14 * sc} ${oy + 44 * sc} ${ox + 10 * sc} ${oy + 30 * sc} ${ox + 8 * sc} ${sideY + 10 * sc}`,
  ].join(' ');

  return `${topLobe} ${leftLobe} ${rightLobe} ${stem} Z`;
}

function tshirtPath(s, cx, cy) {
  const sc = s / 50;
  const ox = cx, oy = cy;
  return [
    `M ${ox - 14 * sc} ${oy - 42 * sc}`,
    `L ${ox - 40 * sc} ${oy - 28 * sc}`,
    `L ${ox - 34 * sc} ${oy - 10 * sc}`,
    `L ${ox - 22 * sc} ${oy - 18 * sc}`,
    `L ${ox - 22 * sc} ${oy + 42 * sc}`,
    `L ${ox + 22 * sc} ${oy + 42 * sc}`,
    `L ${ox + 22 * sc} ${oy - 18 * sc}`,
    `L ${ox + 34 * sc} ${oy - 10 * sc}`,
    `L ${ox + 40 * sc} ${oy - 28 * sc}`,
    `L ${ox + 14 * sc} ${oy - 42 * sc}`,
    `C ${ox + 10 * sc} ${oy - 34 * sc} ${ox - 10 * sc} ${oy - 34 * sc} ${ox - 14 * sc} ${oy - 42 * sc}`,
    'Z',
  ].join(' ');
}
