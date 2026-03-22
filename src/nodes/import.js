import paper from 'paper';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

function ensurePaper() {
  if (!paperInitialized && canvas) {
    paper.setup(canvas);
    paperInitialized = true;
  }
}

export function importRuntime(params) {
  const { file_data = '', x = 0, y = 0, scale = 1 } = params;
  if (!file_data) return null;

  if (file_data.startsWith('data:image/svg') || file_data.startsWith('<svg') || file_data.includes('<svg')) {
    return parseSVG(file_data, x, y, scale);
  }

  if (file_data.startsWith('data:image/')) {
    return parseImage(file_data, x, y, scale);
  }

  return null;
}

function parseSVG(data, x, y, scale) {
  ensurePaper();

  let svgString = data;
  if (data.startsWith('data:image/svg')) {
    const commaIdx = data.indexOf(',');
    if (data.indexOf('base64') !== -1) {
      svgString = atob(data.slice(commaIdx + 1));
    } else {
      svgString = decodeURIComponent(data.slice(commaIdx + 1));
    }
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgString, 'image/svg+xml');
  const svgEl = doc.querySelector('svg');
  if (!svgEl) return null;

  const paths = [];
  const elements = svgEl.querySelectorAll('path, rect, circle, ellipse, polygon, polyline, line');

  for (const el of elements) {
    const pathData = elementToPathData(el);
    if (pathData) {
      const fill = getComputedFill(el);
      const stroke = getComputedStroke(el);
      const strokeWidth = parseFloat(el.getAttribute('stroke-width')) || 1;
      paths.push({ pathData, fill, stroke, strokeWidth });
    }
  }

  if (paths.length === 0) return null;

  if (paths.length === 1) {
    const p = paths[0];
    const paperPath = new paper.CompoundPath(p.pathData);
    if (scale !== 1) paperPath.scale(scale, new paper.Point(0, 0));
    if (x !== 0 || y !== 0) paperPath.translate(new paper.Point(x, y));
    const bounds = paperPath.bounds;
    const finalPathData = paperPath.pathData;
    paperPath.remove();
    return {
      type: 'booleanResult',
      pathData: finalPathData,
      fill: p.fill,
      stroke: p.stroke,
      strokeWidth: p.strokeWidth,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    };
  }

  const children = paths.map((p) => {
    const paperPath = new paper.CompoundPath(p.pathData);
    if (scale !== 1) paperPath.scale(scale, new paper.Point(0, 0));
    if (x !== 0 || y !== 0) paperPath.translate(new paper.Point(x, y));
    const bounds = paperPath.bounds;
    const finalPathData = paperPath.pathData;
    paperPath.remove();
    return {
      type: 'booleanResult',
      pathData: finalPathData,
      fill: p.fill,
      stroke: p.stroke,
      strokeWidth: p.strokeWidth,
      bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
    };
  });

  const allBounds = children.map((c) => c.bounds);
  const minX = Math.min(...allBounds.map((b) => b.x));
  const minY = Math.min(...allBounds.map((b) => b.y));
  const maxX = Math.max(...allBounds.map((b) => b.x + b.width));
  const maxY = Math.max(...allBounds.map((b) => b.y + b.height));

  return {
    type: 'group',
    children,
    bounds: { x: minX, y: minY, width: maxX - minX, height: maxY - minY },
  };
}

function elementToPathData(el) {
  const tag = el.tagName.toLowerCase();

  if (tag === 'path') {
    return el.getAttribute('d');
  }

  if (tag === 'rect') {
    const rx = parseFloat(el.getAttribute('x')) || 0;
    const ry = parseFloat(el.getAttribute('y')) || 0;
    const w = parseFloat(el.getAttribute('width')) || 0;
    const h = parseFloat(el.getAttribute('height')) || 0;
    if (w === 0 || h === 0) return null;
    return `M${rx},${ry} L${rx + w},${ry} L${rx + w},${ry + h} L${rx},${ry + h} Z`;
  }

  if (tag === 'circle') {
    const cx = parseFloat(el.getAttribute('cx')) || 0;
    const cy = parseFloat(el.getAttribute('cy')) || 0;
    const r = parseFloat(el.getAttribute('r')) || 0;
    if (r === 0) return null;
    return `M${cx - r},${cy} A${r},${r} 0 1,0 ${cx + r},${cy} A${r},${r} 0 1,0 ${cx - r},${cy} Z`;
  }

  if (tag === 'ellipse') {
    const cx = parseFloat(el.getAttribute('cx')) || 0;
    const cy = parseFloat(el.getAttribute('cy')) || 0;
    const rx = parseFloat(el.getAttribute('rx')) || 0;
    const ry = parseFloat(el.getAttribute('ry')) || 0;
    if (rx === 0 || ry === 0) return null;
    return `M${cx - rx},${cy} A${rx},${ry} 0 1,0 ${cx + rx},${cy} A${rx},${ry} 0 1,0 ${cx - rx},${cy} Z`;
  }

  if (tag === 'polygon' || tag === 'polyline') {
    const pts = el.getAttribute('points');
    if (!pts) return null;
    const coords = pts.trim().split(/[\s,]+/).map(Number);
    if (coords.length < 4) return null;
    let d = `M${coords[0]},${coords[1]}`;
    for (let i = 2; i < coords.length; i += 2) {
      d += ` L${coords[i]},${coords[i + 1]}`;
    }
    if (tag === 'polygon') d += ' Z';
    return d;
  }

  if (tag === 'line') {
    const x1 = parseFloat(el.getAttribute('x1')) || 0;
    const y1 = parseFloat(el.getAttribute('y1')) || 0;
    const x2 = parseFloat(el.getAttribute('x2')) || 0;
    const y2 = parseFloat(el.getAttribute('y2')) || 0;
    return `M${x1},${y1} L${x2},${y2}`;
  }

  return null;
}

function getComputedFill(el) {
  const fill = el.getAttribute('fill');
  if (fill && fill !== 'none') return fill;
  const style = el.getAttribute('style') || '';
  const match = style.match(/fill:\s*([^;]+)/);
  if (match && match[1].trim() !== 'none') return match[1].trim();
  if (!fill) return '#000000';
  return 'none';
}

function getComputedStroke(el) {
  const stroke = el.getAttribute('stroke');
  if (stroke) return stroke;
  const style = el.getAttribute('style') || '';
  const match = style.match(/stroke:\s*([^;]+)/);
  if (match) return match[1].trim();
  return 'none';
}

const imageDimensionCache = new Map();

function parseImage(dataUrl, x, y, scale) {
  if (imageDimensionCache.has(dataUrl)) {
    const { w: natW, h: natH } = imageDimensionCache.get(dataUrl);
    const w = natW * scale;
    const h = natH * scale;
    return {
      type: 'image',
      dataUrl,
      x,
      y,
      width: w,
      height: h,
      bounds: { x, y, width: w, height: h },
    };
  }

  const img = new Image();
  img.onload = () => {
    imageDimensionCache.set(dataUrl, { w: img.naturalWidth, h: img.naturalHeight });
    window.dispatchEvent(new CustomEvent('import-image-loaded'));
  };
  img.src = dataUrl;

  return {
    type: 'image',
    dataUrl,
    x,
    y,
    width: 200 * scale,
    height: 200 * scale,
    bounds: { x, y, width: 200 * scale, height: 200 * scale },
  };
}
