/**
 * `feature_sync_analyze` prompt-type handler.
 *
 * Invoked by the CLI when the user submits a reply in a conversation whose
 * current server-side node is the feature-sync `analyze` EXTERNAL_AGENT node
 * (`api/src/flows/nodes/feature-sync/analyze.node.ts`). The handler:
 *
 * 1. Reads the task id off the typed wire payload (the API binds it on the
 *    trigger) and feeds it plus any user-typed hint into the system prompt
 *    so the local agent can ground its feature-tree walk.
 * 2. Exposes the existing structural completion tools plus the typed
 *    implementation-readiness verdict; the server's action schemas
 *    (`featureSyncAnalyzeActions`) re-validate each action payload.
 *
 * No platform HTTP calls happen in `prepare()` — the agent uses the
 * already-mounted platform MCP tools (`get_context`, `search_features`, etc.)
 * to gather what it needs.
 */

import { LocalPromptType } from '../../shared/agent-bridge-contract/generated/api';
import type { LocalFeatureSyncAnalyzePromptPayload } from '../../shared/agent-bridge-contract/runtime-types';
import { ReportAudience, ReportType } from '../../shared/api/index';
import {
  turnUserMessageBlock,
  type PromptTypeHandlerDeps,
  type PromptTypeHandlerContext,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import type { AgenticSession } from '../../session/types';
import { buildAnalyzePrompt } from './prompts';
import { analyzeSubmissionTools } from './submission-tools';

/**
 * The analyze payload enriched by `prepare` with whether a `project_assistant`
 * memo is present on the run. `buildPrompt` reads it back to decide whether the
 * prompt gets the research-lens section. The memo content itself is already in
 * the prompt — `resolvePrompt` auto-prepends the run's memos as a
 * `## Context from prior phases` block for provider_session flows — so the flag
 * is all the prompt builder needs.
 */
interface EnrichedFeatureSyncAnalyzePromptPayload extends LocalFeatureSyncAnalyzePromptPayload {
  _hasResearch?: boolean;
  _featureSeed?: boolean;
}

export const featureSyncAnalyzeHandler: UserLaunchablePromptTypeHandler<LocalFeatureSyncAnalyzePromptPayload> =
  {
    id: 'feature_sync_analyze',
    promptType: LocalPromptType.FeatureSyncAnalyze,
    service: 'required',
    launchEntity: 'required',
    implementationReadiness: 'none',
    projectAssistant: {
      allowEdgeUpdates: false,
      notifyDiscrepancies: false,
      workItemProposalMode: 'all',
    },
    runnerKind: 'provider_session',
    providerSessionCountsForContext: true,
    reports: [
      {
        reportType: ReportType.FeatureSync,
        audience: ReportAudience.ProjectVisible,
        required: true,
      },
      {
        reportType: ReportType.FeatureSyncHandoff,
        audience: ReportAudience.WorkflowOnly,
        required: true,
      },
    ],
    additionalAllowedTools: ['get_report_schema', 'propose_future_revision'],

    addUserMessage: (payload) => turnUserMessageBlock(payload.userMessage),

    submissionTools: [...analyzeSubmissionTools],

    async prepare(
      run: AgenticSession,
      payload: LocalFeatureSyncAnalyzePromptPayload,
      deps: PromptTypeHandlerDeps,
      ctx?: PromptTypeHandlerContext,
    ) {
      if (!run.entity || run.entity.entityType !== 'TASK') {
        deps.logger.error('feature_sync_analyze.prepare.missing_task_run_entity', {
          runId: run.agentic_session_id,
          runEntity: run.entity,
        });
        throw new Error('feature_sync_analyze handler requires a persisted TASK Run entity.');
      }
      if (payload.taskId !== run.entity.entityId) {
        deps.logger.error('feature_sync_analyze.prepare.task_identity_conflict', {
          runId: run.agentic_session_id,
          runEntity: run.entity,
          payloadTaskId: payload.taskId,
        });
        throw new Error(
          'feature_sync_analyze payload task identity conflicts with the persisted Run entity.',
        );
      }
      const taskId = run.entity.entityId;
      const userMessage = payload.userMessage?.trim() ?? '';
      const turnKind = userMessage.length > 0 ? 'follow_up' : 'initial';
      const launchPlanId = run.contextMetadata.launchPlanId?.trim();
      const launchStepId = run.contextMetadata.launchStepId?.trim();
      const launchStageId = run.contextMetadata.launchStageId?.trim();
      const loaded = ctx?.loadedEntityContext;
      const featureSeed =
        loaded?.kind === 'entity' && 'type' in loaded.entity && loaded.entity.type === 'FEATURE';
      const hasLaunchPlan =
        !featureSeed &&
        typeof launchPlanId === 'string' &&
        launchPlanId.length > 0 &&
        typeof launchStepId === 'string' &&
        launchStepId.length > 0 &&
        typeof launchStageId === 'string' &&
        launchStageId.length > 0;
      const turnPath: 'planned' | 'free' = hasLaunchPlan ? 'planned' : 'free';
      // A Project Assistant pass runs ahead of this phase when the run is
      // eligible; its memo is auto-prepended into this prompt by
      // `resolvePrompt` (provider_session flow). When present, the prompt adds
      // a research-lens section so the agent reads the flagged entities rather
      // than re-discovering the graph. The mandatory ancestor walk is unchanged.
      const hasResearch = (run.memos ?? []).some(
        (memo) => memo.source === LocalPromptType.ProjectAssistant,
      );
      // Observability for the conversational flagged-path flow: each analyze
      // turn is either the initial walk (no user message) or a follow-up
      // triggered by the user's per-discrepancy reply. Logging at info keeps
      // both legs of the conversation visible in production traces.
      deps.logger.info('feature_sync_analyze.prepare.turn_starting', {
        runId: run.agentic_session_id,
        taskId,
        turnKind,
        userMessageLength: userMessage.length,
        launchPlanId: hasLaunchPlan ? launchPlanId : null,
        launchStepId: hasLaunchPlan ? launchStepId : null,
        launchStageId: hasLaunchPlan ? launchStageId : null,
        turnPath,
        hasResearch,
        featureSeed,
      });
      const basePayload: LocalFeatureSyncAnalyzePromptPayload = hasLaunchPlan
        ? { ...payload, taskId, launchPlanId, launchStepId, launchStageId }
        : featureSeed
          ? { taskId, ...(payload.userMessage ? { userMessage: payload.userMessage } : {}) }
          : { ...payload, taskId };
      const enriched: EnrichedFeatureSyncAnalyzePromptPayload = {
        ...basePayload,
        _hasResearch: hasResearch,
        _featureSeed: featureSeed,
      };
      return { payload: enriched };
    },

    buildPrompt(
      payload: LocalFeatureSyncAnalyzePromptPayload,
      ctx?: PromptTypeHandlerContext,
    ): string {
      const enriched = payload as EnrichedFeatureSyncAnalyzePromptPayload;
      return buildAnalyzePrompt({
        taskId: payload.taskId,
        launchPlanId: payload.launchPlanId ?? null,
        launchStepId: payload.launchStepId ?? null,
        launchStageId: payload.launchStageId ?? null,
        hasResearch: enriched._hasResearch ?? false,
        featureSeed: enriched._featureSeed ?? false,
        implementationReadinessSourceSnapshot: ctx?.implementationReadinessSourceSnapshot ?? null,
      });
    },

    buildStartingMessage(payload): string | null {
      return (payload as EnrichedFeatureSyncAnalyzePromptPayload)._featureSeed
        ? 'Verifying the affected feature against the completed changes...'
        : 'Double-checking that your task is ready before we plan...';
    },
  };
