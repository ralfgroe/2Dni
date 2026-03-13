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
};

export function getRuntime(runtimeId) {
  return runtimeMap[runtimeId] || null;
}
