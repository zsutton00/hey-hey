import { z } from 'zod';
import {
  EntityType,
  ProposalAction,
  ProposalType,
  TargetEntityType,
} from '../shared/api/generated';
import type { ImplementationReadinessPayload } from '../shared/api/generated/api';
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
import {
  LocalAgentSearchEntityType,
  LocalPromptWorkStatus,
  LocalResponseDiscrepancySeverity,
  LocalResponseFinalAssessmentSourceType,
  LocalResponseHierarchyWalkAction,
  LocalResponseHierarchyWalkSection,
  LocalResponseSourceType,
  LocalResponseStartupMissedStepResolutionType,
  LocalResponseVerificationTier,
} from '../shared/agent-bridge-contract/index';
import { REPORT_CATALOG } from './daily-session/report-catalog';
import { implementationReadinessDispositionSchema } from './implementation-readiness/session-context';

const startupSourceTypeSchema = z.nativeEnum(LocalResponseSourceType);

const implementationReadinessResponseSchema = z
  .object({
    responseType: z.literal('implementation_readiness_v1'),
    disposition: implementationReadinessDispositionSchema.refine(
      (disposition) => disposition.state !== 'DISMISSED',
      'DISMISSED is reserved for the confirmed user-facing Dismiss action.',
    ),
  })
  .strict();

const startupSourceRefSchema = z.object({
  sourceType: startupSourceTypeSchema,
  sourceId: z.string().min(1),
});

const startupPlanReferenceSchema = z.object({
  sourceType: startupSourceTypeSchema,
  sourceId: z.string().min(1),
  rationale: z.string().min(1),
});

const startupPlanStepSchema = z
  .object({
    stepId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().min(1),
    targetFiles: z.array(z.string().min(1)).optional(),
    phase: z.number().int().min(1),
    references: z.array(startupPlanReferenceSchema),
  })
  .strict();

const startupPrimaryImplementationConnectionSchema = z
  .object({
    entityType: z.enum(['workflowStep', 'contract']),
    entityId: z.string().uuid(),
    entityTitle: z.string().min(1),
    relationship: z.enum(['fulfills', 'authors', 'enforces', 'consumes']),
    sourceField: z.string().min(1),
    sourceExcerpt: z.string().min(1),
    rationale: z.string().min(1),
  })
  .strict()
  .superRefine((connection, ctx) => {
    if (connection.entityType === 'workflowStep' && connection.relationship !== 'fulfills') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['relationship'],
        message: 'workflowStep connections must use the fulfills relationship',
      });
    }
    if (connection.entityType === 'contract' && connection.relationship === 'fulfills') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['relationship'],
        message: 'contract connections must use authors, enforces, or consumes',
      });
    }
  });

const startupPrimaryImplementationSchema = z
  .object({
    title: z.string().min(1),
    content: z.string().min(1),
    rationale: z.string().min(1),
    location: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
    connections: z.array(startupPrimaryImplementationConnectionSchema).min(1).optional(),
  })
  .strict();

const startupDiscrepancySchema = z.object({
  sourceRef: startupSourceRefSchema,
  sourceField: z.string().min(1).optional(),
  sourceExcerpt: z.string().min(1),
  reasoning: z.string().min(1),
  discrepancyText: z.string().min(1),
  severity: z.nativeEnum(LocalResponseDiscrepancySeverity),
});

const startupClarificationQuestionSchema = z.object({
  question: z.string().min(1),
  reason: z.string().min(1).optional(),
  relatedSourceRefs: z.array(startupSourceRefSchema).optional(),
});

const startupMissedStepResolutionSchema = z.object({
  type: z.nativeEnum(LocalResponseStartupMissedStepResolutionType),
  description: z.string().min(1),
  targetStageId: z.string().min(1).optional(),
  proposalId: z.string().min(1).optional(),
});

const startupMissedStepSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  missingPrecondition: z.string().min(1).optional(),
  referencedArtifact: z.string().min(1).optional(),
  suggestedResolution: startupMissedStepResolutionSchema,
  references: z.array(startupPlanReferenceSchema).optional(),
});

const STARTUP_PLAN_NEXT_ACTIONS = {
  APPROVED: 'APPROVED',
  REVISED: 'REVISED',
} as const;
type StartupPlanNextAction =
  (typeof STARTUP_PLAN_NEXT_ACTIONS)[keyof typeof STARTUP_PLAN_NEXT_ACTIONS];

export const startupSessionPlanResponseSchema = z.object({
  responseType: z.literal('startup_plan_v1'),
  sessionTitle: z.string().min(1),
  requiredServiceIds: z
    .array(z.string().min(1))
    .min(1)
    .refine((serviceIds) => new Set(serviceIds).size === serviceIds.length, {
      message: 'requiredServiceIds must not contain duplicates',
    }),
  primaryImplementations: z.array(startupPrimaryImplementationSchema).min(1),
  executionPlan: z.array(startupPlanStepSchema).min(1),
  discrepancies: z.array(startupDiscrepancySchema),
  clarificationQuestions: z.array(startupClarificationQuestionSchema),
  nextAction: z
    .enum([STARTUP_PLAN_NEXT_ACTIONS.APPROVED, STARTUP_PLAN_NEXT_ACTIONS.REVISED])
    .optional(),
  missedSteps: z.array(startupMissedStepSchema).optional(),
});

const hierarchyWalkEntrySchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  name: z.string().min(1),
  distance: z.number().int().min(0),
  section: z.nativeEnum(LocalResponseHierarchyWalkSection).optional(),
  action: z.nativeEnum(LocalResponseHierarchyWalkAction),
  rationale: z.string().min(1),
});

const dependentTaskWalkEntrySchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  name: z.string().min(1),
  relationshipType: z.string().min(1),
  action: z.nativeEnum(LocalResponseHierarchyWalkAction),
  rationale: z.string().min(1),
});

const finalAssessmentResponseSchema = z.object({
  responseType: z.literal('final_assessment_v2'),
  taskAssessment: z.object({
    target: z.object({
      entityType: z.literal('task'),
      entityId: z.string(),
    }),
    verdict: z.enum(['completed', 'partiallyCompleted', 'blocked', 'notCompleted', 'unknown']),
    statusRecommendation: z.object({
      status: z.nativeEnum(LocalPromptWorkStatus),
      reason: z.string().min(1),
    }),
    summary: z.string().min(1),
  }),
  hierarchyWalk: z.array(hierarchyWalkEntrySchema).min(1),
  dependentTaskWalk: z.array(dependentTaskWalkEntrySchema).optional(),
});

const verificationResponseSourceTypeSchema = z.nativeEnum(LocalResponseFinalAssessmentSourceType);

const verificationPlanResponseSchema = z.object({
  responseType: z.literal('verification_plan_v1'),
  verificationChecks: z.array(
    z.object({
      checkId: z.string().min(1),
      tier: z.nativeEnum(LocalResponseVerificationTier),
      priority: z.number().int().min(1),
      goal: z.string().min(1),
      target: z.object({
        entityType: z.enum(['task', 'designDoc', 'service', 'artifact']),
        entityId: z.string(),
      }),
      steps: z.array(z.string().min(1)).min(1),
      expectedResult: z.string().min(1),
      fallback: z.union([
        z.null(),
        z.object({
          tier: z.enum(['api_or_script', 'automated_test']),
          trigger: z.string().min(1),
          steps: z.array(z.string().min(1)).min(1),
        }),
      ]),
      evidenceRefs: z.array(
        z.object({
          sourceType: verificationResponseSourceTypeSchema,
          sourceId: z.string().min(1),
        }),
      ),
    }),
  ),
  coverageSummary: z.object({
    verifiedBehaviors: z.array(z.string().min(1)),
    remainingRisks: z.array(z.string().min(1)),
    recommendedNextAction: z.string().min(1),
  }),
});

const childTaskDescriptionUpdateResponseSchema = z.object({
  responseType: z.literal('child_task_description_update_v1'),
  updates: z.array(
    z.object({
      taskId: z.string().min(1),
      integrationNote: z.string().min(1),
    }),
  ),
});

const neighborhoodTaskUpdatesResponseSchema = z.object({
  responseType: z.literal('neighborhood_task_updates_v1'),
  taskUpdates: z.array(
    z.object({
      taskId: z.string().min(1),
      descriptionUpdate: z.string().min(1).nullable(),
      acceptanceCriteriaUpdate: z.string().min(1).nullable(),
      reasoning: z.string().min(1),
    }),
  ),
});

const setSplittingGeneratedTaskSchema = z.object({
  title: z.string().min(1),
  description: z.string().min(1),
  acceptanceCriteria: z.string().min(1),
});

const setSplittingResponseSchema = z.object({
  responseType: z.literal('set_splitting_v1'),
  splitMode: z.enum(['feature', 'service']),
  tasks: z.array(setSplittingGeneratedTaskSchema).min(2),
  reasoning: z.string().min(1),
});

const influenceSchema = z.object({
  entityId: z.string().min(1),
  entityType: z.nativeEnum(EntityType),
  reasoning: z.string().min(1),
  reasonType: z.string().min(1),
  confidence: z.number().min(0).max(1).optional(),
});

const createProposalDtoSchema = z.object({
  type: z.nativeEnum(ProposalType),
  action: z.nativeEnum(ProposalAction),
  targetEntityId: z.string(),
  targetEntityType: z.nativeEnum(TargetEntityType),
  eli5: z.string().min(1).max(150),
  updates: z.record(z.unknown()),
  requestorContext: z.record(z.unknown()).optional(),
  influences: z.array(influenceSchema).optional(),
  generatedWithVersion: z.string().min(1).optional(),
  validationSessionId: z.string().min(1).optional(),
  conversationId: z.string().min(1).optional(),
});

const toErrorString = (issues: z.ZodIssue[]): string =>
  issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');

interface ParseResultError {
  ok: false;
  error: string;
}

export type ParseResult<T> = ParseResultError | { ok: true; value: T };

const createSchemaParser = <TSchema extends z.ZodTypeAny, TOut>(
  schema: TSchema,
  preprocess?: (raw: unknown) => unknown,
): ((raw: unknown) => ParseResult<TOut>) => {
  return (raw: unknown): ParseResult<TOut> => {
    const input = preprocess ? preprocess(raw) : raw;
    const parsed = schema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, error: toErrorString(parsed.error.issues) };
    }
    return { ok: true, value: parsed.data as unknown as TOut };
  };
};

export type ParseStartupSessionPlanResponseResult = ParseResult<LocalStartupSessionPlanResponse>;

export type ParseImplementationReadinessResponseResult =
  ParseResult<ImplementationReadinessPayload>;

export const parseImplementationReadinessResponse = createSchemaParser<
  typeof implementationReadinessResponseSchema,
  ImplementationReadinessPayload
>(implementationReadinessResponseSchema);

export const parseStartupSessionPlanResponse = createSchemaParser<
  typeof startupSessionPlanResponseSchema,
  LocalStartupSessionPlanResponse
>(startupSessionPlanResponseSchema);

export type ParseFinalAssessmentResponseResult = ParseResult<LocalFinalAssessmentResponse>;

export const parseFinalAssessmentResponse = createSchemaParser<
  typeof finalAssessmentResponseSchema,
  LocalFinalAssessmentResponse
>(finalAssessmentResponseSchema);

export type ParseVerificationPlanResponseResult = ParseResult<LocalVerificationPlanResponse>;

export const parseVerificationPlanResponse = createSchemaParser<
  typeof verificationPlanResponseSchema,
  LocalVerificationPlanResponse
>(verificationPlanResponseSchema);

export type ParseChildTaskDescriptionUpdateResponseResult =
  ParseResult<LocalChildTaskDescriptionUpdateResponse>;

export const parseChildTaskDescriptionUpdateResponse = createSchemaParser<
  typeof childTaskDescriptionUpdateResponseSchema,
  LocalChildTaskDescriptionUpdateResponse
>(childTaskDescriptionUpdateResponseSchema);

export type ParseNeighborhoodTaskUpdatesResponseResult =
  ParseResult<LocalNeighborhoodTaskUpdatesResponse>;

export const parseNeighborhoodTaskUpdatesResponse = createSchemaParser<
  typeof neighborhoodTaskUpdatesResponseSchema,
  LocalNeighborhoodTaskUpdatesResponse
>(neighborhoodTaskUpdatesResponseSchema);

export type ParseSetSplittingResponseResult = ParseResult<LocalSetSplittingResponse>;

export const parseSetSplittingResponse = createSchemaParser<
  typeof setSplittingResponseSchema,
  LocalSetSplittingResponse
>(setSplittingResponseSchema);

const rollupProposalResponseSchema = z.object({
  responseType: z.literal('rollup_proposal_v1'),
  parentFeatureProposalIds: z.array(z.string().min(1)),
  relatedFeatureProposalIds: z.array(z.string().min(1)),
});

export type ParseRollupProposalResponseResult = ParseResult<LocalRollupProposalResponse>;

export const parseRollupProposalResponse = createSchemaParser<
  typeof rollupProposalResponseSchema,
  LocalRollupProposalResponse
>(rollupProposalResponseSchema);

const validReportTypes = Object.keys(REPORT_CATALOG) as [string, ...string[]];

const reportEntityRelation = z.enum(['PRIMARY', 'CONTEXT']);

const reportEntityRefSchema = z.object({
  entityType: z.string().min(1),
  entityId: z.string().min(1),
  relation: reportEntityRelation,
});

const reportSpecSchema = z.object({
  reportType: z.enum(validReportTypes),
  title: z.string().min(1).optional(),
  text: z.string().min(1),
  entities: z.array(reportEntityRefSchema).optional().default([]),
});

export const dailySessionResponseSchema = z.object({
  responseType: z.literal('daily_session_v1'),
  response: z.string().min(1),
  reports: z.array(reportSpecSchema).min(1),
});

export type ParseDailySessionResponseResult = ParseResult<LocalDailySessionResponse>;

export const parseDailySessionResponse = createSchemaParser<
  typeof dailySessionResponseSchema,
  LocalDailySessionResponse
>(dailySessionResponseSchema);

const reportUpdateResponseSchema = z.object({
  responseType: z.literal('report_update_v1'),
  title: z.string().min(1).optional(),
  text: z.string().min(1),
  summary: z.string().min(1),
});

export type ParseReportUpdateResponseResult = ParseResult<LocalReportUpdateResponse>;

export const parseReportUpdateResponse = createSchemaParser<
  typeof reportUpdateResponseSchema,
  LocalReportUpdateResponse
>(reportUpdateResponseSchema);

const agentSearchResultItemSchema = z.object({
  entityType: z.nativeEnum(LocalAgentSearchEntityType),
  entityId: z.string().min(1),
  title: z.string().min(1),
  reason: z.string().min(1),
});

const agentSearchResultsResponseSchema = z.object({
  responseType: z.literal('agent_search_results_v1'),
  response: z.string().min(1),
  results: z.array(agentSearchResultItemSchema),
});

const goalPmRoutingEvidenceSchema = z
  .object({
    messageId: z.string().uuid(),
    excerpt: z.string().min(1),
    rationale: z.string().min(1),
  })
  .strict();

const meaningfulConversationTitleSchema = z
  .string()
  .min(1)
  .superRefine((title, context) => {
    if (
      /^(?:conversation|new conversation|untitled conversation|unknown conversation|n\/a|none|<[^<>]+>)$/i.test(
        title.trim(),
      )
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Conversation titles must identify the canonical conversation.',
      });
    }
  });

const goalPmExistingConversationOptionSchema = z
  .object({
    optionId: z.string().min(1),
    kind: z.literal('existingConversation'),
    conversationId: z.string().uuid(),
    title: meaningfulConversationTitleSchema,
    evidence: z.array(goalPmRoutingEvidenceSchema).min(1),
    rationale: z.string().min(1),
  })
  .strict();

const goalPmStartNewConversationOptionSchema = z
  .object({
    optionId: z.string().min(1),
    kind: z.literal('startNewConversation'),
    title: z.string().min(1),
    rationale: z.string().min(1),
    requiresConfirmation: z.literal(true),
  })
  .strict();

const goalPmRefineSearchOptionSchema = z
  .object({
    optionId: z.string().min(1),
    kind: z.literal('refineSearch'),
    title: z.string().min(1),
    prompt: z.string().min(1),
    rationale: z.string().min(1),
  })
  .strict();

const goalPmTaskTargetSchema = z
  .object({
    entityType: z.literal('TASK'),
    entityId: z.string().uuid(),
    title: z.string().min(1),
  })
  .strict();

const goalPmPlanTargetSchema = z
  .object({
    entityType: z.literal('PLAN'),
    entityId: z.string().uuid(),
    title: z.string().min(1),
  })
  .strict();

const goalPmWorkTargetSchema = z.discriminatedUnion('entityType', [
  goalPmTaskTargetSchema,
  goalPmPlanTargetSchema,
]);

const goalPmTrackExistingWorkOptionSchema = z
  .object({
    optionId: z.string().min(1),
    kind: z.literal('trackExistingWork'),
    target: goalPmWorkTargetSchema,
    rationale: z.string().min(1),
    requiresSelection: z.literal(true),
  })
  .strict();

const goalPmCreateMissingWorkOptionSchema = z
  .object({
    optionId: z.string().min(1),
    kind: z.literal('createMissingWork'),
    parentFeatureId: z.string().uuid(),
    workItemType: z.literal('TASK'),
    title: z.string().min(1),
    description: z.string().min(1),
    acceptanceCriteria: z.string().min(1),
    authoringMode: z.literal('PROPOSAL'),
    rationale: z.string().min(1),
    requiresSelection: z.literal(true),
  })
  .strict();

const goalPmProposalOptionSchema = z
  .object({
    optionId: z.string().min(1),
    kind: z.literal('proposal'),
    proposalId: z.string().uuid(),
    title: z.string().min(1),
    rationale: z.string().min(1),
    requiresSelection: z.literal(true),
  })
  .strict();

const goalPmRoutingOptionSchema = z.discriminatedUnion('kind', [
  goalPmExistingConversationOptionSchema,
  goalPmStartNewConversationOptionSchema,
  goalPmRefineSearchOptionSchema,
  goalPmTrackExistingWorkOptionSchema,
  goalPmCreateMissingWorkOptionSchema,
  goalPmProposalOptionSchema,
]);

const goalPmRoutingResponseSchema = z
  .object({
    responseType: z.literal('goal_pm_routing_v1'),
    goalId: z.string().uuid(),
    options: z.array(goalPmRoutingOptionSchema).min(1).max(8),
  })
  .strict()
  .superRefine((response, context) => {
    const optionIds = new Set<string>();
    let startNewConversationCount = 0;
    let refineSearchCount = 0;
    response.options.forEach((option, index) => {
      if (optionIds.has(option.optionId)) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['options', index, 'optionId'],
          message: 'optionId must be unique within the response.',
        });
      }
      optionIds.add(option.optionId);
      if (option.kind === 'startNewConversation') {
        startNewConversationCount += 1;
      }
      if (option.kind === 'refineSearch') {
        refineSearchCount += 1;
      }
    });

    if (startNewConversationCount !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'Goal PM routing must offer exactly one startNewConversation option.',
      });
    }
    if (refineSearchCount > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'Goal PM routing must offer at most one refineSearch option.',
      });
    }
  });

export type ParseAgentSearchResultsResponseResult = ParseResult<LocalAgentSearchResultsResponse>;

export const parseAgentSearchResultsResponse = createSchemaParser<
  typeof agentSearchResultsResponseSchema,
  LocalAgentSearchResultsResponse
>(agentSearchResultsResponseSchema);

export type ParseGoalPmRoutingResponseResult = ParseResult<LocalGoalPmRoutingResponse>;

export const parseGoalPmRoutingResponse = createSchemaParser<
  typeof goalPmRoutingResponseSchema,
  LocalGoalPmRoutingResponse
>(goalPmRoutingResponseSchema);

const planShapingFeatureSyncAnalyzeDiscrepancySchema = z.object({
  summary: z.string().min(1),
  rationale: z.string().min(1),
  entityType: z.enum(['FEATURE', 'TASK', 'DESIGN_DOC', 'SERVICE', 'OTHER']).optional(),
  entityId: z.string().optional(),
  proposal: z.string().optional(),
});

const planShapingFeatureSyncAnalyzeResponseSchema = z.object({
  responseType: z.literal('plan_shaping_feature_sync_analyze_v1'),
  action: z.enum(['NO_DISCREPANCY', 'DISCREPANCY']),
  discrepancies: z.array(planShapingFeatureSyncAnalyzeDiscrepancySchema).optional(),
});

export type PlanShapingFeatureSyncAnalyzeResponse = z.infer<
  typeof planShapingFeatureSyncAnalyzeResponseSchema
>;

export type ParsePlanShapingFeatureSyncAnalyzeResponseResult =
  ParseResult<PlanShapingFeatureSyncAnalyzeResponse>;

export const parsePlanShapingFeatureSyncAnalyzeResponse = createSchemaParser<
  typeof planShapingFeatureSyncAnalyzeResponseSchema,
  PlanShapingFeatureSyncAnalyzeResponse
>(planShapingFeatureSyncAnalyzeResponseSchema);

const planShapingFeatureSyncIterateDiscrepancySchema = z.object({
  summary: z.string().min(1),
  rationale: z.string().min(1),
  entityType: z.enum(['FEATURE', 'TASK', 'DESIGN_DOC', 'SERVICE', 'OTHER']),
  entityId: z.string().min(1),
});

const planShapingFeatureSyncIterateResponseSchema = z.object({
  responseType: z.literal('plan_shaping_feature_sync_iterate_v1'),
  discrepancies: z.array(planShapingFeatureSyncIterateDiscrepancySchema).min(1),
  proposals: z.array(createProposalDtoSchema).min(1),
});

export type PlanShapingFeatureSyncIterateResponse = z.infer<
  typeof planShapingFeatureSyncIterateResponseSchema
>;

export type ParsePlanShapingFeatureSyncIterateResponseResult =
  ParseResult<PlanShapingFeatureSyncIterateResponse>;

export const parsePlanShapingFeatureSyncIterateResponse = createSchemaParser<
  typeof planShapingFeatureSyncIterateResponseSchema,
  PlanShapingFeatureSyncIterateResponse
>(planShapingFeatureSyncIterateResponseSchema);
