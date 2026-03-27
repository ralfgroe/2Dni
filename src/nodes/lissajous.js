import paper from 'paper';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

const PRESETS = {
  'Figure-8':   { freq_a: 2, freq_b: 1, phase: 90 },
  'Trefoil':    { freq_a: 3, freq_b: 2, phase: 90 },
  'Pentagram':  { freq_a: 5, freq_b: 4, phase: 90 },
  'Bowtie':     { freq_a: 2, freq_b: 3, phase: 0 },
  'Star Knot':  { freq_a: 7, freq_b: 6, phase: 90 },
};

export function lissajousRuntime(params) {
  ensurePaper();

  const a = params.freq_a ?? 3;
  const b = params.freq_b ?? 2;
  const delta = ((params.phase ?? 90) * Math.PI) / 180;
  const w = (params.width ?? 200) / 2;
  const h = (params.height ?? 200) / 2;
  const cx = params.x ?? 0;
  const cy = params.y ?? 0;
  const strokeColor = params.stroke_color ?? '#000000';
  const strokeWidth = params.stroke_width ?? 1;

  const steps = Math.max(500, a * b * 100);
  const path = new paper.Path();

  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * 2 * Math.PI;
    const x = w * Math.sin(a * t + delta);
    const y = h * Math.sin(b * t);
    path.add(new paper.Point(cx + x, cy + y));
  }
  path.closePath();

  const pathData = path.pathData;
  const bounds = path.bounds;
  path.remove();

  return {
    type: 'booleanResult',
    pathData,
    fill: 'none',
    stroke: strokeColor,
    strokeWidth,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}
