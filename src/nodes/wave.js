import paper from 'paper';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

export function waveRuntime(params) {
  ensurePaper();

  const type = params.wave_type || 'Sine';
  const freq = params.frequency || 3;
  const amp = params.amplitude || 50;
  const len = params.wavelength || 400;
  const phaseDeg = params.phase || 0;
  const phase = (phaseDeg * Math.PI) / 180;
  const layers = Math.max(1, Math.min(10, Math.round(params.layers || 1)));
  const layerOffset = params.layer_offset || 20;
  const cx = params.x || 0;
  const cy = params.y || 0;
  const strokeColor = params.stroke_color || '#000000';
  const strokeWidth = params.stroke_width ?? 1;

  const steps = 400;
  const allPaths = [];

  for (let layer = 0; layer < layers; layer++) {
    const yOff = layer * layerOffset;
    const path = new paper.Path();

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = t * len - len / 2;
      const angle = 2 * Math.PI * freq * t + phase + layer * 0.5;
      let y;

      switch (type) {
        case 'Triangle':
          y = amp * (2 * Math.abs(2 * ((freq * t + phaseDeg / 360) % 1) - 1) - 1);
          break;
        case 'Sawtooth':
          y = amp * (2 * ((freq * t + phaseDeg / 360) % 1) - 1);
          break;
        case 'Square':
          y = amp * (Math.sin(angle) >= 0 ? 1 : -1);
          break;
        default:
          y = amp * Math.sin(angle);
      }

      path.add(new paper.Point(cx + x, cy + y + yOff));
    }
    allPaths.push(path);
  }

  const compound = new paper.CompoundPath({ children: allPaths });
  const pathData = compound.pathData;
  const bounds = compound.bounds;
  compound.remove();

  return {
    type: 'booleanResult',
    pathData,
    fill: 'none',
    stroke: strokeColor,
    strokeWidth,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}
