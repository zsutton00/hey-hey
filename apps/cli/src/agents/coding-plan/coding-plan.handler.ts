import type { AgenticSession } from '../../session/types';
import {
  SessionRole,
  LocalPromptType,
  type LocalPromptDesignDocInput,
  type LocalStartupSessionPromptPayload,
} from '@hey-hey/contracts/agent-bridge';
import type {
  LocalWorktreeStateByService,
  ResolvedServiceBinding,
} from '../../shared/agent-bridge-contract/contract';
import {
  type PromptTypeHandlerContext,
  type RecentUserReply,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { buildCodingPlanPrompt } from '../prompts/coding-plan';
import { buildStartingMessage as buildStartingMessageForPromptType } from '../prompts/starting-message';
import { fetchPlanDesignDocReference } from './plan-design-doc-reference';
import { codingPlanSubmissionTools } from './submission-tools';
import {
  fetchCodingPlanConversation,
  latestCodingPlanVersion,
  renderCodingPlanConversation,
} from './conversation-context';

/**
 * The startup-session payload enriched by `codingPlanHandler.prepare` with the
 * trigger's `recentUserReplies`, the saved planning conversation and the
 * selected-Service scope. `buildPrompt` reads them back off the payload; they
 * are only rendered when the Run mints a fresh provider session.
 */
export interface EnrichedCodingPlanPromptPayload extends LocalStartupSessionPromptPayload {
  _recentUserReplies?: ReadonlyArray<RecentUserReply>;
  _services?: ResolvedServiceBinding[];
  _launchServiceId?: string;
  _worktreeState?: LocalWorktreeStateByService;
  _mainFolderBranches?: AgenticSession['mainFolderBranches'];
  _planDesignDocReference?: LocalPromptDesignDocInput;
  /**
   * Whether a `project_assistant` memo is present on the run. The memo content
   * itself is already in the prompt: `resolvePrompt` auto-prepends the run's
   * memos as a `## Context from prior phases` block when a provider session is
   * minted, so the prompt builder only needs the flag to orient the planner.
   */
  _hasResearch?: boolean;
  _planningConversation?: string;
  /** True once the planning conversation holds a saved plan version. */
  _hasSavedPlanVersion?: boolean;
}

type CodingPlanHandler = UserLaunchablePromptTypeHandler<LocalStartupSessionPromptPayload>;

export const codingPlanHandler: CodingPlanHandler = {
  id: 'startup_session',
  sessionRole: SessionRole.Planning,
  promptType: 'startup_session',
  service: 'required',
  launchEntity: 'required',
  implementationReadiness: 'gated',
  projectAssistant: {
    allowEdgeUpdates: false,
    notifyDiscrepancies: false,
    workItemProposalMode: 'all',
  },
  // One planning conversation is one provider session: every refinement round
  // resumes it and receives only the new reply. A session is minted only at a
  // handoff between agents (Feature Sync in, Implement out), and then `prepare`
  // and `buildPrompt` rebuild the full planning conversation from the saved
  // messages so a fresh session starts from the same history.
  runnerKind: 'provider_session',
  // The planner reads the codebase and project graph; it never mutates either.
  // Codex enforces read-only through its sandbox. Claude would otherwise add
  // Bash to its read-only toolkit, so the built-in surface is declared
  // explicitly. `ToolSearch` loads deferred tool schemas and grants no
  // permission to call them.
  readOnlyFilesystem: true,
  builtinTools: ['Read', 'Glob', 'Grep', 'ToolSearch'],
  // The planning use case strips every proposal, edge and authoring-guidance
  // tool from the coding base and keeps the hint tools. These two read tools
  // were already part of the planner's surface.
  mcpToolUseCase: 'planning',
  additionalAllowedTools: ['get_agent_sessions', 'list_services'],
  providerSessionCountsForContext: true,
  reports: [],
  excludedBaseSubmissionTools: ['create_report', 'raise_uncertainty'],
  submissionTools: [...codingPlanSubmissionTools],

  async prepare(run, payload, deps, ctx?: PromptTypeHandlerContext) {
    // The turn's user message — a composer reply, or the comments carried by
    // a specific planning issue — is the feedback the planner discusses. Without it the
    // prompt can lose the current feedback.
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
    // eligible; `resolvePrompt` auto-prepends its memo when a provider session
    // is minted, so only the presence flag is carried on the payload.
    const hasResearch = (run.memos ?? []).some(
      (memo) => memo.source === LocalPromptType.ProjectAssistant,
    );

    deps.logger.debug('coding_plan.prepare.entry', {
      runId: run.agentic_session_id,
      recentUserReplyCount: recentUserReplies.length,
      hasResearch,
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
    const conversation = await fetchCodingPlanConversation(run, deps);
    const persistedReplies = conversation.filter((message) => message.type === 'USER');
    const lastPersistedReply = persistedReplies.at(-1);
    const persistedCurrentText =
      lastPersistedReply?.data.agentInput?.userMessage ??
      lastPersistedReply?.data.comment ??
      lastPersistedReply?.data.response;
    const supplementalReplies = recentUserReplies.filter(
      (reply) =>
        !persistedReplies.some((message) => message.id === reply.messageId) &&
        !(
          turnUserMessage &&
          persistedCurrentText?.trim() === turnUserMessage &&
          reply.text.trim() === turnUserMessage
        ),
    );
    const enrich = (): EnrichedCodingPlanPromptPayload => ({
      _planningConversation: renderCodingPlanConversation(conversation),
      _hasSavedPlanVersion: latestCodingPlanVersion(conversation) !== null,
      ...payload,
      ...(hasLaunchPlan ? { launchPlanId, launchStepId, launchStageId } : {}),
      _recentUserReplies: supplementalReplies,
      ...(run.services && run.services.length > 0 ? { _services: run.services } : {}),
      ...(run.launchServiceId ? { _launchServiceId: run.launchServiceId } : {}),
      ...(run.worktreeState ? { _worktreeState: run.worktreeState } : {}),
      ...(run.mainFolderBranches ? { _mainFolderBranches: run.mainFolderBranches } : {}),
      ...(planDesignDocReference ? { _planDesignDocReference: planDesignDocReference } : {}),
      ...(hasResearch ? { _hasResearch: true } : {}),
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
      provider: ctx?.provider,
      planningConversation: enriched._planningConversation,
      ...(enriched._services ? { services: enriched._services } : {}),
      ...(enriched._launchServiceId ? { launchServiceId: enriched._launchServiceId } : {}),
      ...(enriched._worktreeState ? { worktreeState: enriched._worktreeState } : {}),
      ...(enriched._mainFolderBranches ? { mainFolderBranches: enriched._mainFolderBranches } : {}),
      ...(ctx?.entity?.entityId ? { focalEntityId: ctx.entity.entityId } : {}),
      ...(enriched._hasResearch ? { hasResearch: true } : {}),
      ...(enriched._planDesignDocReference
        ? { planDesignDocReference: enriched._planDesignDocReference }
        : {}),
    });
  },

  // The rebuilt prompt already carries persisted replies and any unsaved current feedback.
  addUserMessage: () => null,

  buildStartingMessage(
    payload: LocalStartupSessionPromptPayload,
    ctx?: PromptTypeHandlerContext,
  ): string | null {
    return buildStartingMessageForPromptType('startup_session', payload, ctx);
  },
};
