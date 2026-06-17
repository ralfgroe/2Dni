// Custom ESM resolver: lets Node import the app's extensionless ".js" specifiers
// (Vite resolves these normally) and stubs the browser-only fontLoader so the
// dimension module's dependency graph loads headless.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync } from 'node:fs';
import path from 'node:path';

const FONT_LOADER = path.resolve('src/utils/fontLoader.js');

export async function resolve(specifier, context, nextResolve) {
  // Redirect the browser font loader to a headless stub.
  if (specifier.endsWith('fontLoader') || specifier.endsWith('fontLoader.js')) {
    return { url: pathToFileURL(path.resolve('scripts/fontLoaderStub.mjs')).href, shortCircuit: true };
  }
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    let base;
    try { base = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd(); }
    catch { base = process.cwd(); }
    const abs = path.resolve(base, specifier);
    for (const ext of ['', '.js', '.jsx', '.mjs']) {
      const candidate = abs + ext;
      if (existsSync(candidate) && !candidate.endsWith('/')) {
        return { url: pathToFileURL(candidate).href, shortCircuit: true };
      }
    }
  }
  return nextResolve(specifier, context);
}
