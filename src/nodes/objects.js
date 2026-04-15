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
const HEART_PATH = "M 273.97 251.77 C 265.43 273.58 251.22 295.13 237.4 313.83 L 204.83 355.59 C 195.11 368.05 185.52 380.35 176.25 393.22 L 149.76 359.5 L 118.5 320.09 C 102.82 299.15 88.43 278.1 79.19 253.49 C 76.1 245.27 74.47 237.09 74.17 228.33 C 74.02 224.05 73.9 219.91 74.17 215.62 C 74.7 206.85 76.83 198.46 81.23 190.85 C 85.99 182.61 92.8 176.03 101.08 171.43 C 116.13 163.08 134.45 164.52 149.19 172.79 C 152.85 174.84 156.17 176.97 159.23 179.92 C 167.95 188.32 173.81 198.82 177.58 210.6 L 181.01 199.84 C 183.99 190.51 189.59 182.59 197.57 176.83 C 205.55 171.07 217.81 165.85 227.75 166.01 L 230.84 166.06 C 242.27 166.24 252.71 170.19 260.93 178.01 C 269.16 185.84 274.94 195.46 277.16 206.72 C 278.31 212.54 278.79 218.32 278.53 224.22 L 278.31 229.08 C 277.96 236.81 276.89 244.3 273.97 251.77 Z";

const SPADE_PATH = "M 358.65 395.74 L 361.49 384.65 L 370.93 383.05 C 378.49 381.77 386.35 379.21 392.36 374.33 C 397.39 370.25 401.86 365.83 405.79 360.68 C 413.62 350.43 415.53 339.14 416.54 326.49 L 409.91 333.28 C 405.55 337.74 400.56 341.06 395.44 344.65 C 385.04 351.93 372.6 355.17 359.95 353.38 C 351.03 352.12 343.32 347.73 336.97 341.55 C 326.71 331.57 322.07 318.14 323.06 303.93 C 323.72 294.44 326.24 285.58 331.21 277.33 C 338.81 264.72 347.79 255.33 358.88 245.72 C 368.47 237.4 379.8 227.76 387.71 217.94 L 401.48 200.85 C 409.4 191.02 415.32 180.36 420.53 168.34 C 424.42 176.22 428.5 183.26 432.93 190.54 C 437.8 198.54 442.89 205.91 449.08 212.97 C 465.93 233.23 488.74 250.4 504.12 271.55 C 514.7 286.09 519.25 304.8 514.13 322.3 C 511.86 330.05 507.58 336.61 501.84 342.16 C 494.98 348.81 486.43 352.8 476.92 353.67 C 465.59 354.71 454.66 351.68 445.6 344.73 L 438.58 339.35 C 433.49 335.45 429.06 331.35 424.19 326.78 C 427.41 347.18 435.55 365.86 452.36 377.86 C 460.24 383.48 467.5 383.93 476.92 385.02 L 479.04 395.75 L 358.65 395.74 Z";

const CLUB_PATH = "M 122.52 676.22 L 124.47 666.41 C 138.18 662.72 150.68 655.61 160.4 644.23 C 164.0 640.38 167.16 636.44 169.34 631.71 C 170.8 628.2 172.3 625.1 173.82 622.03 C 175.97 617.38 178.0 614.0 179.0 612.0 C 180.0 610.0 177.0 610.5 173.04 613.16 C 161.37 625.11 145.38 635.25 128.07 634.63 C 110.27 633.99 96.74 621.94 89.93 606.12 C 86.34 597.77 84.43 588.98 84.31 579.73 C 84.21 572.35 86.11 565.09 88.76 558.23 C 94.72 542.85 108.52 529.94 125.66 529.93 C 133.46 529.93 139.07 532.14 146.04 536.27 C 140.22 529.71 135.72 522.6 133.36 514.11 C 129.39 499.84 131.82 484.77 139.74 472.33 C 148.75 458.19 163.79 449.35 180.61 448.47 C 188.98 449.23 196.82 451.41 204.09 455.45 C 218.83 463.64 228.32 478.39 229.63 495.26 C 230.94 512.13 224.06 527.55 212.03 538.94 L 220.02 534.39 C 225.0 531.55 230.5 530.26 236.28 529.98 C 252.69 529.18 265.42 540.88 271.94 555.16 C 276.31 564.74 277.96 575.08 277.3 585.58 C 276.42 599.64 271.76 612.62 261.69 622.63 C 251.62 632.64 237.17 637.03 222.98 634.23 C 206.91 631.06 194.43 620.8 184.0 612.0 C 182.0 610.0 182.5 606.5 186.09 618.47 C 188.21 623.39 190.04 627.98 192.4 632.72 C 201.38 650.75 218.61 661.45 237.93 665.79 L 239.43 675.73 L 122.52 676.22 Z";

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
