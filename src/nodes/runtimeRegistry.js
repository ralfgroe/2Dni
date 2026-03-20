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
};

export function getRuntime(runtimeId) {
  return runtimeMap[runtimeId] || null;
}
