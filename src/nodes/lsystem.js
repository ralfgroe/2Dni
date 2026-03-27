import paper from 'paper';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

const PRESETS = {
  'Koch Snowflake':      { axiom: 'F--F--F', rule_f: 'F+F--F+F', rule_g: '', angle: 60 },
  'Sierpinski Triangle': { axiom: 'F-G-G', rule_f: 'F-G+F+G-F', rule_g: 'GG', angle: 120 },
  'Dragon Curve':        { axiom: 'F', rule_f: 'F+G', rule_g: 'F-G', angle: 90 },
  'Hilbert Curve':       { axiom: 'A', rule_f: '', rule_g: '', angle: 90,
    rules: { A: '-BF+AFA+FB-', B: '+AF-BFB-FA+' } },
  'Fractal Plant':       { axiom: 'X', rule_f: 'FF', rule_g: '', angle: 25,
    rules: { X: 'F+[[X]-X]-F[-FX]+X' } },
  'Penrose':             { axiom: '[X]++[X]++[X]++[X]++[X]', rule_f: '', rule_g: '', angle: 36,
    rules: { W: 'YF++ZF----XF[-YF----WF]++', X: '+YF--ZF[---WF--XF]+', Y: '-WF++XF[+++YF++ZF]-', Z: '--YF++++WF[+ZF++++XF]--XF', F: '' } },
};

function rewrite(axiom, rules, iterations) {
  let str = axiom;
  for (let i = 0; i < iterations; i++) {
    let next = '';
    for (const ch of str) {
      next += rules[ch] !== undefined ? rules[ch] : ch;
    }
    str = next;
    if (str.length > 500000) break;
  }
  return str;
}

function turtleToPath(str, angleDeg, segLen, cx, cy) {
  const rad = (angleDeg * Math.PI) / 180;
  let x = 0, y = 0, dir = -Math.PI / 2;
  const stack = [];
  const paths = [];
  let currentPath = new paper.Path();
  currentPath.add(new paper.Point(x, y));

  for (const ch of str) {
    switch (ch) {
      case 'F':
      case 'G':
        x += segLen * Math.cos(dir);
        y += segLen * Math.sin(dir);
        currentPath.add(new paper.Point(x, y));
        break;
      case 'f':
        x += segLen * Math.cos(dir);
        y += segLen * Math.sin(dir);
        if (currentPath.segments.length > 1) paths.push(currentPath);
        currentPath = new paper.Path();
        currentPath.add(new paper.Point(x, y));
        break;
      case '+': dir += rad; break;
      case '-': dir -= rad; break;
      case '[': stack.push({ x, y, dir }); break;
      case ']':
        if (currentPath.segments.length > 1) paths.push(currentPath);
        const state = stack.pop();
        if (state) { x = state.x; y = state.y; dir = state.dir; }
        currentPath = new paper.Path();
        currentPath.add(new paper.Point(x, y));
        break;
      default: break;
    }
  }
  if (currentPath.segments.length > 1) paths.push(currentPath);

  const allBounds = paths.reduce((acc, p) => {
    const b = p.bounds;
    return {
      minX: Math.min(acc.minX, b.x),
      minY: Math.min(acc.minY, b.y),
      maxX: Math.max(acc.maxX, b.x + b.width),
      maxY: Math.max(acc.maxY, b.y + b.height),
    };
  }, { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });

  const midX = (allBounds.minX + allBounds.maxX) / 2;
  const midY = (allBounds.minY + allBounds.maxY) / 2;
  const offset = new paper.Point(cx - midX, cy - midY);
  paths.forEach(p => p.translate(offset));

  return paths;
}

export function lsystemRuntime(params) {
  ensurePaper();

  const presetName = params.preset ?? 'Koch Snowflake';
  const preset = PRESETS[presetName];
  const isCustom = presetName === 'Custom';

  const angleDeg = params.angle ?? 60;
  const axiom = params.axiom ?? (isCustom ? 'F' : (preset?.axiom ?? 'F'));
  const iterations = Math.max(1, Math.min(8, Math.round(params.iterations ?? 4)));
  const segLen = (params.length ?? 5) * (params.scale ?? 1);
  const cx = params.x ?? 0;
  const cy = params.y ?? 0;
  const strokeColor = params.stroke_color ?? '#000000';
  const strokeWidth = params.stroke_width ?? 1;

  const rules = {};
  if (params.rule_f) rules['F'] = params.rule_f;
  if (params.rule_g) rules['G'] = params.rule_g;
  if (!isCustom && preset?.rules) {
    Object.assign(rules, preset.rules);
  }

  const str = rewrite(axiom, rules, iterations);
  const paths = turtleToPath(str, angleDeg, segLen, cx, cy);

  if (paths.length === 0) return null;

  const compound = new paper.CompoundPath({ children: paths });
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
