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
  const ox = cx, oy = cy;
  return [
    `M ${ox} ${oy + 44 * sc}`,
    `C ${ox - 4 * sc} ${oy + 38 * sc} ${ox - 38 * sc} ${oy + 14 * sc} ${ox - 44 * sc} ${oy - 2 * sc}`,
    `C ${ox - 48 * sc} ${oy - 14 * sc} ${ox - 46 * sc} ${oy - 30 * sc} ${ox - 36 * sc} ${oy - 38 * sc}`,
    `C ${ox - 28 * sc} ${oy - 44 * sc} ${ox - 16 * sc} ${oy - 44 * sc} ${ox - 8 * sc} ${oy - 40 * sc}`,
    `C ${ox - 2 * sc} ${oy - 37 * sc} ${ox} ${oy - 32 * sc} ${ox} ${oy - 28 * sc}`,
    `C ${ox} ${oy - 32 * sc} ${ox + 2 * sc} ${oy - 37 * sc} ${ox + 8 * sc} ${oy - 40 * sc}`,
    `C ${ox + 16 * sc} ${oy - 44 * sc} ${ox + 28 * sc} ${oy - 44 * sc} ${ox + 36 * sc} ${oy - 38 * sc}`,
    `C ${ox + 46 * sc} ${oy - 30 * sc} ${ox + 48 * sc} ${oy - 14 * sc} ${ox + 44 * sc} ${oy - 2 * sc}`,
    `C ${ox + 38 * sc} ${oy + 14 * sc} ${ox + 4 * sc} ${oy + 38 * sc} ${ox} ${oy + 44 * sc}`,
    'Z',
  ].join(' ');
}

function spadePath(s, cx, cy) {
  const sc = s / 50;
  const ox = cx, oy = cy;
  return [
    `M ${ox} ${oy - 46 * sc}`,
    `C ${ox + 4 * sc} ${oy - 40 * sc} ${ox + 38 * sc} ${oy - 16 * sc} ${ox + 44 * sc} ${oy}`,
    `C ${ox + 48 * sc} ${oy + 12 * sc} ${ox + 46 * sc} ${oy + 28 * sc} ${ox + 36 * sc} ${oy + 34 * sc}`,
    `C ${ox + 28 * sc} ${oy + 39 * sc} ${ox + 18 * sc} ${oy + 36 * sc} ${ox + 12 * sc} ${oy + 30 * sc}`,
    `C ${ox + 14 * sc} ${oy + 36 * sc} ${ox + 16 * sc} ${oy + 42 * sc} ${ox + 16 * sc} ${oy + 48 * sc}`,
    `L ${ox - 16 * sc} ${oy + 48 * sc}`,
    `C ${ox - 16 * sc} ${oy + 42 * sc} ${ox - 14 * sc} ${oy + 36 * sc} ${ox - 12 * sc} ${oy + 30 * sc}`,
    `C ${ox - 18 * sc} ${oy + 36 * sc} ${ox - 28 * sc} ${oy + 39 * sc} ${ox - 36 * sc} ${oy + 34 * sc}`,
    `C ${ox - 46 * sc} ${oy + 28 * sc} ${ox - 48 * sc} ${oy + 12 * sc} ${ox - 44 * sc} ${oy}`,
    `C ${ox - 38 * sc} ${oy - 16 * sc} ${ox - 4 * sc} ${oy - 40 * sc} ${ox} ${oy - 46 * sc}`,
    'Z',
  ].join(' ');
}

function diamondPath(s, cx, cy) {
  const sc = s / 50;
  const ox = cx, oy = cy;
  const w = 30 * sc;
  const h = 48 * sc;
  const bulge = 8 * sc;
  return [
    `M ${ox} ${oy - h}`,
    `C ${ox + bulge} ${oy - h + bulge} ${ox + w - bulge} ${oy - bulge} ${ox + w} ${oy}`,
    `C ${ox + w - bulge} ${oy + bulge} ${ox + bulge} ${oy + h - bulge} ${ox} ${oy + h}`,
    `C ${ox - bulge} ${oy + h - bulge} ${ox - w + bulge} ${oy + bulge} ${ox - w} ${oy}`,
    `C ${ox - w + bulge} ${oy - bulge} ${ox - bulge} ${oy - h + bulge} ${ox} ${oy - h}`,
    'Z',
  ].join(' ');
}

function clubPath(s, cx, cy) {
  const sc = s / 50;
  const ox = cx, oy = cy;
  const r = 18 * sc;
  const k = r * 0.5522847498;
  const topCy = oy - 20 * sc;
  const sideCy = oy + 6 * sc;
  const sideOff = 20 * sc;

  function lobe(lx, ly) {
    return [
      `M ${lx} ${ly - r}`,
      `C ${lx + k} ${ly - r} ${lx + r} ${ly - k} ${lx + r} ${ly}`,
      `C ${lx + r} ${ly + k} ${lx + k} ${ly + r} ${lx} ${ly + r}`,
      `C ${lx - k} ${ly + r} ${lx - r} ${ly + k} ${lx - r} ${ly}`,
      `C ${lx - r} ${ly - k} ${lx - k} ${ly - r} ${lx} ${ly - r}`,
    ].join(' ');
  }

  const top = lobe(ox, topCy);
  const left = lobe(ox - sideOff, sideCy);
  const right = lobe(ox + sideOff, sideCy);

  const stemTop = sideCy + 6 * sc;
  const stemBot = oy + 48 * sc;
  const stemW1 = 6 * sc;
  const stemW2 = 16 * sc;
  const stem = [
    `M ${ox - stemW1} ${stemTop}`,
    `C ${ox - stemW1} ${stemTop + 10 * sc} ${ox - stemW2} ${stemBot - 6 * sc} ${ox - stemW2} ${stemBot}`,
    `L ${ox + stemW2} ${stemBot}`,
    `C ${ox + stemW2} ${stemBot - 6 * sc} ${ox + stemW1} ${stemTop + 10 * sc} ${ox + stemW1} ${stemTop}`,
  ].join(' ');

  return `${top} ${left} ${right} ${stem} Z`;
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
