import {
  LocalPromptType,
  type LocalPromptDesignDocInput,
  type LocalStartupSessionPromptPayload,
} from '../../shared/agent-bridge-contract/generated/api';
import type {
  LocalWorktreeStateByService,
  ResolvedServiceBinding,
} from '../../shared/agent-bridge-contract/contract';
import { ReportAudience, ReportType } from '../../shared/api/index';
import {
  defaultAddUserMessage,
  type PromptTypeHandlerContext,
  type RecentUserReply,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { buildCodingPlanPrompt } from '../prompts/coding-plan';
import { buildStartingMessage as buildStartingMessageForPromptType } from '../prompts/starting-message';
import { fetchPlanDesignDocReference } from './plan-design-doc-reference';
import { codingPlanSubmissionTools } from './submission-tools';

/**
 * Restricted MCP tool allowlist for the coding-plan subagent. The planner may
 * ground its plan in project state (search + context tools), read prior
 * report bodies, maintain its implementation-hint memory, and persist its
 * PLAN report — but must never mutate the graph.
 */
export const CODING_PLAN_SUBAGENT_MCP_ALLOWED_TOOLS: readonly string[] = [
  // Context / read
  'get_context',
  'get_full_entity',
  'get_diagram',
  'get_edges',
  'get_tool_guidance',
  'get_work_item_type_guidance_batch',
  'get_future_revision',
  'get_agent_sessions',
  'get_report_body',
  'get_report_schema',
  'list_services',
  // Search
  'unified_search',
  'task_search',
  'plan_search',
  'search_features',
  'search_design_docs',
  'search_implementation_hints',
  // Memory maintenance
  'create_implementation_hint',
  'edit_implementation_hint',
  'delete_implementation_hint',
];

/**
 * Built-in Claude Code tools the planner uses to read the codebase.
 * `Write`/`Edit`/`Bash` are deliberately omitted — planning must not mutate
 * the working tree or run shell commands.
 */
export const CODING_PLAN_SUBAGENT_BUILTIN_ALLOWED_TOOLS: readonly string[] = [
  'Read',
  'Glob',
  'Grep',
];

/**
 * The startup-session payload enriched by `codingPlanHandler.prepare` with the
 * trigger's `recentUserReplies`. The subagent reads the replies off the
 * payload because the runtime SubAgent's `buildPrompt` call carries no
 * per-Turn context.
 */
export interface EnrichedCodingPlanPromptPayload extends LocalStartupSessionPromptPayload {
  _recentUserReplies?: ReadonlyArray<RecentUserReply>;
  _services?: ResolvedServiceBinding[];
  _launchServiceId?: string;
  _worktreeState?: LocalWorktreeStateByService;
  _planDesignDocReference?: LocalPromptDesignDocInput;
  /**
   * Content of the `project_assistant` memo when one is present on the run.
   * Carried on the payload because coding-plan is a subagent: `resolvePrompt`
   * skips the memo-block prepend for subagent-owned flows (the
   * `!isSubagentOwned` gate), so unlike provider_session handlers the memo is
   * NOT already in the prompt and must be threaded through here and rendered by
   * `buildCodingPlanPrompt`.
   */
  _researchMemo?: string;
}

type CodingPlanHandler = UserLaunchablePromptTypeHandler<LocalStartupSessionPromptPayload>;

export const codingPlanHandler: CodingPlanHandler = {
  id: 'startup_session',
  promptType: 'startup_session',
  service: 'required',
  launchEntity: 'required',
  implementationReadiness: 'gated',
  projectAssistant: {
    allowEdgeUpdates: false,
    notifyDiscrepancies: false,
    workItemProposalMode: 'all',
  },
  runnerKind: 'subagent',
  providerSessionCountsForContext: true,
  // A Coding Plan follow-up is a fresh planning round, even though the
  // provider helper session remains isolated. Re-run prepare so selected
  // Services, the launch anchor, worktree paths, and current feedback reach
  // the new subagent prompt instead of forwarding only the raw user message.
  rebuildPromptOnUserMessage: true,
  reports: [
    { reportType: ReportType.Plan, audience: ReportAudience.ProjectVisible, required: true },
  ],
  submissionTools: [...codingPlanSubmissionTools],
  subagentConfig: {
    mcpAllowedTools: CODING_PLAN_SUBAGENT_MCP_ALLOWED_TOOLS,
    builtinAllowedTools: CODING_PLAN_SUBAGENT_BUILTIN_ALLOWED_TOOLS,
    adapterId: 'claude-sdk-coding-plan-subagent',
  },

  async prepare(run, payload, deps, ctx?: PromptTypeHandlerContext) {
    // The turn's user message — a composer reply, or the comments carried by
    // Continue Refining — is the reply the planner classifies. Without it the
    // prompt takes the initial-planning path and the feedback is ignored.
    const turnUserMessage = payload.userMessage?.trim();
    const recentUserReplies: ReadonlyArray<RecentUserReply> =
      ctx?.recentUserReplies && ctx.recentUserReplies.length > 0
        ? ctx.recentUserReplies
        : turnUserMessage
          ? [{ messageId: ctx?.turnId ?? '', text: turnUserMessage, createdAt: '' }]
          : [];

    const rawLaunchPlanId = run.contextMetadata.launchPlanId;
    const rawLaunchStepId = run.contextMetadata.launchStepId;
    const rawLaunchStageId = run.contextMetadata.launchStageId;
    const launchPlanId = typeof rawLaunchPlanId === 'string' ? rawLaunchPlanId.trim() : '';
    const launchStepId = typeof rawLaunchStepId === 'string' ? rawLaunchStepId.trim() : '';
    const launchStageId = typeof rawLaunchStageId === 'string' ? rawLaunchStageId.trim() : '';
    const hasLaunchPlan =
      launchPlanId.length > 0 && launchStepId.length > 0 && launchStageId.length > 0;
    const turnPath: 'planned' | 'free' = hasLaunchPlan ? 'planned' : 'free';
    const organizationId =
      typeof run.contextMetadata.organizationId === 'string'
        ? run.contextMetadata.organizationId.trim()
        : '';
    const projectId =
      typeof run.contextMetadata.projectId === 'string' ? run.contextMetadata.projectId.trim() : '';

    // A Project Assistant pass runs ahead of this phase when the run is
    // eligible. Because coding-plan is a subagent, `resolvePrompt` does NOT
    // auto-prepend the run's memos (the `!isSubagentOwned` gate), so we
    // carry the memo content on the payload and render it in the prompt builder.
    const researchMemo = (run.memos ?? []).find(
      (memo) => memo.source === LocalPromptType.ProjectAssistant,
    )?.content;

    deps.logger.debug('coding_plan.prepare.entry', {
      runId: run.agentic_session_id,
      recentUserReplyCount: recentUserReplies.length,
      hasResearchMemo: Boolean(researchMemo),
      turnPath,
      projectId,
      conversationId: run.conversationId,
      launchServiceId: run.launchServiceId ?? null,
      services: run.services ?? [],
      worktreeState: run.worktreeState ?? null,
      processCwd: process.cwd(),
    });

    let planDesignDocReference: LocalPromptDesignDocInput | null = null;
    if (hasLaunchPlan && organizationId.length > 0 && projectId.length > 0) {
      planDesignDocReference = await fetchPlanDesignDocReference({
        organizationId,
        projectId,
        planId: launchPlanId,
        deps,
      });
      deps.logger.debug('coding_plan.prepare.plan_design_doc_reference_resolved', {
        runId: run.agentic_session_id,
        launchPlanId,
        hasPlanDesignDocReference: Boolean(planDesignDocReference),
      });
    } else if (hasLaunchPlan) {
      deps.logger.warn('coding_plan.prepare.plan_design_doc_reference_missing_context', {
        runId: run.agentic_session_id,
        launchPlanId,
        hasOrganizationId: organizationId.length > 0,
        hasProjectId: projectId.length > 0,
      });
    }

    if (!run.entity) {
      deps.logger.error('coding_plan.prepare.missing_run_entity', {
        runId: run.agentic_session_id,
      });
      throw new Error('coding_plan handler requires a persisted Run entity.');
    }
    const enrich = (): EnrichedCodingPlanPromptPayload => ({
      ...payload,
      ...(hasLaunchPlan ? { launchPlanId, launchStepId, launchStageId } : {}),
      _recentUserReplies: recentUserReplies,
      ...(run.services && run.services.length > 0 ? { _services: run.services } : {}),
      ...(run.launchServiceId ? { _launchServiceId: run.launchServiceId } : {}),
      ...(run.worktreeState ? { _worktreeState: run.worktreeState } : {}),
      ...(planDesignDocReference ? { _planDesignDocReference: planDesignDocReference } : {}),
      ...(researchMemo ? { _researchMemo: researchMemo } : {}),
    });

    deps.logger.debug('coding_plan.prepare.run_entity_verified', {
      runId: run.agentic_session_id,
      entityId: run.entity.entityId,
      entityType: run.entity.entityType,
    });
    const enriched = enrich();
    deps.logger.debug('coding_plan.prepare.prompt_scope', {
      runId: run.agentic_session_id,
      launchServiceId: enriched._launchServiceId ?? null,
      services: enriched._services ?? [],
      worktreeState: enriched._worktreeState ?? null,
      recentUserReplyCount: enriched._recentUserReplies?.length ?? 0,
    });
    return { payload: enriched };
  },

  buildPrompt(payload: LocalStartupSessionPromptPayload, ctx): string {
    const enriched = payload as EnrichedCodingPlanPromptPayload;
    const replies = enriched._recentUserReplies ?? ctx?.recentUserReplies ?? [];
    return buildCodingPlanPrompt(payload, replies, {
      ...(enriched._services ? { services: enriched._services } : {}),
      ...(enriched._launchServiceId ? { launchServiceId: enriched._launchServiceId } : {}),
      ...(enriched._worktreeState ? { worktreeState: enriched._worktreeState } : {}),
      ...(ctx?.entity?.entityId ? { focalEntityId: ctx.entity.entityId } : {}),
      ...(enriched._researchMemo ? { researchMemo: enriched._researchMemo } : {}),
      ...(enriched._planDesignDocReference
        ? { planDesignDocReference: enriched._planDesignDocReference }
        : {}),
    });
  },

  addUserMessage: defaultAddUserMessage,

  buildStartingMessage(
    payload: LocalStartupSessionPromptPayload,
    ctx?: PromptTypeHandlerContext,
  ): string | null {
    return buildStartingMessageForPromptType('startup_session', payload, ctx);
  },
};
