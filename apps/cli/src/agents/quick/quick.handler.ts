import type { AgenticSession } from '../../session/types';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { LocalQuickPromptPayload } from '../../shared/agent-bridge-contract/index';
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
import { changedFileReportingDuty } from '../completion-reconciliation/message-mapper';
import { changedFileReportingPrompt } from '../completion-reconciliation/prompts/common';
import { reportChangedFilesTool } from '../submission-tools/report-changed-files-tool';
import { buildServicesContextBlock, codingRepositoryAuthorityGuidance } from '../prompts/common';

type EnrichedQuickPromptPayload = LocalQuickPromptPayload & {
  _services?: ResolvedServiceBinding[];
  _launchServiceId?: string;
  _worktreeState?: LocalWorktreeStateByService;
};
import { buildStartingMessage as buildStartingMessageForPromptType } from '../prompts/starting-message';

export const quickHandler: UserLaunchablePromptTypeHandler<LocalQuickPromptPayload> = {
  id: 'quick',
  handsOffOrdinaryReplies: true,
  promptType: LocalPromptType.Quick,
  service: 'required',
  launchEntity: 'required',
  implementationReadiness: 'gated_and_clarifiable',
  graphResearchGuidance: true,
  epistemicCalibration: true,
  runnerKind: 'provider_session',
  providerSessionCountsForContext: true,
  reports: [],
  ...changedFileReportingDuty,
  submissionTools: [reportChangedFilesTool],

  async prepare(
    run: AgenticSession,
    payload: LocalQuickPromptPayload,
    _deps: PromptTypeHandlerDeps,
  ): Promise<PrepareResult<LocalQuickPromptPayload>> {
    const enriched: EnrichedQuickPromptPayload = {
      ...payload,
      ...(run.services.length > 0 ? { _services: run.services } : {}),
      ...(run.launchServiceId ? { _launchServiceId: run.launchServiceId } : {}),
      ...(run.worktreeState ? { _worktreeState: run.worktreeState } : {}),
    };
    return { payload: enriched };
  },

  buildPrompt(payload: LocalQuickPromptPayload): string {
    const enriched = payload as EnrichedQuickPromptPayload;
    const servicesContext = buildServicesContextBlock({
      services: enriched._services,
      launchServiceId: enriched._launchServiceId,
      worktreeState: enriched._worktreeState,
    });
    const repositoryContext = servicesContext || codingRepositoryAuthorityGuidance;
    const lines: string[] = ['You are in a Task Only coding session.'];
    if (payload.userMessage.trim().length > 0) {
      lines.push(
        '',
        "The user's kickoff prompt takes precedence. Treat the canonical focal entity projection as context for that prompt.",
      );
    }
    lines.push(
      '',
      repositoryContext,
      '',
      'The canonical focal entity projection is supplied at provider startup. Treat it as the authoritative task context for this quick pass.',
      '',
      changedFileReportingPrompt,
    );
    return lines.join('\n');
  },

  addUserMessage: defaultAddUserMessage,

  buildStartingMessage(
    payload: LocalQuickPromptPayload,
    ctx?: PromptTypeHandlerContext,
  ): string | null {
    if (payload.userMessage) {
      return `"${payload.userMessage}"\n\nI'll get started...`;
    }
    return buildStartingMessageForPromptType('free_form', payload, ctx);
  },
};
