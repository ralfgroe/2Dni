export function codeRuntime(params, inputs) {
  const { code = 'return input;' } = params;
  const input = inputs.geometry_in || null;

  try {
    const fn = new Function('input', code);
    const result = fn(input);
    return result || input;
  } catch (e) {
    return {
      type: 'error',
      message: e.message,
      source: input,
    };
  }
}
