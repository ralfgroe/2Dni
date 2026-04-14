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

function buildTrianglePoints(freq, amp, len, phaseDeg, cx, cy) {
  const pts = [];
  const phaseNorm = (phaseDeg / 360) % 1;
  const criticals = [];

  criticals.push(0);
  for (let k = 0; k <= Math.ceil(freq) * 2 + 1; k++) {
    const tc = (k * 0.5 - phaseNorm) / freq;
    if (tc > 0 && tc < 1) criticals.push(tc);
  }
  criticals.push(1);
  criticals.sort((a, b) => a - b);

  for (const t of criticals) {
    const x = t * len - len / 2;
    const y = amp * (2 * Math.abs(2 * ((freq * t + phaseNorm) % 1) - 1) - 1);
    pts.push({ x: cx + x, y: cy + y });
  }

  const deduped = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - deduped[deduped.length - 1].x;
    const dy = pts[i].y - deduped[deduped.length - 1].y;
    if (Math.sqrt(dx * dx + dy * dy) > 0.5) deduped.push(pts[i]);
  }
  return deduped;
}

function buildSawtoothPoints(freq, amp, len, phaseDeg, cx, cy) {
  const pts = [];
  const phaseNorm = (phaseDeg / 360) % 1;
  const criticals = [0];

  for (let k = 0; k <= Math.ceil(freq) + 1; k++) {
    const tc = (k - phaseNorm) / freq;
    if (tc > 0 && tc < 1) {
      criticals.push(tc - 1e-9);
      criticals.push(tc);
    }
  }
  criticals.push(1);
  criticals.sort((a, b) => a - b);

  for (const t of criticals) {
    const x = t * len - len / 2;
    const y = amp * (2 * ((freq * t + phaseNorm) % 1) - 1);
    pts.push({ x: cx + x, y: cy + y });
  }

  const deduped = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - deduped[deduped.length - 1].x;
    const dy = pts[i].y - deduped[deduped.length - 1].y;
    if (Math.sqrt(dx * dx + dy * dy) > 0.5) deduped.push(pts[i]);
  }
  return deduped;
}

function buildSquarePoints(freq, amp, len, phase, cx, cy) {
  const pts = [];
  const steps = 400;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = t * len - len / 2;
    const angle = 2 * Math.PI * freq * t + phase;
    const y = amp * (Math.sin(angle) >= 0 ? 1 : -1);
    pts.push({ x: cx + x, y: cy + y });
  }
  return pts;
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

    if (type === 'Triangle') {
      const pts = buildTrianglePoints(freq, amp, len, phaseDeg, cx, cy + yOff);
      for (const pt of pts) path.add(new paper.Point(pt.x, pt.y));
    } else if (type === 'Sawtooth') {
      const pts = buildSawtoothPoints(freq, amp, len, phaseDeg, cx, cy + yOff);
      for (const pt of pts) path.add(new paper.Point(pt.x, pt.y));
    } else if (type === 'Square') {
      const pts = buildSquarePoints(freq, amp, len, phase + layer * 0.5, cx, cy + yOff);
      for (const pt of pts) path.add(new paper.Point(pt.x, pt.y));
      removeCollinearPoints(path);
    } else {
      const steps = 400;
      for (let i = 0; i <= steps; i++) {
        const t = i / steps;
        const x = t * len - len / 2;
        const angle = 2 * Math.PI * freq * t + phase + layer * 0.5;
        const y = amp * Math.sin(angle);
        path.add(new paper.Point(cx + x, cy + y + yOff));
      }
      path.simplify(0.5);
    }

    allPaths.push(path);
  }

  let resultPath;
  if (allPaths.length === 1) {
    resultPath = allPaths[0];
  } else {
    resultPath = new paper.CompoundPath({ children: allPaths });
  }
  const pathData = resultPath.pathData;
  const bounds = resultPath.bounds;
  resultPath.remove();

  return {
    type: 'booleanResult',
    pathData,
    fill: 'none',
    stroke: strokeColor,
    strokeWidth,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}
