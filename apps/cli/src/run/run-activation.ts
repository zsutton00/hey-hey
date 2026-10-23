import { resolveAgentProviderId } from '../agents/providers/provider-config';
import type { AgenticSession } from '../session/types';
import type { RunArgs } from './run';

export class RunActivationContextError extends Error {
  public constructor(readonly field: string) {
    super(`Cannot activate persisted Run: ${field} is missing.`);
    this.name = 'RunActivationContextError';
  }
}

const requireNonEmpty = (value: string | undefined, field: string): string => {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RunActivationContextError(field);
  }
  return value;
};

/**
 * Maps the durable AgenticSession identity into the single in-process Run
 * activation shape used by both startup restoration and message dispatch.
 */
export const createRunArgsFromSession = (session: AgenticSession): RunArgs => {
  const runId = requireNonEmpty(session.agentic_session_id, 'agentic_session_id');
  const conversationId = requireNonEmpty(session.conversationId, 'conversationId');
  const organizationId = requireNonEmpty(
    session.contextMetadata?.organizationId,
    'contextMetadata.organizationId',
  );
  const projectId = requireNonEmpty(
    session.contextMetadata?.projectId,
    'contextMetadata.projectId',
  );
  requireNonEmpty(session.contextMetadata?.agentSessionId, 'contextMetadata.agentSessionId');

  return {
    runId,
    organizationId,
    projectId,
    conversationId,
    provider: resolveAgentProviderId(session.provider),
    session,
    hasProviderSession:
      Boolean(session.provider_session_id) && !session.provider_session_id.startsWith('pending_'),
    skipProjectAssistant: session.projectAssistantDone === true,
    startedPromptTypes: session.startedPromptTypes ?? [],
  };
};
