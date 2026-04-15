import { lineRuntime } from '../nodes/line';
import { rectangleRuntime } from '../nodes/rectangle';
import { circleRuntime } from '../nodes/circle';
import { mergeRuntime } from '../nodes/merge';
import { transformRuntime } from '../nodes/transform';
import { textRuntime } from '../nodes/text';
import { codeRuntime } from '../nodes/code';
import { booleanRuntime } from '../nodes/boolean';
import { radiusRuntime } from '../nodes/radius';
import { exportRuntime } from '../nodes/export';
import { colorRuntime } from '../nodes/color';
import { polygonRuntime } from '../nodes/polygon';
import { fuseRuntime } from '../nodes/fuse';
import { offsetRuntime } from '../nodes/offset';
import { freecurveRuntime } from '../nodes/freecurve';
import { bezierRuntime } from '../nodes/bezier';
import { copymoveRuntime } from '../nodes/copymove';
import { copyrotateRuntime } from '../nodes/copyrotate';
import { pointtransformRuntime } from '../nodes/pointtransform';
import { geometricstarRuntime } from '../nodes/islamicstar';
import { mirrorRuntime } from '../nodes/mirror';
import { alignRuntime } from '../nodes/align';
import { importRuntime } from '../nodes/import';
import { splitRuntime } from '../nodes/split';
import { layersRuntime } from '../nodes/layers';
import { spirographRuntime } from '../nodes/spirograph';
import { lissajousRuntime } from '../nodes/lissajous';
import { phyllotaxisRuntime } from '../nodes/phyllotaxis';
import { waveRuntime } from '../nodes/wave';
import { lsystemRuntime } from '../nodes/lsystem';
import { voronoiRuntime } from '../nodes/voronoi';
import { noisedeformRuntime } from '../nodes/noisedeform';
import { subdivideRuntime } from '../nodes/subdivide';
import { scatterRuntime } from '../nodes/scatter';
import { symmetryRuntime } from '../nodes/symmetry';
import { interpolateRuntime } from '../nodes/interpolate';
import { stippleRuntime } from '../nodes/stipple';
import { convertRuntime } from '../nodes/convert';
import { objectsRuntime } from '../nodes/objects';

const runtimeMap = {
  line: lineRuntime,
  rectangle: rectangleRuntime,
  circle: circleRuntime,
  merge: mergeRuntime,
  transform: transformRuntime,
  text: textRuntime,
  code: codeRuntime,
  boolean: booleanRuntime,
  radius: radiusRuntime,
  export: exportRuntime,
  color: colorRuntime,
  polygon: polygonRuntime,
  fuse: fuseRuntime,
  offset: offsetRuntime,
  freecurve: freecurveRuntime,
  bezier: bezierRuntime,
  copymove: copymoveRuntime,
  copyrotate: copyrotateRuntime,
  pointtransform: pointtransformRuntime,
  islamicstar: geometricstarRuntime,
  geometricstar: geometricstarRuntime,
  mirror: mirrorRuntime,
  align: alignRuntime,
  import: importRuntime,
  split: splitRuntime,
  layers: layersRuntime,
  spirograph: spirographRuntime,
  lissajous: lissajousRuntime,
  phyllotaxis: phyllotaxisRuntime,
  wave: waveRuntime,
  lsystem: lsystemRuntime,
  voronoi: voronoiRuntime,
  noisedeform: noisedeformRuntime,
  subdivide: subdivideRuntime,
  scatter: scatterRuntime,
  symmetry: symmetryRuntime,
  interpolate: interpolateRuntime,
  stipple: stippleRuntime,
  convert: convertRuntime,
  objects: objectsRuntime,
};

export function getRuntime(runtimeId) {
  return runtimeMap[runtimeId] || null;
}
