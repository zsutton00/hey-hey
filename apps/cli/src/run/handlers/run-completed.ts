/**
 * Handler: run_completed
 *
 * Flushes any pending diffs that were never claimed by a permission event.
 */

import type { RunCompletedEvent, HandlerDeps } from '../types';
import type { Run } from '../run';

export const handleRunCompleted = async (
  event: RunCompletedEvent,
  ctx: Run,
  deps: HandlerDeps,
): Promise<void> => {
  deps.logger.debug('local.handler.run_completed', {
    runId: ctx.runId,
    status: event.status,
  });

  // Clear pending diffs — orphaned diffs whose permission events never arrived.
  // Files are already tracked in ctx.touchedFiles.
  ctx.pendingDiffs.clear();
};
