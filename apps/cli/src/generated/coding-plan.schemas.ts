/* This file is generated from OpenAPI by scripts/generate-workflow-review-schemas.js. */
import { z } from 'zod';
import type { CodingPlanVersion, CodingPlanEmissionInput } from '../shared/api/generated/api';

export const CodingPlanVersionSchema = z
  .object({
    responseType: z.literal('coding_plan_version_v1'),
    markdown: z.string().min(1),
    requiredServiceIds: z
      .array(z.string().uuid())
      .min(1)
      .refine(
        (items) => new Set(items.map((item) => JSON.stringify(item))).size === items.length,
        'Array items must be unique',
      ),
  })
  .strict() satisfies z.ZodType<CodingPlanVersion>;

const ImplementRuntimeSelectionSchema = z
  .object({
    provider: z.enum(['claude', 'codex', 'opencode']),
    model: z.string().min(1),
    reasoningEffort: z
      .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'default'])
      .optional(),
    fastMode: z.boolean().optional(),
  })
  .strict();

export const ImplementPromptPayloadSchema = z
  .object({
    approvedVersion: CodingPlanVersionSchema.optional(),
    versionMessageId: z.string().uuid().optional(),
    approvalFeedback: z.string().optional(),
    planningDiscussion: z.string().optional(),
    runtime: ImplementRuntimeSelectionSchema.optional(),
    userMessage: z.string().optional(),
  })
  .strict();

const CodingPromptStartupSourceTypeSchema = z.enum([
  'evidenceItem',
  'task',
  'designDoc',
  'plan',
  'initiative',
]);

const CodingPromptStartupSourceRefSchema = z
  .object({
    sourceType: CodingPromptStartupSourceTypeSchema,
    sourceId: z.string(),
  })
  .passthrough();

const CodingPromptStartupDiscrepancySchema = z
  .object({
    sourceRef: CodingPromptStartupSourceRefSchema,
    sourceField: z.string().optional(),
    sourceExcerpt: z.string(),
    reasoning: z.string(),
    discrepancyText: z.string(),
    severity: z.enum(['low', 'medium', 'high']),
  })
  .passthrough();

export const CodingPlanDiscrepancySchema = z.intersection(
  CodingPromptStartupDiscrepancySchema,
  z
    .object({
      sourceField: z.string().min(1),
    })
    .passthrough(),
);

const CodingPlanIssueResolutionSchema = z
  .object({
    messageId: z.string().uuid(),
    resolution: z.string(),
  })
  .strict();

export const CodingPlanContextSchema = z
  .object({
    responseType: z.literal('coding_plan_context_v1'),
    sessionTitle: z.string().min(1),
    intent: z.string().min(1),
    technicalContext: z.string().min(1),
    issues: z.array(CodingPlanIssueResolutionSchema),
    requiredServiceIds: z
      .array(z.string().uuid())
      .min(1)
      .refine(
        (items) => new Set(items.map((item) => JSON.stringify(item))).size === items.length,
        'Array items must be unique',
      ),
  })
  .strict();

export const CodingPlanVersionApprovalSchema = z
  .object({
    responseType: z.literal('coding_plan_version_approval_v1'),
    versionMessageId: z.string().uuid(),
    feedback: z.string().optional(),
    runtime: ImplementRuntimeSelectionSchema.optional(),
  })
  .strict();

export const CodingPlanEmissionInputSchema = z
  .object({
    markdown: z.string().min(1),
    requiredServiceIds: z
      .array(z.string().uuid())
      .min(1)
      .refine(
        (items) => new Set(items.map((item) => JSON.stringify(item))).size === items.length,
        'Array items must be unique',
      ),
  })
  .strict() satisfies z.ZodType<CodingPlanEmissionInput>;

export const CodingPlanConversationalApprovalSchema = z
  .object({
    responseType: z.literal('coding_plan_approval_v1'),
    contextMessageId: z.string().uuid(),
    feedback: z.string().optional(),
    runtime: ImplementRuntimeSelectionSchema.optional(),
  })
  .strict();

const CodingPromptStartupPrimaryImplementationConnectionSchema = z
  .object({
    entityType: z.enum(['workflowStep', 'contract']),
    entityId: z.string().uuid(),
    entityTitle: z.string().min(1),
    relationship: z.enum(['fulfills', 'authors', 'enforces', 'consumes']),
    sourceField: z.string().min(1),
    sourceExcerpt: z.string().min(1),
    rationale: z.string().min(1),
  })
  .passthrough();

const CodingPromptStartupPrimaryImplementationSchema = z
  .object({
    title: z.string().min(1),
    content: z.string().min(1),
    rationale: z.string().min(1),
    location: z.string().min(1).optional(),
    language: z.string().min(1).optional(),
    connections: z
      .array(CodingPromptStartupPrimaryImplementationConnectionSchema)
      .min(1)
      .optional(),
  })
  .passthrough();

const CodingPromptStartupPlanReferenceSchema = z
  .object({
    sourceType: CodingPromptStartupSourceTypeSchema,
    sourceId: z.string(),
    rationale: z.string(),
  })
  .passthrough();

const CodingPromptStartupPlanStepSchema = z
  .object({
    stepId: z.string(),
    title: z.string(),
    description: z.string(),
    targetFiles: z.array(z.string()).optional(),
    references: z.array(CodingPromptStartupPlanReferenceSchema),
    validationFocus: z.string().optional(),
    phase: z.number().int().min(1),
  })
  .passthrough();

const CodingPromptStartupClarificationQuestionSchema = z
  .object({
    question: z.string(),
    reason: z.string().optional(),
    relatedSourceRefs: z.array(CodingPromptStartupSourceRefSchema).optional(),
  })
  .passthrough();

const CodingPromptStartupPlanPayloadSchema = z
  .object({
    responseType: z.literal('startup_plan_v1'),
    sessionTitle: z.string(),
    requiredServiceIds: z
      .array(z.string().min(1))
      .min(1)
      .refine(
        (items) => new Set(items.map((item) => JSON.stringify(item))).size === items.length,
        'Array items must be unique',
      ),
    primaryImplementations: z.array(CodingPromptStartupPrimaryImplementationSchema).min(1),
    executionPlan: z.array(CodingPromptStartupPlanStepSchema),
    discrepancies: z.array(CodingPromptStartupDiscrepancySchema),
    clarificationQuestions: z.array(CodingPromptStartupClarificationQuestionSchema),
  })
  .passthrough();

const CodingPlanReviewDiscrepancyFeedbackEntrySchema = z
  .object({
    discrepancyIndex: z.number().int().min(0),
    note: z.string(),
  })
  .strict();

const CodingPlanReviewStepFeedbackEntrySchema = z
  .object({
    stepId: z.string().min(1),
    note: z.string(),
  })
  .strict();

const CodingPlanReviewQuestionAnswerEntrySchema = z
  .object({
    questionIndex: z.number().int().min(0),
    answer: z.string(),
  })
  .strict();

export const CodingPlanReviewAnswerPayloadSchema = z.intersection(
  CodingPromptStartupPlanPayloadSchema,
  z
    .object({
      discrepancyFeedback: z.array(CodingPlanReviewDiscrepancyFeedbackEntrySchema).optional(),
      stepFeedback: z.array(CodingPlanReviewStepFeedbackEntrySchema).optional(),
      questionAnswers: z.array(CodingPlanReviewQuestionAnswerEntrySchema).optional(),
      feedback: z.string().optional(),
      provider: z.enum(['claude', 'codex', 'opencode']).optional(),
      model: z.string().min(1).optional(),
      reasoningEffort: z
        .enum(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra', 'default'])
        .optional(),
      fastMode: z.boolean().optional(),
    })
    .passthrough(),
);

export const CodingPlanApprovalPayloadSchema = z.union([
  CodingPlanVersionApprovalSchema,
  CodingPlanReviewAnswerPayloadSchema,
]);

const CodingPlanRefineWorkflowAnswerSchema = z
  .object({
    action: z.literal('REFINE'),
    payload: CodingPlanReviewAnswerPayloadSchema,
  })
  .strict();

const CodingPlanApprovedWorkflowAnswerSchema = z
  .object({
    action: z.literal('APPROVED'),
    payload: CodingPlanApprovalPayloadSchema,
  })
  .strict();

export const CodingPlanWorkflowAnswerSchema = z.union([
  CodingPlanRefineWorkflowAnswerSchema,
  CodingPlanApprovedWorkflowAnswerSchema,
]);

export const QuestionsFeedbackPayloadSchema = z
  .object({
    feedback: z.string(),
  })
  .strict();

export const QuestionsApprovedPayloadSchema = z.object({}).strict();

export const PlanShapingFeatureSyncReviewDismissedAnswerPayloadSchema = z.object({}).strict();

const PlanShapingFeatureSyncItemDecisionSchema = z
  .object({
    itemId: z.string().min(1),
    choice: z.enum(['accept', 'amend', 'dismiss']),
    note: z.string().optional(),
  })
  .strict();

export const PlanShapingFeatureSyncReviewRefineAnswerPayloadSchema = z
  .object({
    feedback: z.string(),
    decisions: z.array(PlanShapingFeatureSyncItemDecisionSchema).optional(),
  })
  .strict();

const FeatureListRefinementSchema = z
  .object({
    sections: z.object({}).catchall(z.string()),
    overall: z.string(),
  })
  .strict();

const OnboardingFeatureListReviewRefineSubmissionSchema = z
  .object({
    action: z.literal('REFINE'),
    payload: FeatureListRefinementSchema,
  })
  .strict();

const OnboardingFeatureListReviewApprovedSubmissionSchema = z
  .object({
    action: z.literal('APPROVED'),
    payload: QuestionsApprovedPayloadSchema,
  })
  .strict();

export const OnboardingFeatureListReviewUserSubmissionSchema = z.union([
  OnboardingFeatureListReviewRefineSubmissionSchema,
  OnboardingFeatureListReviewApprovedSubmissionSchema,
]);

const PlanStageProposalStageFeedbackSchema = z
  .object({
    sequenceOrder: z.number().int(),
    title: z.string(),
    comment: z.string().optional(),
    action: z.enum(['accept', 'reject', 'pending']),
  })
  .passthrough();

const OnboardingPlanStageProposalReviewPayloadSchema = z
  .object({
    userMessage: z.string().optional(),
    stageFeedback: z.array(PlanStageProposalStageFeedbackSchema),
  })
  .strict();

const OnboardingPlanStageProposalReviewRefineSubmissionSchema = z
  .object({
    action: z.literal('REFINE'),
    payload: OnboardingPlanStageProposalReviewPayloadSchema,
  })
  .strict();

const OnboardingPlanStageProposalReviewApprovedSubmissionSchema = z
  .object({
    action: z.literal('APPROVED'),
    payload: OnboardingPlanStageProposalReviewPayloadSchema,
  })
  .strict();

export const OnboardingPlanStageProposalReviewUserSubmissionSchema = z.union([
  OnboardingPlanStageProposalReviewRefineSubmissionSchema,
  OnboardingPlanStageProposalReviewApprovedSubmissionSchema,
]);
