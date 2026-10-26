import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { PromptTypeHandler } from '../prompt-type-handler';

/** The normal tool-free preparation call, on the attempt's selected runtime. */
export const evalPreparationHandler: PromptTypeHandler<{ prompt: string }> = {
  id: 'eval_preparation',
  promptType: LocalPromptType.ProjectAssistant,
  service: 'optional',
  launchEntity: 'none',
  implementationReadiness: 'none',
  runnerKind: 'provider_session',
  providerSessionCountsForContext: false,
  reports: [],
  replaceProviderSystemPrompt: true,
  omitServiceContextNote: true,
  childConfig: {
    adapterId: 'eval-preparation',
    mcpAllowedTools: [],
    builtinAllowedTools: [],
    submissionTools: 'none',
    codexSandboxMode: 'read-only',
    includePriorReports: false,
    emitNormalizedEvents: false,
  },
  buildPrompt: ({ prompt }) => prompt,
};
