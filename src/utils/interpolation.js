const EASINGS = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - Math.pow(1 - t, 3),
  easeInOut: (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
  step: () => 0,
};

export function ease(t, easingName) {
  const fn = EASINGS[easingName] || EASINGS.linear;
  return fn(Math.max(0, Math.min(1, t)));
}

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3
    ? h[0]+h[0]+h[1]+h[1]+h[2]+h[2]
    : h;
  return [
    parseInt(full.substring(0, 2), 16),
    parseInt(full.substring(2, 4), 16),
    parseInt(full.substring(4, 6), 16),
  ];
}

function rgbToHex(r, g, b) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
  return '#' + [clamp(r), clamp(g), clamp(b)]
    .map(v => v.toString(16).padStart(2, '0'))
    .join('');
}

function isColorValue(v) {
  return typeof v === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(v);
}

function lerpColor(c0, c1, t) {
  const [r0, g0, b0] = hexToRgb(c0);
  const [r1, g1, b1] = hexToRgb(c1);
  return rgbToHex(
    r0 + (r1 - r0) * t,
    g0 + (g1 - g0) * t,
    b0 + (b1 - b0) * t,
  );
}

export function interpolateValue(paramKeyframes, frame) {
  const frameNums = Object.keys(paramKeyframes).map(Number).sort((a, b) => a - b);
  if (frameNums.length === 0) return undefined;

  if (frameNums.length === 1) {
    return paramKeyframes[frameNums[0]].value;
  }

  if (frame <= frameNums[0]) {
    return paramKeyframes[frameNums[0]].value;
  }
  if (frame >= frameNums[frameNums.length - 1]) {
    return paramKeyframes[frameNums[frameNums.length - 1]].value;
  }

  let lo = 0;
  for (let i = 0; i < frameNums.length - 1; i++) {
    if (frame >= frameNums[i] && frame <= frameNums[i + 1]) {
      lo = i;
      break;
    }
  }

  const f0 = frameNums[lo];
  const f1 = frameNums[lo + 1];
  const kf0 = paramKeyframes[f0];
  const kf1 = paramKeyframes[f1];
  const v0 = kf0.value;
  const v1 = kf1.value;

  if (f0 === f1) return v0;

  const easingName = kf1.easing || 'linear';
  if (easingName === 'step') return v0;

  const t = (frame - f0) / (f1 - f0);
  const eased = ease(t, easingName);

  if (isColorValue(v0) && isColorValue(v1)) {
    return lerpColor(v0, v1, eased);
  }

  if (typeof v0 === 'number' && typeof v1 === 'number') {
    return v0 + (v1 - v0) * eased;
  }

  return v0;
}

export function resolveParamsAtFrame(nodeParams, nodeKeyframes, frame) {
  if (!nodeKeyframes || Object.keys(nodeKeyframes).length === 0) return nodeParams;

  const resolved = { ...nodeParams };
  for (const [paramId, paramKfs] of Object.entries(nodeKeyframes)) {
    const val = interpolateValue(paramKfs, frame);
    if (val !== undefined) {
      resolved[paramId] = val;
    }
  }
  return resolved;
}

export function resolveAllNodesAtFrame(nodes, allKeyframes, frame) {
  if (!allKeyframes || Object.keys(allKeyframes).length === 0) return nodes;

  return nodes.map((node) => {
    const nodeKfs = allKeyframes[node.id];
    if (!nodeKfs) return node;
    const resolvedParams = resolveParamsAtFrame(node.data.params, nodeKfs, frame);
    if (resolvedParams === node.data.params) return node;
    return {
      ...node,
      data: { ...node.data, params: resolvedParams },
    };
  });
}

export const EASING_OPTIONS = [
  { id: 'linear', label: 'Linear' },
  { id: 'easeIn', label: 'Ease In' },
  { id: 'easeOut', label: 'Ease Out' },
  { id: 'easeInOut', label: 'Ease In-Out' },
  { id: 'step', label: 'Step (Hold)' },
];
