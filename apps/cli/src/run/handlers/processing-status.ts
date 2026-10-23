/**
 * Handler: processing_status
 *
 * Provider activity phase updates.
 *
 * The local browser processing-status transport was removed. Provider phases
 * still feed the platform current-state publisher through the Run owner.
 */

import type { ProcessingStatusEvent, HandlerDeps } from '../types';
import type { Run } from '../run';

export const handleProcessingStatus = (
  event: ProcessingStatusEvent,
  ctx: Run,
  deps: HandlerDeps,
): void => {
  deps.logger.trace('run.handler.processing_status', {
    runId: ctx.runId,
    loadingText: event.loadingText,
    toolName: event.toolName,
    toolPhase: event.toolPhase,
    phase: event.phase,
  });

  if (event.phase !== undefined) {
    ctx.observeProviderSessionPhase(event.phase);
  }
};
