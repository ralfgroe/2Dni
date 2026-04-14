import paper from 'paper';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

function removeCollinearPoints(path) {
  const EPSILON = 0.5;
  const segs = path.segments;
  if (segs.length < 3) return;

  const toRemove = [];
  for (let i = segs.length - 2; i >= 1; i--) {
    const prev = segs[i - 1].point;
    const curr = segs[i].point;
    const next = segs[i + 1].point;

    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;

    const cross = Math.abs(dx1 * dy2 - dy1 * dx2);
    if (cross < EPSILON) {
      toRemove.push(i);
    }
  }
  for (const i of toRemove) {
    segs[i].remove();
  }
}

export function waveRuntime(params) {
  ensurePaper();

  const type = params.wave_type ?? 'Sine';
  const freq = params.frequency ?? 3;
  const amp = params.amplitude ?? 50;
  const len = params.wavelength ?? 400;
  const phaseDeg = params.phase ?? 0;
  const phase = (phaseDeg * Math.PI) / 180;
  const layers = Math.max(1, Math.min(10, Math.round(params.layers ?? 1)));
  const layerOffset = params.layer_offset ?? 20;
  const cx = params.x ?? 0;
  const cy = params.y ?? 0;
  const strokeColor = params.stroke_color ?? '#000000';
  const strokeWidth = params.stroke_width ?? 1;

  const allPaths = [];

  for (let layer = 0; layer < layers; layer++) {
    const yOff = layer * layerOffset;
    const path = new paper.Path();

    const steps = 400;

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

    if (type === 'Triangle' || type === 'Sawtooth' || type === 'Square') {
      removeCollinearPoints(path);
    } else {
      path.simplify(0.5);
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
