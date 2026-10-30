import type { AgenticSession } from '../../session/types';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { LocalResearchPromptPayload } from '../../shared/agent-bridge-contract/index';
import type {
  LocalWorktreeStateByService,
  ResolvedServiceBinding,
} from '../../shared/agent-bridge-contract/contract';
import {
  defaultAddUserMessage,
  type PrepareResult,
  type PromptTypeHandlerContext,
  type PromptTypeHandlerDeps,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import type { ProjectAssistantChildChecks } from '../prompts/project-assistant';
import { buildResearchPrompt } from '../prompts/research';
import { buildStartingMessage as buildStartingMessageForPromptType } from '../prompts/starting-message';

/** What a Project Assistant fan-out passes to each research child. */
export type ResearchChildPayload = LocalResearchPromptPayload & {
  _projectAssistantChecks: ProjectAssistantChildChecks;
};

type EnrichedPayload = LocalResearchPromptPayload & {
  _touchedFiles?: readonly string[];
  _projectAssistantChecks?: ProjectAssistantChildChecks;
  _services?: ResolvedServiceBinding[];
  _launchServiceId?: string;
  _worktreeState?: LocalWorktreeStateByService;
};

export const researchHandler: UserLaunchablePromptTypeHandler<LocalResearchPromptPayload> = {
  id: 'research',
  promptType: LocalPromptType.Research,
  service: 'required',
  launchEntity: 'required',
  implementationReadiness: 'none',
  graphResearchGuidance: true,
  epistemicCalibration: true,
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  mcpToolUseCase: 'research',
  replaceProviderSystemPrompt: true,
  childConfig: {
    adapterId: 'collaboration-research-subagent',
    mcpAllowedTools: [
      'get_context',
      'get_edges',
      'get_full_entity',
      'get_agent_session',
      'get_diagram',
      'get_work_item_type_guidance_batch',
      'unified_search',
      'search_implementation_hints',
      'list_services',
    ],
    builtinAllowedTools: ['Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
    submissionTools: 'none',
    codexSandboxMode: 'read-only',
  },

  addUserMessage: defaultAddUserMessage,

  async prepare(
    run: AgenticSession,
    payload: LocalResearchPromptPayload,
    _deps: PromptTypeHandlerDeps,
  ): Promise<PrepareResult<LocalResearchPromptPayload>> {
    const enriched: EnrichedPayload = {
      ...payload,
      ...(run.services && run.services.length > 0 ? { _services: run.services } : {}),
      ...(run.launchServiceId ? { _launchServiceId: run.launchServiceId } : {}),
      ...(run.worktreeState ? { _worktreeState: run.worktreeState } : {}),
    };
    return { payload: enriched };
  },

  buildPrompt(payload: LocalResearchPromptPayload, ctx?: PromptTypeHandlerContext): string {
    const enriched = payload as EnrichedPayload;
    return buildResearchPrompt(
      payload,
      {
        services: enriched._services,
        launchServiceId: enriched._launchServiceId,
        worktreeState: enriched._worktreeState,
        focalEntityId: ctx?.entity?.entityId,
      },
      Array.isArray(enriched._touchedFiles),
      enriched._projectAssistantChecks,
      ctx?.provider,
    );
  },

  buildStartingMessage(
    payload: LocalResearchPromptPayload,
    ctx?: PromptTypeHandlerContext,
  ): string | null {
    if (payload.userMessage) {
      return `"${payload.userMessage}"\n\nI'll get started...`;
    }
    return buildStartingMessageForPromptType('free_form', payload, ctx);
  },
};
