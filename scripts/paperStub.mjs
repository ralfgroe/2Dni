// Stub for 'paper' in headless tests. Only the surface the dimension glue might
// touch is provided; the pure constraint solver does not use it at all.
const noop = () => {};
const paper = new Proxy({}, {
  get() { return noop; },
});
export default paper;
