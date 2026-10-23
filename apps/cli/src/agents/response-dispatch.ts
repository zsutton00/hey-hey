/**
 * Central responseType dispatcher.
 *
 * Runs before any prompt-type handler in assistant_complete. Scans the
 * assistant's final summary for a `responseType` marker matching one of the
 * registered tokens; on a match, parses the JSON with the registered Zod
 * schema and produces an UpdateMessageDto plus any declared side effects.
 *
 * This is the single point that knows how to turn a structured agent
 * response into a platform message, regardless of which prompt type
 * produced it.
 */

import { renderStartupPlanSummary } from '@hey-hey/ui-common/agents';
import { jsonrepair } from 'jsonrepair';
import { randomUUID } from 'node:crypto';
import {
  ExtendedUIFieldType,
  MessageStatus,
  SecondaryActionConfigPresentationEnum,
  SecondaryActionConfigTypeEnum,
  SecondaryActionHandler,
  SystemMessageDataActionHintEnum,
  SystemMessageDataTypeEnum,
  type SecondaryActionConfig,
  type UpdateMessageDto,
} from '../shared/api/index';
import {
  SecondaryActionPayloadHandlerTypeEnum,
  type ImplementationReadinessDismissActionPayload,
  type ImplementationReadinessPayload,
  type ImplementationReadinessReplyActionPayload,
} from '../shared/api/generated/api';
import { LocalPromptType } from '../shared/agent-bridge-contract/generated';
import type {
  LocalAgentSearchResultsResponse,
  LocalChildTaskDescriptionUpdateResponse,
  LocalDailySessionResponse,
  LocalFinalAssessmentResponse,
  LocalGoalPmRoutingResponse,
  LocalNeighborhoodTaskUpdatesResponse,
  LocalReportUpdateResponse,
  LocalRollupProposalResponse,
  LocalSetSplittingResponse,
  LocalStartupSessionPlanResponse,
  LocalVerificationPlanResponse,
} from '../shared/agent-bridge-contract/index';
import type { ServerLogger } from '../server/logger';
import {
  extractStructuredJsonPayload,
  parseAgentSearchResultsResponseFromText,
  parseChildTaskDescriptionUpdateResponseFromText,
  parseDailySessionResponseFromText,
  parseFinalAssessmentResponseFromText,
  parseGoalPmRoutingResponseFromText,
  parseImplementationReadinessResponseFromText,
  parseNeighborhoodTaskUpdatesResponseFromText,
  parsePlanShapingFeatureSyncAnalyzeResponseFromText,
  parseReportUpdateResponseFromText,
  parseRollupProposalResponseFromText,
  parseSetSplittingResponseFromText,
  parseStartupSessionPlanResponseFromText,
  parseVerificationPlanResponseFromText,
  stripStructuredJsonBlock,
} from './response-parser';
import type { ParseResult, PlanShapingFeatureSyncAnalyzeResponse } from './response-schemas';
import { toCodingPromptStartupPlanPayload } from './message-mapping';
import { mapGoalPmRouting } from './goal-pm/goal-pm-response-mapping';
import { parseTriageResponse } from './open-items-triage/schemas';
import { mapTriageResponse } from './open-items-triage/response-mapping';

export type ResponseDispatchSideEffect = {
  type: 'sync_rollup_proposal_report';
  rollupProposal: LocalRollupProposalResponse;
  taskId: string;
};

export interface DispatchContext {
  /** Task id projected from the persisted Run entity, if TASK-scoped. */
  taskId: string | null;
  /** Prompt handler that owns the assistant output currently being presented. */
  promptType: string | null;
  /**
   * Live workflow node resolved by the CLI for an out-of-band completion.
   * Readiness actions use this to route back to the authoritative Plan Mode
   * node instead of trying to infer it from the agent payload.
   */
  currentWorkflowNodeId?: string | null;
  /** Response variants the active handler is permitted to present. */
  expectedResponseTypes: readonly ResponseTypeToken[];
  /**
   * Whether the legacy startup-plan UI element remains enabled for this turn.
   * Only handlers that explicitly opt into `startup_plan_v1` may set this;
   * Coding Plan uses the report/action path and does not enter this registry
   * branch.
   */
  emitLegacyStartupPlanUiElement: boolean;
}

/** Response types whose out-of-band message actions need a live workflow node. */
export const requiresNodeId = (responseType: ResponseTypeToken | null): boolean =>
  responseType === 'implementation_readiness_v1';

/**
 * Enrich dispatch context with runtime-owned routing metadata without making
 * the response registry perform I/O. The caller supplies the node resolver so
 * this helper remains usable by different Run/orchestration boundaries.
 */
export const resolveResponseDispatchContext = async (
  summary: string,
  context: DispatchContext,
  resolveNodeId: () => Promise<string | null>,
): Promise<DispatchContext> => {
  const responseType = detectResponseType(summary);
  if (
    responseType === null ||
    !context.expectedResponseTypes.includes(responseType) ||
    !requiresNodeId(responseType)
  ) {
    return context;
  }

  return {
    ...context,
    currentWorkflowNodeId: await resolveNodeId(),
  };
};

/**
 * Terminal classification carried in a registry entry's `pendingCompletion`
 * return value. The runtime assistant-complete handler reads this off the
 * dispatch result and posts the companion EXTERNAL_AGENT completion SYSTEM
 * message for legacy structured-response consumers that explicitly opt in.
 *
 * `payload` is forwarded verbatim onto the `completesExternalAgentNode`
 * envelope when present (e.g. the discrepancies array for the DISCREPANCY
 * action on the feature-sync analyze flow).
 */
interface PendingExternalAgentCompletion {
  action: 'APPROVED' | 'REVISED' | 'NO_DISCREPANCY' | 'DISCREPANCY';
  payload?: Record<string, unknown>;
}

export type DispatchResult =
  | {
      matched: true;
      responseType: ResponseTypeToken;
      updateData: UpdateMessageDto;
      sideEffects: ResponseDispatchSideEffect[];
      pendingCompletion: PendingExternalAgentCompletion | null;
    }
  | { matched: false; incompatibleResponseType?: ResponseTypeToken };

const RESPONSE_TYPE_TOKENS = [
  'final_assessment_v2',
  'startup_plan_v1',
  'neighborhood_task_updates_v1',
  'verification_plan_v1',
  'child_task_description_update_v1',
  'set_splitting_v1',
  'rollup_proposal_v1',
  'daily_session_v1',
  'report_update_v1',
  'plan_shaping_feature_sync_analyze_v1',
  'agent_search_results_v1',
  'goal_pm_routing_v1',
  'open_items_triage_v1',
  'implementation_readiness_v1',
] as const;

export type ResponseTypeToken = (typeof RESPONSE_TYPE_TOKENS)[number];

interface RegistryEntry<T> {
  parse: (text: string) => ParseResult<T>;
  /**
   * Validates identities that must agree with the active Run context before
   * the parsed response can become a platform message.
   */
  validateContext?: (parsed: T, ctx: DispatchContext) => string | null;
  /**
   * Builds the platform message from the parsed body. `rawSummary` is the
   * agent's full final text — entries whose visible content is the agent's
   * prose (not a structured rendering) use it to post that prose with the
   * structured JSON block stripped out.
   */
  buildMessage: (parsed: T, rawSummary: string, ctx: DispatchContext) => UpdateMessageDto;
  sideEffects?: (parsed: T, ctx: DispatchContext) => ResponseDispatchSideEffect[];
  /**
   * When set, returns a `PendingExternalAgentCompletion` for this parse
   * result so assistant-complete.ts can post the companion EXTERNAL_AGENT
   * completion SYSTEM message after the dispatched body message is emitted.
   * Only legacy handlers that carry termination classification in-body
   * populate this. Coding Plan completion actions are posted by its owned
   * submission tools instead.
   */
  pendingCompletion?: (parsed: T, ctx: DispatchContext) => PendingExternalAgentCompletion | null;
}

const buildStructuredContent = (
  responseType: ResponseTypeToken,
  parsed: unknown,
): UpdateMessageDto => ({
  data: {
    content: JSON.stringify(parsed),
    processResponseType: responseType,
  },
});

const startupPlanEntry: RegistryEntry<LocalStartupSessionPlanResponse> = {
  parse: parseStartupSessionPlanResponseFromText,
  buildMessage: (plan, _rawSummary, context) => {
    if (!context.emitLegacyStartupPlanUiElement) {
      return {
        status: MessageStatus.Completed,
        data: {
          type: SystemMessageDataTypeEnum.Agent,
          title: 'Plan Generated',
          response: 'Your plan is ready.',
          detectedIntent: 'agent_response',
          intentConfidence: 1,
          processResponseType: 'startup_plan_v1',
        },
      };
    }

    return {
      status: MessageStatus.Open,
      data: {
        type: SystemMessageDataTypeEnum.Questions,
        title: 'Execution Update',
        response: renderStartupPlanSummary(plan),
        detectedIntent: 'agent_response',
        intentConfidence: 1,
        actionHint: SystemMessageDataActionHintEnum.TaskComplete,
        processResponseType: 'startup_plan_v1',
        uiElements: [
          {
            id: randomUUID(),
            type: ExtendedUIFieldType.CodingPromptStartupPlan,
            label: 'Startup Plan',
            submitText: 'Approve',
            payload: toCodingPromptStartupPlanPayload(plan),
          },
        ],
      },
    };
  },
  pendingCompletion: (plan, context) => {
    // Keep the legacy completion path explicitly paired to an opted-in
    // startup-plan handler even if this registry entry is reused directly.
    if (!context.expectedResponseTypes.includes('startup_plan_v1')) {
      return null;
    }
    const nextAction = (plan as { nextAction?: 'APPROVED' | 'REVISED' }).nextAction;
    if (nextAction === 'APPROVED' || nextAction === 'REVISED') {
      return { action: nextAction };
    }
    return null;
  },
};

const finalAssessmentEntry: RegistryEntry<LocalFinalAssessmentResponse> = {
  parse: parseFinalAssessmentResponseFromText,
  buildMessage: (assessment) => ({
    status: MessageStatus.Open,
    data: {
      type: SystemMessageDataTypeEnum.Questions,
      title: 'Final Assessment',
      response: 'Final Assessment',
      detectedIntent: 'agent_response',
      intentConfidence: 1,
      processResponseType: 'final_assessment_v2',
      uiElements: [
        {
          id: randomUUID(),
          type: ExtendedUIFieldType.CodingPromptFinalAssessment,
          label: 'Final Assessment',
          payload: assessment as unknown as Record<string, unknown>,
        },
      ],
    },
  }),
};

const dailySessionEntry: RegistryEntry<LocalDailySessionResponse> = {
  parse: parseDailySessionResponseFromText,
  buildMessage: (parsed) => ({
    data: {
      type: SystemMessageDataTypeEnum.Agent,
      response: parsed.response,
      title: 'Daily Session',
      detectedIntent: 'daily_session',
      intentConfidence: 1,
      ragEnabled: false,
    },
  }),
};

const reportUpdateEntry: RegistryEntry<LocalReportUpdateResponse> = {
  parse: parseReportUpdateResponseFromText,
  buildMessage: (parsed) => ({
    data: {
      type: SystemMessageDataTypeEnum.Agent,
      response: parsed.summary,
      title: parsed.title ?? 'Report Update',
      detectedIntent: 'report_update',
      intentConfidence: 1,
      ragEnabled: false,
    },
  }),
};

const rollupProposalEntry: RegistryEntry<LocalRollupProposalResponse> = {
  parse: parseRollupProposalResponseFromText,
  buildMessage: (proposal) => buildStructuredContent('rollup_proposal_v1', proposal),
  sideEffects: (proposal, ctx) =>
    ctx.taskId
      ? [
          {
            type: 'sync_rollup_proposal_report',
            rollupProposal: proposal,
            taskId: ctx.taskId,
          },
        ]
      : [],
};

const neighborhoodTaskUpdatesEntry: RegistryEntry<LocalNeighborhoodTaskUpdatesResponse> = {
  parse: parseNeighborhoodTaskUpdatesResponseFromText,
  buildMessage: (updates) => buildStructuredContent('neighborhood_task_updates_v1', updates),
};

const verificationPlanEntry: RegistryEntry<LocalVerificationPlanResponse> = {
  parse: parseVerificationPlanResponseFromText,
  buildMessage: (plan) => buildStructuredContent('verification_plan_v1', plan),
};

const childTaskDescriptionUpdateEntry: RegistryEntry<LocalChildTaskDescriptionUpdateResponse> = {
  parse: parseChildTaskDescriptionUpdateResponseFromText,
  buildMessage: (updates) => buildStructuredContent('child_task_description_update_v1', updates),
};

const setSplittingEntry: RegistryEntry<LocalSetSplittingResponse> = {
  parse: parseSetSplittingResponseFromText,
  buildMessage: (split) => buildStructuredContent('set_splitting_v1', split),
};

const planShapingFeatureSyncAnalyzeEntry: RegistryEntry<PlanShapingFeatureSyncAnalyzeResponse> = {
  parse: parsePlanShapingFeatureSyncAnalyzeResponseFromText,
  // The visible message is the agent's findings prose and flagged-item table;
  // the fenced JSON block only drives the completion below and must not reach
  // the user, so strip it from the posted content.
  buildMessage: (_parsed, rawSummary) => ({
    data: {
      type: SystemMessageDataTypeEnum.Agent,
      response: stripStructuredJsonBlock(rawSummary),
      title: 'Feature Sync',
      detectedIntent: 'agent_response',
      intentConfidence: 1,
      ragEnabled: false,
    },
  }),
  pendingCompletion: (parsed) => ({
    action: parsed.action,
    ...(parsed.action === 'DISCREPANCY' && parsed.discrepancies
      ? { payload: { discrepancies: parsed.discrepancies } }
      : {}),
  }),
};

const agentSearchResultsEntry: RegistryEntry<LocalAgentSearchResultsResponse> = {
  parse: parseAgentSearchResultsResponseFromText,
  buildMessage: (parsed) => ({
    status: MessageStatus.Open,
    data: {
      type: SystemMessageDataTypeEnum.Questions,
      title: 'Search Results',
      response: parsed.response,
      detectedIntent: 'agent_response',
      intentConfidence: 1,
      processResponseType: 'agent_search_results_v1',
      uiElements: [
        {
          id: randomUUID(),
          type: ExtendedUIFieldType.AgentSearchResults,
          label: 'Search Results',
          payload: parsed.results as unknown as Record<string, unknown>,
        },
      ],
    },
  }),
};

const goalPmRoutingEntry: RegistryEntry<LocalGoalPmRoutingResponse> = {
  parse: parseGoalPmRoutingResponseFromText,
  validateContext: (parsed, context) => {
    if (context.taskId === null) {
      return 'Goal PM response has no active TASK scope.';
    }
    return parsed.goalId === context.taskId
      ? null
      : 'Goal PM response goalId does not match the active TASK scope.';
  },
  buildMessage: (parsed) => ({
    status: MessageStatus.Open,
    data: {
      type: SystemMessageDataTypeEnum.Questions,
      title: 'Goal PM',
      response: 'Choose how to continue.',
      detectedIntent: 'agent_response',
      intentConfidence: 1,
      processResponseType: 'goal_pm_routing_v1',
      uiElements: [
        {
          id: randomUUID(),
          type: ExtendedUIFieldType.GoalPmAction,
          label: 'Goal PM action',
          promptType: LocalPromptType.GoalPm,
          payload: mapGoalPmRouting(parsed),
        },
      ],
    },
  }),
};

const implementationReadinessEntry: RegistryEntry<ImplementationReadinessPayload> = {
  parse: parseImplementationReadinessResponseFromText,
  buildMessage: (parsed, rawSummary, context) => {
    const response = stripStructuredJsonBlock(rawSummary).trim();
    const disposition = parsed.disposition;
    if (disposition.state !== 'REVIEW_REQUIRED' || !disposition.finding) {
      return {
        data: {
          type: SystemMessageDataTypeEnum.Agent,
          response: response || 'Implementation readiness is clear.',
          detectedIntent: 'agent_response',
          intentConfidence: 1,
          processResponseType: 'implementation_readiness_v1',
        },
      };
    }

    const fieldId = randomUUID();
    const payload: ImplementationReadinessPayload = {
      responseType: 'implementation_readiness_v1',
      disposition,
    };
    const { runId, sourceRevision } = disposition.sourceSnapshot;
    const replyPayload: ImplementationReadinessReplyActionPayload = {
      handlerType: SecondaryActionPayloadHandlerTypeEnum.ImplementationReadinessReply,
      runId,
      sourceRevision,
    };
    const dismissPayload: ImplementationReadinessDismissActionPayload = {
      handlerType: SecondaryActionPayloadHandlerTypeEnum.ImplementationReadinessDismiss,
      runId,
      sourceRevision,
      confirmed: true,
    };
    const secondaryActions: SecondaryActionConfig[] = [
      {
        id: randomUUID(),
        type: SecondaryActionConfigTypeEnum.FieldAction,
        presentation: SecondaryActionConfigPresentationEnum.Button,
        label: 'Clarify',
        handler: SecondaryActionHandler.ImplementationReadinessReply,
        fieldId,
        disabled: false,
        payload: replyPayload,
      },
      {
        id: randomUUID(),
        type: SecondaryActionConfigTypeEnum.FieldAction,
        presentation: SecondaryActionConfigPresentationEnum.Button,
        label: 'Dismiss',
        handler: SecondaryActionHandler.ImplementationReadinessDismiss,
        fieldId,
        disabled: false,
        payload: dismissPayload,
      },
    ];

    return {
      status: MessageStatus.Open,
      data: {
        type: SystemMessageDataTypeEnum.Questions,
        title: 'Implementation readiness review',
        response:
          response ||
          'Implementation needs one consequential decision before it can continue. Review the finding below.',
        detectedIntent: 'implementation_readiness_review',
        intentConfidence: 1,
        processResponseType: 'implementation_readiness_v1',
        ...(context.currentWorkflowNodeId ? { nodeId: context.currentWorkflowNodeId } : {}),
        uiElements: [
          {
            id: fieldId,
            type: ExtendedUIFieldType.ImplementationReadiness,
            label: 'Implementation readiness review',
            required: false,
            influences: [],
            payload,
          },
        ],
        secondaryActions,
      },
    };
  },
};

const REGISTRY: { [K in ResponseTypeToken]: RegistryEntry<unknown> } = {
  startup_plan_v1: startupPlanEntry as RegistryEntry<unknown>,
  final_assessment_v2: finalAssessmentEntry as RegistryEntry<unknown>,
  daily_session_v1: dailySessionEntry as RegistryEntry<unknown>,
  report_update_v1: reportUpdateEntry as RegistryEntry<unknown>,
  rollup_proposal_v1: rollupProposalEntry as RegistryEntry<unknown>,
  neighborhood_task_updates_v1: neighborhoodTaskUpdatesEntry as RegistryEntry<unknown>,
  verification_plan_v1: verificationPlanEntry as RegistryEntry<unknown>,
  child_task_description_update_v1: childTaskDescriptionUpdateEntry as RegistryEntry<unknown>,
  set_splitting_v1: setSplittingEntry as RegistryEntry<unknown>,
  plan_shaping_feature_sync_analyze_v1:
    planShapingFeatureSyncAnalyzeEntry as RegistryEntry<unknown>,
  agent_search_results_v1: agentSearchResultsEntry as RegistryEntry<unknown>,
  goal_pm_routing_v1: goalPmRoutingEntry as RegistryEntry<unknown>,
  open_items_triage_v1: {
    parse: parseTriageResponse,
    buildMessage: (parsed) => ({
      status: MessageStatus.Open,
      data: {
        type: SystemMessageDataTypeEnum.Questions,
        title: 'Open Items triage',
        response: parsed.summary,
        detectedIntent: 'agent_response',
        intentConfidence: 1,
        processResponseType: 'open_items_triage_v1',
        uiElements: [
          {
            id: randomUUID(),
            type: ExtendedUIFieldType.OpenItemsTriage,
            label: 'Open Items triage',
            promptType: LocalPromptType.OpenItemsTriage,
            payload: mapTriageResponse(parsed),
          },
        ],
      },
    }),
  } satisfies RegistryEntry<
    import('../shared/agent-bridge-contract/generated').LocalOpenItemsTriageResponse
  > as RegistryEntry<unknown>,
  implementation_readiness_v1: implementationReadinessEntry as RegistryEntry<unknown>,
};

const REGISTERED_TOKENS: ReadonlySet<string> = new Set(RESPONSE_TYPE_TOKENS);

/**
 * Read the `responseType` field off the JSON payload embedded in the
 * summary. Prose that merely mentions a token (e.g. a description that
 * says "the final_assessment_v2 schema") must not trigger dispatch —
 * only the actual field wins.
 */
const detectResponseType = (summary: string): ResponseTypeToken | null => {
  const payload = extractStructuredJsonPayload(summary);
  if (!payload) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    try {
      parsed = JSON.parse(jsonrepair(payload));
    } catch {
      return null;
    }
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const value = (parsed as Record<string, unknown>)['responseType'];
  if (typeof value !== 'string') return null;
  return REGISTERED_TOKENS.has(value) ? (value as ResponseTypeToken) : null;
};

export const dispatchResponseType = (
  summary: string,
  ctx: DispatchContext,
  logger: ServerLogger,
): DispatchResult => {
  const token = detectResponseType(summary);
  if (!token) {
    logger.info('response_dispatch.no_token_detected', {
      summaryLength: summary.length,
      hasStructuredPayload: extractStructuredJsonPayload(summary) !== null,
      summaryPreview: summary.slice(0, 300),
    });
    return { matched: false };
  }

  if (!ctx.expectedResponseTypes.includes(token)) {
    logger.info('response_dispatch.incompatible_pair', {
      promptType: ctx.promptType,
      responseType: token,
    });
    return { matched: false, incompatibleResponseType: token };
  }

  const entry = REGISTRY[token];
  const parsed = entry.parse(summary);
  if (!parsed.ok) {
    logger.warn('response_dispatch.parse_failed', {
      responseType: token,
      error: parsed.error,
      summaryPreview: summary.slice(0, 500),
    });
    return { matched: false };
  }

  const contextValidationError = entry.validateContext?.(parsed.value, ctx);
  if (contextValidationError) {
    logger.warn('response_dispatch.context_validation_failed', {
      promptType: ctx.promptType,
      responseType: token,
      taskId: ctx.taskId,
      error: contextValidationError,
    });
    return { matched: false };
  }

  logger.info('response_dispatch.matched', {
    responseType: token,
    summaryLength: summary.length,
  });

  return {
    matched: true,
    responseType: token,
    updateData: entry.buildMessage(parsed.value, summary, ctx),
    sideEffects: entry.sideEffects?.(parsed.value, ctx) ?? [],
    pendingCompletion: entry.pendingCompletion?.(parsed.value, ctx) ?? null,
  };
};
