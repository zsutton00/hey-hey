import type { AgenticSession } from '../../session/types';
import type { LocalDebugPromptPayload } from '../../shared/agent-bridge-contract/index';
import type {
  LocalWorktreeStateByService,
  ResolvedServiceBinding,
} from '../../shared/agent-bridge-contract/contract';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated';
import {
  defaultAddUserMessage,
  type PrepareResult,
  type PromptTypeHandlerContext,
  type PromptTypeHandlerDeps,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { buildDebugPrompt } from '../prompts/debug';
import { requestAgentSessionServiceScopeTool } from '../service-scope-request/service-scope-tool';
import { buildStartingMessage as buildStartingMessageForPromptType } from '../prompts/starting-message';

type EnrichedDebugPromptPayload = LocalDebugPromptPayload & {
  _services?: ResolvedServiceBinding[];
  _launchServiceId?: string;
  _worktreeState?: LocalWorktreeStateByService;
};

export const debugHandler: UserLaunchablePromptTypeHandler<LocalDebugPromptPayload> = {
  id: 'debug',
  promptType: LocalPromptType.Debug,
  service: 'required',
  launchEntity: 'required',
  implementationReadiness: 'gated_and_clarifiable',
  graphResearchGuidance: true,
  epistemicCalibration: true,
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  submissionTools: [requestAgentSessionServiceScopeTool],

  async prepare(
    run: AgenticSession,
    payload: LocalDebugPromptPayload,
    _deps: PromptTypeHandlerDeps,
  ): Promise<PrepareResult<LocalDebugPromptPayload>> {
    const enriched: EnrichedDebugPromptPayload = {
      ...payload,
      ...(run.services && run.services.length > 0 ? { _services: run.services } : {}),
      ...(run.launchServiceId ? { _launchServiceId: run.launchServiceId } : {}),
      ...(run.worktreeState ? { _worktreeState: run.worktreeState } : {}),
    };
    return { payload: enriched };
  },

  buildPrompt(payload: LocalDebugPromptPayload, ctx?: PromptTypeHandlerContext): string {
    const enriched = payload as EnrichedDebugPromptPayload;
    return buildDebugPrompt(payload, {
      services: enriched._services,
      launchServiceId: enriched._launchServiceId,
      worktreeState: enriched._worktreeState,
      focalEntityId: ctx?.entity?.entityId,
    });
  },

  addUserMessage: defaultAddUserMessage,

  buildStartingMessage(
    payload: LocalDebugPromptPayload,
    ctx?: PromptTypeHandlerContext,
  ): string | null {
    if (payload.userMessage) {
      return `"${payload.userMessage}"\n\nI'll get started...`;
    }
    return buildStartingMessageForPromptType('free_form', payload, ctx);
  },
};
