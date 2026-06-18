// Null node: a transparent pass-through, mirroring Houdini's Null SOP.
// It returns its single input unchanged and serves as a stable reference
// point / bookmark in the network. Returns null when nothing is connected.
export function nullRuntime(params, inputs) {
  return inputs.geometry_in ?? null;
}
