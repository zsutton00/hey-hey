import type { LocalAgentSearchPromptPayload } from '../../shared/agent-bridge-contract/index';
import {
  defaultAddUserMessage,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { buildAgentSearchPrompt } from '../prompts/agent-search';
import { resolveMcpToolNames } from '../mcp-server-config';

export const agentSearchHandler: UserLaunchablePromptTypeHandler<LocalAgentSearchPromptPayload> = {
  id: 'agent_search',
  promptType: 'agent_search',
  service: 'optional',
  launchEntity: 'required',
  implementationReadiness: 'none',
  expectedResponseTypes: ['agent_search_results_v1'],
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  mcpToolUseCase: 'research',
  builtinTools: [],
  /** Eval-launchable child with the same graph-only surface. */
  childConfig: {
    adapterId: 'eval-agent-search',
    mcpAllowedTools: resolveMcpToolNames({ useCase: 'research' }),
    builtinAllowedTools: [],
    submissionTools: 'none',
    codexSandboxMode: 'read-only',
    includePriorReports: false,
  },
  omitServiceContextNote: true,

  buildPrompt(payload: LocalAgentSearchPromptPayload): string {
    return buildAgentSearchPrompt(payload);
  },

  addUserMessage: defaultAddUserMessage,

  buildStartingMessage(): string | null {
    return 'Searching for relevant entities…';
  },
};
