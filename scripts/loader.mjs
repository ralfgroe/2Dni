// Minimal ESM loader so headless Node tests can import the app's pure modules
// (the constraint solver) without a DOM. The solver itself has no browser deps;
// this stub just satisfies any incidental `document`/canvas references pulled in
// transitively, keeping the solver test fully headless.
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export async function resolve(specifier, context, nextResolve) {
  // Redirect any 'paper' import to a harmless stub (the solver never needs it,
  // but a shared util might transitively reference it).
  if (specifier === 'paper') {
    return { url: pathToFileURL(path.resolve('scripts/paperStub.mjs')).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
}
