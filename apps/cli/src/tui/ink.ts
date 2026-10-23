/**
 * Ink is ESM with top-level await, which the CommonJS-compiled CLI sources
 * cannot `require`. It is loaded once through a native dynamic import before
 * anything renders, and components read its primitives from here.
 */

import type * as InkModule from 'ink';

export type Ink = typeof InkModule;

let loaded: Ink | null = null;

export const loadInk = async (): Promise<Ink> => {
  loaded ??= await import('ink');
  return loaded;
};

export const ink = (): Ink => {
  if (!loaded) throw new Error('Ink must be loaded before rendering.');
  return loaded;
};
