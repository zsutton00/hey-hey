import { reportChangedFilesTool } from '../submission-tools/report-changed-files-tool';
import type { AgenticSession } from '../../session/types';
import type { LocalFreeFormPromptPayload } from '../../shared/agent-bridge-contract/index';
import type { Prepared } from '../../shared/agent-bridge-contract/contract';
import { LocalPromptType } from '../../shared/agent-bridge-contract/generated';
import {
  completionResponseHooks,
  changedFileReportingDuty,
} from '../completion-reconciliation/message-mapper';
import {
  defaultAddUserMessage,
  type OnCompleteContext,
  type OnCompleteDeps,
  type PromptTypeHandlerContext,
  type PromptTypeHandlerDeps,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import {
  buildCodingConversationPrompt,
  type CodingConversationPreparedPayload,
} from '../prompts/coding-conversation';
import { buildStartingMessage as buildStartingMessageForPromptType } from '../prompts/starting-message';
import { parseImplementationReadinessResponseFromText } from '../response-parser';
import { taskIdFromHandlerContext } from '../run-entity';
import type { AssistantCompleteEvent } from '../../run/types';
import { requestAgentSessionServiceScopeTool } from '../service-scope-request/service-scope-tool';
import { fetchPriorAssistantMessage } from './prior-assistant-message';
import { submitCodingConversationReadinessTool } from './submit-readiness-tool';

/**
 * Adapter-owned declarations. `id` is the provider-session agent identity a
 * Run persists, so each alias keeps its own; tool access and Project Assistant
 * policy stay declared here rather than branched on the mode.
 */
type CodingConversationDeclaration<TPayload extends CodingConversationPreparedPayload> = Pick<
  UserLaunchablePromptTypeHandler<TPayload>,
  | 'id'
  | 'promptType'
  | 'service'
  | 'launchEntity'
  | 'implementationReadiness'
  | 'graphResearchGuidance'
  | 'epistemicCalibration'
  | 'submissionTools'
  | 'projectAssistant'
  | 'mcpToolUseCase'
  | 'expectedResponseTypes'
  | 'buildStartingMessage'
> & {
  /**
   * `launch` prepares an Open launch: requires the persisted Run entity,
   * carries the readiness preflight, and recognizes `implementation_readiness_v1`
   * ahead of ordinary completion parsing. `follow_up` orients on the previous
   * exchange and on any workflow review the user still owes.
   */
  mode: 'launch' | 'follow_up';
};

const withRunServices = <TPayload extends CodingConversationPreparedPayload>(
  run: AgenticSession,
  payload: TPayload,
): TPayload => ({
  ...payload,
  ...(run.services.length > 0 ? { services: run.services } : {}),
  ...(run.launchServiceId ? { launchServiceId: run.launchServiceId } : {}),
  ...(run.worktreeState ? { worktreeState: run.worktreeState } : {}),
});

/**
 * Builds one conversational coding handler. Both aliases share the prompt
 * policy, the completion-reconciliation hooks and reported-file admission;
 * the declaration's `mode` only selects launch preparation or follow-up
 * orientation.
 */
const createCodingConversationHandler = <TPayload extends CodingConversationPreparedPayload>({
  mode,
  ...declaration
}: CodingConversationDeclaration<TPayload>): UserLaunchablePromptTypeHandler<TPayload> => {
  // Only the launch prompt asks for a readiness response, so only a launch
  // routes it around ordinary completion validation, mapping and file reading.
  const isReadinessResponse = (event: AssistantCompleteEvent): boolean =>
    mode === 'launch' && parseImplementationReadinessResponseFromText(event.summary).ok;

  const persistReadinessResponse = async (
    event: AssistantCompleteEvent,
    ctx: OnCompleteContext,
    deps: OnCompleteDeps,
  ): Promise<boolean> => {
    if (mode !== 'launch') return false;
    const parsed = parseImplementationReadinessResponseFromText(event.summary);
    if (!parsed.ok) return false;

    if (!ctx.run) {
      deps.logger.warn('free_form.implementation_readiness.persistence_skipped', {
        runId: ctx.runId,
        reason: 'run_owner_missing',
      });
      return true;
    }

    await ctx.run.persistImplementationReadinessFromAgentResponse(parsed.value.disposition);
    deps.logger.info('free_form.implementation_readiness.persisted_from_response', {
      runId: ctx.runId,
      state: parsed.value.disposition.state,
      sourceRevision: parsed.value.disposition.sourceSnapshot.sourceRevision,
    });
    return true;
  };

  return {
    ...completionResponseHooks,
    ...changedFileReportingDuty,
    skipChangedFileReporting: isReadinessResponse,
    ...declaration,
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    reports: [],

    async prepare(
      run: AgenticSession,
      payload: TPayload,
      deps: PromptTypeHandlerDeps,
      ctx?: PromptTypeHandlerContext,
    ) {
      if (mode === 'launch') {
        if (!run.entity) {
          deps.logger.error('free_form.prepare.missing_run_entity', {
            runId: run.agentic_session_id,
          });
          throw new Error('free_form handler requires a persisted Run entity.');
        }
        deps.logger.debug('free_form.prepare.run_entity_verified', {
          runId: run.agentic_session_id,
          entityId: run.entity.entityId,
          entityType: run.entity.entityType,
        });
        return { payload: withRunServices(run, payload) };
      }

      const triggerParentMessageId = ctx?.triggerParentMessageId ?? null;
      const priorAssistantMessage =
        triggerParentMessageId !== null
          ? await fetchPriorAssistantMessage(run, triggerParentMessageId, deps)
          : null;
      return {
        payload: {
          ...withRunServices(run, payload),
          ...(run.promptType !== undefined ? { priorPromptType: run.promptType } : {}),
          ...(priorAssistantMessage !== null ? { priorAssistantMessage } : {}),
        },
      };
    },

    buildPrompt(payload: TPayload, ctx?: PromptTypeHandlerContext): string {
      return buildCodingConversationPrompt(
        payload,
        mode === 'launch'
          ? {
              kind: 'launch',
              ...(ctx?.implementationReadinessSourceSnapshot !== undefined
                ? {
                    implementationReadinessSourceSnapshot:
                      ctx.implementationReadinessSourceSnapshot,
                  }
                : {}),
              ...(ctx?.implementationReadinessClarification
                ? { readinessClarification: ctx.implementationReadinessClarification }
                : {}),
            }
          : {
              kind: 'follow_up',
              awaitingUserReview: ctx?.awaitingUserReview === true,
              taskId: taskIdFromHandlerContext(ctx),
            },
        ctx?.startedPromptTypes,
      );
    },

    addUserMessage: defaultAddUserMessage,

    validateCompletion(event) {
      if (isReadinessResponse(event)) return { ok: true };
      return completionResponseHooks.validateCompletion(event);
    },

    transformCompletionOutput(event) {
      if (isReadinessResponse(event)) return null;
      return completionResponseHooks.transformCompletionOutput(event);
    },

    async onComplete(event, ctx, deps) {
      if (await persistReadinessResponse(event, ctx, deps)) return;
      await completionResponseHooks.onComplete(event, ctx, deps);
    },
  };
};

/** Open launch. Alias `free_form`; owns the launch provider session. */
export const freeFormHandler = createCodingConversationHandler<
  Prepared<LocalFreeFormPromptPayload>
>({
  mode: 'launch',
  id: 'free_form',
  promptType: LocalPromptType.FreeForm,
  service: 'required',
  launchEntity: 'required',
  implementationReadiness: 'gated_and_clarifiable',
  graphResearchGuidance: true,
  epistemicCalibration: true,
  projectAssistant: {
    allowEdgeUpdates: false,
    notifyDiscrepancies: false,
    workItemProposalMode: 'all',
  },
  expectedResponseTypes: ['implementation_readiness_v1'],
  submissionTools: [
    reportChangedFilesTool,
    requestAgentSessionServiceScopeTool,
    submitCodingConversationReadinessTool,
  ],
  buildStartingMessage(payload, ctx) {
    if (payload.userMessage) {
      return `"${payload.userMessage}"\n\nI'll get started...`;
    }
    return buildStartingMessageForPromptType('free_form', payload, ctx);
  },
});

/** Coding-session follow-up. Alias `coding_freeform`; owns its own provider session. */
export const codingFreeformHandler =
  createCodingConversationHandler<CodingConversationPreparedPayload>({
    mode: 'follow_up',
    id: 'coding_freeform',
    promptType: LocalPromptType.CodingFreeform,
    service: 'required',
    launchEntity: 'none',
    implementationReadiness: 'gated_and_clarifiable',
    graphResearchGuidance: true,
    epistemicCalibration: true,
    mcpToolUseCase: 'general',
    submissionTools: [
      reportChangedFilesTool,
      requestAgentSessionServiceScopeTool,
    ],
  });
