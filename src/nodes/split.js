import paper from 'paper';
import { geoToPaperPath } from '../utils/geoPathUtils';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

function ensurePaper() {
  if (!paperInitialized && canvas) {
    paper.setup(canvas);
    paperInitialized = true;
  }
}

const MAX_OUTPUTS = 3;
const EMPTY = { __multiOutput: true, geo_out_1: null, geo_out_2: null, geo_out_3: null };

function childToGeo(paperPath, srcGeo) {
  const pathData = paperPath.pathData;
  const b = paperPath.bounds;
  return {
    type: 'booleanResult',
    pathData,
    fill: srcGeo.fill || '#ffffff',
    stroke: srcGeo.stroke || '#000000',
    strokeWidth: srcGeo.strokeWidth ?? 1,
    opacity: srcGeo.opacity,
    bounds: { x: b.x, y: b.y, width: b.width, height: b.height },
  };
}

export function splitRuntime(params, inputs) {
  const geo = inputs.geometry_in;
  if (!geo) return EMPTY;

  let pieces = [];

  if (geo.type === 'group' || geo.type === 'boolean') {
    if (geo.children && geo.children.length > 1) {
      pieces = geo.children.slice(0, MAX_OUTPUTS);
    } else {
      pieces = [geo];
    }
  } else if (geo.type === 'booleanResult' && geo.pathData) {
    ensurePaper();
    try {
      const compound = new paper.CompoundPath(geo.pathData);
      if (compound.children && compound.children.length > 1) {
        const count = Math.min(compound.children.length, MAX_OUTPUTS);
        for (let i = 0; i < count; i++) {
          pieces.push(childToGeo(compound.children[i], geo));
        }
        compound.remove();
      } else {
        compound.remove();
        pieces = [geo];
      }
    } catch {
      pieces = [geo];
    }
  } else {
    pieces = [geo];
  }

  return {
    __multiOutput: true,
    geo_out_1: pieces[0] || null,
    geo_out_2: pieces[1] || null,
    geo_out_3: pieces[2] || null,
  };
}
