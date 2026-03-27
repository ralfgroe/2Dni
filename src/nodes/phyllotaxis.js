import paper from 'paper';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

function trianglePath(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 3; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / 3;
    pts.push(new paper.Point(cx + r * Math.cos(a), cy + r * Math.sin(a)));
  }
  const p = new paper.Path();
  pts.forEach(pt => p.add(pt));
  p.closePath();
  return p;
}

export function phyllotaxisRuntime(params) {
  ensurePaper();

  const count = Math.min(2000, Math.max(1, params.count || 200));
  const spread = params.spread || 8;
  const dotSize = params.dot_size || 3;
  const goldenAngle = (params.angle_offset || 137.508) * Math.PI / 180;
  const scaleDots = params.scale_dots !== false;
  const shape = params.shape || 'Circle';
  const cx = params.x || 0;
  const cy = params.y || 0;
  const fillColor = params.fill_color || '#000000';
  const strokeWidth = params.stroke_width ?? 0;

  const paths = [];

  for (let i = 0; i < count; i++) {
    const angle = i * goldenAngle;
    const r = spread * Math.sqrt(i);
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    const s = scaleDots ? dotSize * (0.3 + 0.7 * (i / count)) : dotSize;

    let p;
    if (shape === 'Square') {
      p = new paper.Path.Rectangle(new paper.Point(x - s, y - s), new paper.Size(s * 2, s * 2));
    } else if (shape === 'Triangle') {
      p = trianglePath(x, y, s);
    } else {
      p = new paper.Path.Circle(new paper.Point(x, y), s);
    }
    paths.push(p);
  }

  if (paths.length === 0) return null;

  const compound = new paper.CompoundPath({ children: paths });
  const pathData = compound.pathData;
  const bounds = compound.bounds;
  compound.remove();

  return {
    type: 'booleanResult',
    pathData,
    fill: fillColor,
    stroke: strokeWidth > 0 ? '#000000' : 'none',
    strokeWidth,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}
