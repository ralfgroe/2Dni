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
    case 'Heart':   return scaleOrigPath(HEART_PATH, s, cx, cy);
    case 'Spade':   return scaleOrigPath(SPADE_PATH, s, cx, cy);
    case 'Diamond': return scaleOrigPath(DIAMOND_PATH, s, cx, cy);
    case 'Club':    return scaleOrigPath(CLUB_PATH, s, cx, cy);
    case 'T-Shirt': return tshirtPath(s, cx, cy);
    default:        return scaleOrigPath(HEART_PATH, s, cx, cy);
  }
}

// Wikimedia Commons "Anglo-American card suits" — CC BY-SA, by Silsor
const HEART_PATH = "M 216.5 906.612 C 216.157 905.994 214.682 901.524 213.222 896.679 C 203.968 865.973 186.789 834.88 157.522 796.767 C 146.713 782.448 136.54 769.768 109.032 736.33 C 77.181 697.612 68.057 685.21 58.844 668.102 C 53.404 657.999 47.766 642.628 45.91 632.839 C 44.056 623.056 44.026 607.072 45.846 598.749 C 53.249 564.895 83.321 539.355 119.279 536.381 C 160.472 532.974 195.511 553.783 213.922 592.588 L 218.033 601.253 L 221.128 594.407 C 225.725 584.236 230.153 577.357 237.626 568.773 C 256.654 546.92 279.3 536.215 306.581 536.177 C 318.801 536.16 325.803 537.175 336.216 540.47 C 351.79 545.398 363.514 553.075 373.955 565.183 C 401.165 596.736 397.943 639.723 364.423 692.37 C 356.603 704.651 342.495 722.822 323.093 745.602 C 300.749 771.833 289.833 785.165 278.655 799.867 C 251.864 835.107 233.845 867.127 223.935 897.11 C 222.422 901.684 220.838 905.946 220.415 906.581 C 219.429 908.057 216.812 908.075 216.0 906.612 Z";

const SPADE_PATH = "M 462.295 664.328 C 340.215 789.05 459.887 879.519 556.409 819.974 C 538.184 884.942 528.161 890.054 517.097 907.164 L 621.31 907.164 C 607.933 889.887 593.884 884.942 579.65 820.344 C 678.197 876.954 782.06 778.23 672.71 664.328 C 601.196 601.773 573.431 544.663 567.502 536.554 C 561.813 543.311 528.294 602.934 462.295 664.328 Z";

const DIAMOND_PATH = "M 567 90.004 C 528.3 154.4 484.736 216.348 440.476 275.844 C 486.821 335.339 531.081 397.286 566.998 461.684 C 604.306 396.061 645.09 333.501 693.52 275.844 C 646.48 216.348 603.61 153.176 567 90.004 Z";

const CLUB_PATH = "M 187.18 250.387 C 128.367 222.293 41.853 255.804 62.322 331.399 C 82.269 405.068 168.412 388.901 198.201 344.058 C 185.774 429.083 163.949 442.32 150.867 460.778 L 289.751 460.778 C 275.679 441.038 250.127 429.083 235.143 342.892 C 265.159 387.66 355.396 403.18 375.055 330.576 C 394.393 259.155 307.221 218.481 249.254 250.813 C 304.839 213.488 324.8 90.9 219.523 90.9 C 113.205 90.9 130.943 215.884 187.18 250.387 Z";

function scaleOrigPath(origPath, s, cx, cy) {
  const tokens = origPath.match(/[a-zA-Z]|-?\d+\.?\d*/g);
  if (!tokens) return '';
  const xVals = [], yVals = [];
  let isX = true;
  for (const t of tokens) {
    if (/^[a-zA-Z]$/.test(t)) { isX = true; continue; }
    const num = parseFloat(t);
    if (isX) xVals.push(num); else yVals.push(num);
    isX = !isX;
  }
  const minX = Math.min(...xVals), maxX = Math.max(...xVals);
  const minY = Math.min(...yVals), maxY = Math.max(...yVals);
  const origCx = (minX + maxX) / 2, origCy = (minY + maxY) / 2;
  const rawSize = Math.max(maxX - minX, maxY - minY);
  const scale = (s * 2) / rawSize;

  const result = [];
  isX = true;
  for (const t of tokens) {
    if (/^[a-zA-Z]$/.test(t)) {
      result.push(t);
      if (t !== 'Z' && t !== 'z') isX = true;
      continue;
    }
    const num = parseFloat(t);
    if (isX) {
      result.push(((num - origCx) * scale + cx).toFixed(3));
    } else {
      result.push(((num - origCy) * scale + cy).toFixed(3));
    }
    isX = !isX;
  }
  return result.join(' ');
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
