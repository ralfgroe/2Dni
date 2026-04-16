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

// Paths from user-provided Adobe Illustrator SVG (card_symbols.svg)
const HEART_PATH = "M 1024.86 433.91 C 1024.41 426.24 1021.89 418.89 1018.39 412.10 C 1007.89 391.69 986.26 379.78 963.46 381.75 C 941.62 383.64 922.66 398.24 915.23 419.46 C 907.80 398.23 888.84 383.63 867.00 381.75 C 844.20 379.78 822.57 391.69 812.07 412.10 C 808.57 418.90 806.06 426.24 805.60 433.91 C 804.91 445.51 806.06 456.08 810.42 466.77 C 814.62 477.06 819.73 486.63 826.59 495.44 C 832.53 503.08 838.71 510.30 845.57 517.16 L 863.44 535.04 L 869.61 540.93 L 874.12 545.16 L 877.67 548.45 L 881.79 552.27 L 895.56 564.97 L 899.81 568.93 L 905.49 574.33 L 915.22 584.43 L 924.95 574.33 L 930.63 568.93 L 934.88 564.97 L 948.65 552.27 L 952.77 548.45 L 956.32 545.16 L 960.83 540.93 L 967.00 535.04 L 984.87 517.16 C 991.73 510.30 997.90 503.08 1003.85 495.44 C 1010.70 486.63 1015.81 477.06 1020.02 466.77 C 1024.38 456.09 1025.53 445.51 1024.84 433.91 Z";

const SPADE_PATH = "M 358.65 395.74 L 361.49 384.65 L 370.93 383.05 C 378.49 381.77 386.35 379.21 392.36 374.33 C 397.39 370.25 401.86 365.83 405.79 360.68 C 413.62 350.43 415.53 339.14 416.54 326.49 L 409.91 333.28 C 405.55 337.74 400.56 341.06 395.44 344.65 C 385.04 351.93 372.6 355.17 359.95 353.38 C 351.03 352.12 343.32 347.73 336.97 341.55 C 326.71 331.57 322.07 318.14 323.06 303.93 C 323.72 294.44 326.24 285.58 331.21 277.33 C 338.81 264.72 347.79 255.33 358.88 245.72 C 368.47 237.4 379.8 227.76 387.71 217.94 L 401.48 200.85 C 409.4 191.02 415.32 180.36 420.53 168.34 C 424.42 176.22 428.5 183.26 432.93 190.54 C 437.8 198.54 442.89 205.91 449.08 212.97 C 465.93 233.23 488.74 250.4 504.12 271.55 C 514.7 286.09 519.25 304.8 514.13 322.3 C 511.86 330.05 507.58 336.61 501.84 342.16 C 494.98 348.81 486.43 352.8 476.92 353.67 C 465.59 354.71 454.66 351.68 445.6 344.73 L 438.58 339.35 C 433.49 335.45 429.06 331.35 424.19 326.78 C 427.41 347.18 435.55 365.86 452.36 377.86 C 460.24 383.48 467.5 383.93 476.92 385.02 L 479.04 395.75 L 358.65 395.74 Z";

const CLUB_PATH = "M 1039.97 535.84 C 1034.25 523.30 1023.07 513.03 1008.66 513.73 C 1005.53 513.88 1001.17 515.13 997.25 516.65 C 995.86 517.19 994.66 515.58 995.55 514.40 C 1002.18 505.61 1003.77 495.56 1002.81 483.25 C 1001.66 468.44 993.33 455.48 980.38 448.29 C 974.06 444.78 967.49 442.17 959.99 442.19 C 952.49 442.17 945.92 444.78 939.60 448.29 C 926.66 455.48 918.32 468.43 917.17 483.25 C 916.21 495.56 917.80 505.62 924.43 514.40 C 925.33 515.59 924.12 517.19 922.73 516.65 C 918.82 515.13 914.45 513.89 911.32 513.73 C 896.91 513.03 885.73 523.30 880.01 535.84 C 876.17 544.25 874.72 553.33 875.30 562.55 C 876.07 574.90 880.17 586.30 889.01 595.09 C 897.85 603.88 910.54 607.74 923.00 605.28 C 932.69 603.37 940.47 599.86 947.35 595.34 C 949.95 593.63 953.19 596.31 951.99 599.18 C 951.25 600.94 950.53 602.59 949.85 603.95 C 941.96 619.78 926.17 633.55 909.21 637.36 L 909.21 645.07 L 1010.74 645.07 L 1010.74 637.36 C 993.77 633.55 977.98 619.79 970.10 603.95 C 969.42 602.59 968.70 600.94 967.96 599.18 C 966.76 596.31 970.00 593.63 972.60 595.34 C 979.49 599.85 987.26 603.36 996.95 605.28 C 1009.41 607.74 1022.10 603.88 1030.94 595.09 C 1039.78 586.30 1043.87 574.90 1044.65 562.55 C 1045.23 553.33 1043.78 544.25 1039.94 535.84 Z";

const DIAMOND_PATH = "M 425.49 675.98 C 403.39 633.95 375.91 597.37 343.52 563.83 C 342.2 562.63 341.3 561.65 339.98 560.1 L 352.55 547.41 C 381.12 517.49 405.26 485.47 425.29 448.58 C 444.14 483.81 472.04 521.33 499.66 549.36 L 504.66 554.43 L 510.41 560.27 C 476.45 594.86 448.21 632.45 425.49 675.98 Z";

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
