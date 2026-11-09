import { SessionRole } from '@hey-hey/contracts/agent-bridge';
import type { LocalAgentSearchPromptPayload } from '../../shared/agent-bridge-contract/index';
import {
  defaultAddUserMessage,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { buildAgentSearchPrompt } from '../prompts/agent-search';
import { resolveMcpToolNames } from '../mcp-server-config';

export const agentSearchHandler: UserLaunchablePromptTypeHandler<LocalAgentSearchPromptPayload> = {
  id: 'agent_search',
  sessionRole: SessionRole.Research,
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
    submissionTools: 'run-registered',
    submissionToolNames: ['raise_uncertainty'],
    mcpAllowedTools: resolveMcpToolNames({ useCase: 'research' }),
    builtinAllowedTools: [],
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
