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
  return v0 + (v1 - v0) * eased;
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
