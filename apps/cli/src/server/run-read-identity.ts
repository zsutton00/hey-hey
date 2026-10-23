import { createRunArgsFromSession, RunActivationContextError } from '../run/run-activation';
import type { RunArgs } from '../run/run';
import type { AgenticSession } from '../session/types';
import { RunReadPreparationError } from './run-read-preparation-error';

/**
 * Validate and map only the durable identity needed to reconstruct a Run.
 *
 * Identity-only reads use this boundary because repository services and durable
 * file membership belong to changed-file projections, not Run identity.
 */
export const prepareRunIdentity = (runId: string, session: AgenticSession | null): RunArgs => {
  if (!session) {
    throw new RunReadPreparationError('RUN_NOT_FOUND', `Persisted Run not found: ${runId}`);
  }
  if (session.agentic_session_id !== runId) {
    throw new RunReadPreparationError(
      'RUN_ID_MISMATCH',
      'The persisted Run identity does not match the requested Run.',
    );
  }
  if (session.contextMetadata.agentSessionId !== runId) {
    throw new RunReadPreparationError(
      'INVALID_RUN_CONTEXT',
      'The persisted Run is not bound to the requested Agent Session.',
    );
  }

  try {
    return createRunArgsFromSession(session);
  } catch (error) {
    if (error instanceof RunActivationContextError) {
      throw new RunReadPreparationError('INVALID_RUN_CONTEXT', error.message, { cause: error });
    }
    throw error;
  }
};
