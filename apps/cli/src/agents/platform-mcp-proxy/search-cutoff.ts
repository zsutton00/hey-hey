import type { JsonObject } from './session';

/**
 * The earlier of the agent's own `createdBefore` and the Run's cutoff. `createdBefore` is shared
 * by every query of a batched call, so one rewrite covers `query` and `queries`.
 */
export const withSearchCutoff = (args: JsonObject, cutoff: string): JsonObject => {
  const supplied = args['createdBefore'];
  const suppliedAt = typeof supplied === 'string' ? Date.parse(supplied) : Number.NaN;
  const keepSupplied = !Number.isNaN(suppliedAt) && suppliedAt < Date.parse(cutoff);

  return keepSupplied ? args : { ...args, createdBefore: cutoff };
};
