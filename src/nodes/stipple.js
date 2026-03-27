import paper from 'paper';
import { geoToPaperPath } from '../utils/geoPathUtils';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;
function ensurePaper() {
  if (!paperInitialized && canvas) { paper.setup(canvas); paperInitialized = true; }
}

export function stippleRuntime(params, inputs) {
  ensurePaper();

  const geo = inputs?.geometry_in;
  if (!geo) return null;

  const pattern = params.pattern ?? 'Dots';
  const spacing = Math.max(3, params.spacing ?? 8);
  const minSize = params.min_size ?? 1;
  const maxSize = params.max_size ?? 4;
  const angleDeg = params.angle ?? 0;
  const centerOffX = params.center_x ?? 0;
  const centerOffY = params.center_y ?? 0;
  const fillColor = params.fill_color ?? '#000000';

  const srcPath = geoToPaperPath(geo);
  if (!srcPath) return geo;

  const b = srcPath.bounds;
  const pad = Math.max(b.width, b.height);
  const angleRad = (angleDeg * Math.PI) / 180;
  const cosA = Math.cos(angleRad), sinA = Math.sin(angleRad);

  const densityCenter = new paper.Point(b.center.x + centerOffX, b.center.y + centerOffY);

  const paths = [];

  if (pattern === 'Dots' || pattern === 'Concentric') {
    if (pattern === 'Concentric') {
      const cx = densityCenter.x, cy = densityCenter.y;
      const maxR = Math.sqrt(b.width * b.width + b.height * b.height) / 2 +
        Math.sqrt(centerOffX * centerOffX + centerOffY * centerOffY);
      for (let r = spacing; r < maxR; r += spacing) {
        const circum = 2 * Math.PI * r;
        const n = Math.max(8, Math.round(circum / spacing));
        for (let i = 0; i < n; i++) {
          const a = (2 * Math.PI * i) / n;
          const px = cx + r * Math.cos(a);
          const py = cy + r * Math.sin(a);
          const pt = new paper.Point(px, py);
          if (srcPath.contains(pt)) {
            const dist = r / maxR;
            const sz = minSize + (maxSize - minSize) * (1 - dist);
            paths.push(new paper.Path.Circle(pt, sz / 2));
          }
        }
      }
    } else {
      for (let gy = b.y - pad; gy < b.y + b.height + pad; gy += spacing) {
        for (let gx = b.x - pad; gx < b.x + b.width + pad; gx += spacing) {
          const rx = cosA * (gx - b.center.x) - sinA * (gy - b.center.y) + b.center.x;
          const ry = sinA * (gx - b.center.x) + cosA * (gy - b.center.y) + b.center.y;
          const pt = new paper.Point(rx, ry);
          if (srcPath.contains(pt)) {
            const distFromCenter = pt.getDistance(densityCenter) / (pad / 2);
            const sz = minSize + (maxSize - minSize) * (1 - Math.min(1, distFromCenter));
            paths.push(new paper.Path.Circle(pt, sz / 2));
          }
        }
      }
    }
  } else {
    const isHatch = pattern === 'Crosshatch';
    const angles = isHatch ? [angleDeg, angleDeg + 90] : [angleDeg];

    for (const aDeg of angles) {
      const aRad = (aDeg * Math.PI) / 180;
      const cos2 = Math.cos(aRad), sin2 = Math.sin(aRad);

      for (let offset = -pad; offset < pad; offset += spacing) {
        const x1 = b.center.x + cos2 * (-pad) - sin2 * offset;
        const y1 = b.center.y + sin2 * (-pad) + cos2 * offset;
        const x2 = b.center.x + cos2 * pad - sin2 * offset;
        const y2 = b.center.y + sin2 * pad + cos2 * offset;

        const line = new paper.Path();
        line.add(new paper.Point(x1, y1));
        line.add(new paper.Point(x2, y2));

        const intersections = line.getIntersections(srcPath);
        if (intersections.length >= 2) {
          intersections.sort((a, b2) => a.offset - b2.offset);
          for (let i = 0; i < intersections.length - 1; i += 2) {
            const seg = new paper.Path();
            seg.add(intersections[i].point);
            seg.add(intersections[i + 1].point);
            paths.push(seg);
          }
        }
        line.remove();
      }
    }
  }

  srcPath.remove();
  if (paths.length === 0) return null;

  const compound = new paper.CompoundPath({ children: paths });
  const pathData = compound.pathData;
  const bounds = compound.bounds;
  compound.remove();

  const isDots = pattern === 'Dots' || pattern === 'Concentric';
  return {
    type: 'booleanResult',
    pathData,
    fill: isDots ? fillColor : 'none',
    stroke: isDots ? 'none' : fillColor,
    strokeWidth: isDots ? 0 : 1,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}
