import type { PromptTypeHandler } from '../prompt-type-handler';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated';

/**
 * Sentinel handler for `workflow-defined`. This promptType is never
 * dispatched to a handler — the message service resolves it to a real
 * promptType before the runtime sees it. This stub exists so the
 * exhaustive registry record stays complete at the type level.
 */
export const workflowDefinedStub: PromptTypeHandler<unknown> = {
  id: 'workflow-defined',
  promptType: LocalPromptType.WorkflowDefined,
  service: 'required',
  launchEntity: 'none',
  implementationReadiness: 'none',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  buildPrompt: () => '',
};
