import type { EvalSearchScope } from '../../shared/agent-bridge-contract/runtime-types';
import type { JsonObject } from './session';

/** Hide results connected to the case, nothing more than its direct connections. */
export const EXCLUDE_CONNECTED_DEPTH = 1;

/**
 * Applies an eval attempt's search scope to a `unified_search` call: the earlier of the agent's own
 * `createdBefore` and the case's creation time, and the platform's `excludeConnected`, which
 * replaces anything the agent sent. Both are shared by every query of a batched call, so one
 * rewrite covers `query` and `queries`.
 */
export const withSearchScope = (args: JsonObject, scope: EvalSearchScope): JsonObject => {
  const supplied = args['createdBefore'];
  const suppliedAt = typeof supplied === 'string' ? Date.parse(supplied) : Number.NaN;
  const keepSupplied = !Number.isNaN(suppliedAt) && suppliedAt < Date.parse(scope.createdBefore);

  return {
    ...args,
    ...(keepSupplied ? {} : { createdBefore: scope.createdBefore }),
    excludeConnected: { entityIds: [...scope.excludeConnectedTo], depth: EXCLUDE_CONNECTED_DEPTH },
  };
};
