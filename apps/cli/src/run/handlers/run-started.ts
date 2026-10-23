/**
 * Handler: run_started
 *
 * Lifecycle event — the provider session has started.
 * Messages are created by the service layer before the runner starts,
 * not here.
 */

import type { RunStartedEvent, HandlerDeps } from '../types';
import type { Run } from '../run';

export const handleRunStarted = (event: RunStartedEvent, ctx: Run, deps: HandlerDeps): void => {
  deps.logger.debug('local.handler.run_started', {
    runId: ctx.runId,
  });
};
