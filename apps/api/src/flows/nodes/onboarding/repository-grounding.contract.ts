import { z } from 'zod';
import {
  FeatureTag,
  CreateRepositoryImportConversationContext,
  RepositoryGroundingBriefDiscrepancy,
  RepositoryGroundingChildNode,
  RepositoryGroundingComprehensiveScope,
  RepositoryGroundingCompletion as ApiRepositoryGroundingCompletion,
  RepositoryGroundingDeterministicBounds,
  RepositoryGroundingAction,
  RepositoryGroundingAnalysisConfiguration,
  RepositoryGroundingConversationSeed,
  RepositoryGroundingEntryMode,
  RepositoryGroundingEvidenceItem,
  RepositoryGroundingFieldPayload,
  RepositoryGroundingFocusedScope,
  RepositoryGroundingHierarchy,
  RepositoryGroundingIntentAnswer,
  RepositoryGroundingPrerequisites,
  RepositoryGroundingRetryableFailure,
  RepositoryGroundingScope,
  RepositoryGroundingSuccess,
  RepositoryGroundingTerminalFailure,
  RepositoryGroundingTopLevelNode,
  RepositoryGroundingWorkflowContext,
  ProjectExistingWorkIntent,
  RepositoryPlacementAddAtRootSubmission,
  RepositoryPlacementAddToExistingSubmission,
  RepositoryPlacementExistingFeatureTarget,
  RepositoryPlacementIntelligentlyIntegrateSubmission,
  RepositoryPlacementPendingHolder,
  RepositoryPlacementReviewSubmission,
  RepositoryPlacementStrategySubmission,
  RepositoryPlacementSuccess,
  RepositoryPlacementRetryableFailure,
  RepositoryPlacementTerminalFailure,
} from 'src/generated';
import type {
  ExternalAgentActionSchemas,
  FlowUserMessage,
} from 'src/types/flow-internal.types';
import {
  ONBOARDING_NODES,
  REPOSITORY_IMPORT_NODES,
} from '../../constants/node-ids';
import type { TaskId } from '../../../types';

/**
 * The repository-grounding flow deliberately keeps its user-facing gate
 * independent from implementation vocabulary. These strings are part of the
 * conversation contract and must not be paraphrased by a caller.
 */
export const REPOSITORY_GROUNDING_INTENT_QUESTION =
  'Do you have an existing body of work you’d like Hey Hey to use to understand this project?';
export const REPOSITORY_GROUNDING_INTENT_HELPER =
  'This might include an existing codebase or other project materials available on your computer.';
export const REPOSITORY_GROUNDING_INTENT_OPTIONS = [
  { value: 'yes', label: 'Yes, import existing work' },
  { value: 'no', label: 'No, continue without it' },
] as const;

export const REPOSITORY_GROUNDING_FIELDS = {
  intent: 'repository_grounding_intent',
  service: 'repository_grounding_service',
  brief: 'repository_grounding_brief',
  machine: 'repository_grounding_machine',
  scope: 'repository_grounding_scope',
  focus: 'repository_grounding_focus',
  provider: 'repository_grounding_provider',
  start: 'repository_grounding_start',
  recovery: 'repository_grounding_recovery',
} as const;

/**
 * The shared repository-grounding field is a presentation surface, but its
 * admission payload is split into the three generated typed answer fields
 * below. Keeping those ids beside the legacy field ids makes the projection
 * explicit at both the browser and workflow boundaries.
 */
export const REPOSITORY_GROUNDING_TYPED_FIELDS = {
  prerequisites: 'repository_prerequisites',
  analysisConfiguration: 'repository_analysis_configuration',
  action: 'repository_grounding_action',
} as const;

export const REPOSITORY_PLACEMENT_FIELDS = {
  strategy: 'repository_placement_strategy',
  review: 'repository_placement_review',
} as const;

export const REPOSITORY_GROUNDING_ACTIONS = {
  SUCCESS: 'success',
  RETRYABLE_FAILURE: 'retryable_failure',
  TERMINAL_FAILURE: 'terminal_failure',
} as const;

export const REPOSITORY_PLACEMENT_ACTIONS = {
  SUCCESS: 'success',
  RETRYABLE_FAILURE: 'retryable_failure',
  TERMINAL_FAILURE: 'terminal_failure',
} as const;

export const REPOSITORY_GROUNDING_RECOVERY_ACTIONS = {
  RETRY: 'retry',
  EDIT_PREREQUISITES: 'edit_prerequisites',
  EDIT_CONFIGURATION: 'edit_configuration',
  CONTINUE_WITHOUT_ANALYSIS: 'continue_without_analysis',
} as const;

export const REPOSITORY_GROUNDING_START_ACTIONS = {
  START: 'start',
  FINISH_LATER: 'finish_later',
} as const;

/**
 * The bridge receives this closed catalog rather than a model chosen by the
 * browser. A provider can therefore only be accepted after the server has
 * resolved its current frontier model and usage class.
 */
type RepositoryGroundingFieldContext = {
  repositoryGrounding?: RepositoryGroundingWorkflowContext;
  repositoryGroundingSeed?: RepositoryGroundingConversationSeed;
  repositoryGroundingPrerequisites?: RepositoryGroundingPrerequisites;
  repositoryGroundingAnalysisConfiguration?: RepositoryGroundingAnalysisConfiguration;
  repositoryGroundingIntentRequired?: boolean;
};

/**
 * Build the API-authored presentation payload consumed by every repository
 * grounding entry and recovery surface. The browser receives only durable
 * choices and server-resolved limits; it never authors the typed context.
 */
export function buildRepositoryGroundingFieldPayload(
  context: RepositoryGroundingFieldContext,
  state: Record<string, unknown> = { phase: 'prerequisites' },
): RepositoryGroundingFieldPayload {
  const accepted = context.repositoryGrounding;
  const prerequisites =
    accepted?.prerequisites ?? context.repositoryGroundingPrerequisites;
  const configuration =
    accepted?.analysisConfiguration ??
    context.repositoryGroundingAnalysisConfiguration;
  const seed = context.repositoryGroundingSeed;
  const entryMode =
    prerequisites?.entryMode ??
    seed?.entryMode ??
    (context.repositoryGroundingIntentRequired
      ? RepositoryGroundingEntryMode.NewProject
      : RepositoryGroundingEntryMode.ExistingProject);

  return {
    initialValue: {
      entryMode:
        entryMode === RepositoryGroundingEntryMode.NewProject
          ? 'new'
          : 'existing',
      serviceId: prerequisites?.serviceId ?? seed?.serviceId ?? null,
      brief:
        prerequisites?.confirmedServiceBrief ??
        seed?.confirmedServiceBrief ??
        '',
      machineId: prerequisites?.machineId ?? seed?.machineId ?? null,
      scope: configuration?.scope ?? null,
      focus:
        configuration?.scope.scope === 'focused'
          ? configuration.scope.focus
          : '',
      provider: configuration?.provider ?? null,
      model: configuration?.resolvedFrontierModel ?? null,
      reasoningEffort: configuration?.reasoningEffort ?? null,
      fastMode: configuration?.fastMode ?? null,
      bounds:
        configuration?.bounds ?? REPOSITORY_GROUNDING_DETERMINISTIC_BOUNDS,
    },
    state,
    bounds: REPOSITORY_GROUNDING_DETERMINISTIC_BOUNDS,
  };
}

/**
 * These bounds are request-side execution controls. The paired CLI is
 * responsible for honoring them, but successful completions do not echo the
 * controls or synthesize activity totals. The API never receives a local path
 * or repository contents.
 */
export const REPOSITORY_GROUNDING_DETERMINISTIC_BOUNDS = {
  maxFiles: 5_000,
  maxTotalBytes: 25_000_000,
  maxFileBytes: 1_000_000,
  maxDepth: 12,
  maxGeneratedFiles: 1_000,
  maxIgnoredFiles: 1_000,
  maxUnsupportedFiles: 1_000,
  maxBinaryFiles: 1_000,
} satisfies RepositoryGroundingDeterministicBounds;

const repositoryGroundingEntryModeSchema = z.enum([
  RepositoryGroundingEntryMode.NewProject,
  RepositoryGroundingEntryMode.ExistingProject,
]);

const repositoryGroundingFeatureTagSchema = z.enum([
  FeatureTag.Product,
  FeatureTag.Frontend,
  FeatureTag.Backend,
  FeatureTag.Infra,
  FeatureTag.Design,
  FeatureTag.Ai,
]);

type ContractInputSchema<T> = z.ZodType<T, z.ZodTypeDef, unknown>;

const repositoryPlacementExistingFeatureTargetSchema: ContractInputSchema<RepositoryPlacementExistingFeatureTarget> =
  z
    .object({
      targetType: z.literal(
        RepositoryPlacementExistingFeatureTarget.TargetTypeEnum.ExistingFeature,
      ),
      featureId: z
        .string()
        .uuid()
        .transform((value) => value as TaskId),
    })
    .strict();

const repositoryPlacementPendingHolderSchema: ContractInputSchema<RepositoryPlacementPendingHolder> =
  z
    .object({
      targetType: z.literal(
        RepositoryPlacementPendingHolder.TargetTypeEnum.PendingHolder,
      ),
      name: z.string(),
      description: z.string(),
      tag: repositoryGroundingFeatureTagSchema,
    })
    .strict();

const repositoryPlacementAddAtRootSchema: ContractInputSchema<RepositoryPlacementAddAtRootSubmission> =
  z
    .object({
      action: z.literal(
        RepositoryPlacementAddAtRootSubmission.ActionEnum.AddAtRoot,
      ),
    })
    .strict();

const repositoryPlacementAddToExistingSchema: ContractInputSchema<RepositoryPlacementAddToExistingSubmission> =
  z
    .object({
      action: z.literal(
        RepositoryPlacementAddToExistingSubmission.ActionEnum.AddToExisting,
      ),
      parent: z.union([
        repositoryPlacementExistingFeatureTargetSchema,
        repositoryPlacementPendingHolderSchema,
      ]),
    })
    .strict();

const repositoryPlacementIntelligentlyIntegrateSchema: ContractInputSchema<RepositoryPlacementIntelligentlyIntegrateSubmission> =
  z
    .object({
      action: z.literal(
        RepositoryPlacementIntelligentlyIntegrateSubmission.ActionEnum
          .IntelligentlyIntegrate,
      ),
    })
    .strict();

export const repositoryPlacementStrategySubmissionSchema: ContractInputSchema<RepositoryPlacementStrategySubmission> =
  z.union([
    repositoryPlacementAddAtRootSchema,
    repositoryPlacementAddToExistingSchema,
    repositoryPlacementIntelligentlyIntegrateSchema,
  ]);

const repositoryPlacementCompletionTargetSchema = z.union([
  z.object({ kind: z.literal('PROJECT_ROOT') }).strict(),
  z
    .object({
      kind: z.literal('EXISTING_FEATURE'),
      featureId: z
        .string()
        .uuid()
        .transform((value) => value as TaskId),
    })
    .strict(),
]);

export const repositoryPlacementReviewSubmissionSchema: ContractInputSchema<RepositoryPlacementReviewSubmission> =
  z
    .object({
      action: z.literal(
        RepositoryPlacementReviewSubmission.ActionEnum.Approved,
      ),
      payload: z
        .object({
          overrides: z.array(
            z
              .object({
                rootKey: z.string().uuid(),
                target: repositoryPlacementCompletionTargetSchema,
              })
              .strict(),
          ),
        })
        .strict(),
    })
    .strict();

export const repositoryPlacementSuccessSchema: ContractInputSchema<RepositoryPlacementSuccess> =
  z
    .object({
      outcome: z.literal('success'),
      placements: z.array(
        z
          .object({
            rootKey: z.string().uuid(),
            target: repositoryPlacementCompletionTargetSchema,
            rationale: z.string().min(1),
            confidence: z.number().min(0).max(1),
          })
          .strict(),
      ),
    })
    .strict();

export const repositoryPlacementRetryableFailureSchema: ContractInputSchema<RepositoryPlacementRetryableFailure> =
  z
    .object({
      outcome: z.literal('retryable_failure'),
      code: z.enum([
        'provider_unavailable',
        'provider_timeout',
        'rate_limited',
        'graph_unavailable',
      ]),
      message: z.string().min(1),
      retryAfterSeconds: z.number().int().min(0).optional(),
    })
    .strict();

export const repositoryPlacementTerminalFailureSchema: ContractInputSchema<RepositoryPlacementTerminalFailure> =
  z
    .object({
      outcome: z.literal('terminal_failure'),
      code: z.enum([
        'invalid_request',
        'unsupported_provider',
        'unsupported_model',
        'access_denied',
        'invalid_completion',
      ]),
      message: z.string().min(1),
    })
    .strict();

export const repositoryPlacementActions: ExternalAgentActionSchemas = {
  success: { schema: repositoryPlacementSuccessSchema, waitForUser: false },
  retryable_failure: {
    schema: repositoryPlacementRetryableFailureSchema,
    waitForUser: false,
  },
  terminal_failure: {
    schema: repositoryPlacementTerminalFailureSchema,
    waitForUser: false,
  },
};

export function parseRepositoryPlacementCompletion(
  action: string,
  payload: unknown,
): RepositoryPlacementCompletion | undefined {
  const schema = repositoryPlacementActions[action]?.schema;
  if (!schema) return undefined;
  return schema.parse(payload) as RepositoryPlacementCompletion;
}

export type RepositoryPlacementCompletion =
  | RepositoryPlacementSuccess
  | RepositoryPlacementRetryableFailure
  | RepositoryPlacementTerminalFailure;

export function parseRepositoryPlacementStrategy(
  value: unknown,
): RepositoryPlacementStrategySubmission {
  return repositoryPlacementStrategySubmissionSchema.parse(value);
}

export function parseRepositoryPlacementReviewSubmission(
  value: unknown,
): RepositoryPlacementReviewSubmission {
  return repositoryPlacementReviewSubmissionSchema.parse(value);
}

const repositoryGroundingComprehensiveScopeSchema: z.ZodType<RepositoryGroundingComprehensiveScope> =
  z
    .object({
      scope: z.literal(
        RepositoryGroundingComprehensiveScope.ScopeEnum.Comprehensive,
      ),
    })
    .strict();

const repositoryGroundingFocusedScopeSchema: z.ZodType<RepositoryGroundingFocusedScope> =
  z
    .object({
      scope: z.literal(RepositoryGroundingFocusedScope.ScopeEnum.Focused),
      focus: z.string().min(1),
    })
    .strict();

export const repositoryGroundingScopeSchema: z.ZodType<RepositoryGroundingScope> =
  z.union([
    repositoryGroundingComprehensiveScopeSchema,
    repositoryGroundingFocusedScopeSchema,
  ]);

export const repositoryGroundingIntentAnswerSchema: z.ZodType<RepositoryGroundingIntentAnswer> =
  z
    .object({
      choice: z.enum([
        RepositoryGroundingIntentAnswer.ChoiceEnum.Yes,
        RepositoryGroundingIntentAnswer.ChoiceEnum.No,
      ]),
    })
    .strict();

export const repositoryGroundingActionSchema: z.ZodType<RepositoryGroundingAction> =
  z.enum([
    'START_ANALYSIS',
    'RETRY_ANALYSIS',
    'FINISH_LATER',
    'CONTINUE_CONVERSATION',
  ]);

/**
 * Conversation creation accepts either the complete workflow context or the
 * deliberately partial seed used by the Services Import entry point. The
 * seed is not an accepted analysis context and must not be parsed as one.
 */
export const repositoryGroundingConversationSeedSchema: z.ZodType<RepositoryGroundingConversationSeed> =
  z
    .object({
      entryMode: repositoryGroundingEntryModeSchema,
      serviceId: z.string().min(1).optional(),
      confirmedServiceBrief: z.string().min(1).nullable().optional(),
      machineId: z.string().min(1).optional(),
    })
    .strict();

export const repositoryGroundingPrerequisitesSchema: z.ZodType<RepositoryGroundingPrerequisites> =
  z
    .object({
      entryMode: repositoryGroundingEntryModeSchema,
      serviceId: z.string().min(1),
      confirmedServiceBrief: z.string().min(1),
      machineId: z.string().min(1),
    })
    .strict();

const repositoryGroundingBoundsSchema: z.ZodType<RepositoryGroundingDeterministicBounds> =
  z
    .object({
      maxFiles: z.number().int().min(1),
      maxTotalBytes: z.number().int().min(1),
      maxFileBytes: z.number().int().min(1),
      maxDepth: z.number().int().min(0),
      maxGeneratedFiles: z.number().int().min(0),
      maxIgnoredFiles: z.number().int().min(0),
      maxUnsupportedFiles: z.number().int().min(0),
      maxBinaryFiles: z.number().int().min(0),
    })
    .strict();

export const repositoryGroundingAnalysisConfigurationSchema = z
  .object({
    scope: repositoryGroundingScopeSchema,
    provider: z.enum(['claude', 'codex', 'opencode']),
    resolvedFrontierModel: z.string().min(1),
    reasoningEffort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']),
    fastMode: z.boolean().optional(),
    bounds: repositoryGroundingBoundsSchema,
  })
  .strict();

export const repositoryGroundingWorkflowContextSchema: z.ZodType<RepositoryGroundingWorkflowContext> =
  z
    .object({
      prerequisites: repositoryGroundingPrerequisitesSchema,
      analysisConfiguration: repositoryGroundingAnalysisConfigurationSchema,
    })
    .strict();

export type RepositoryGroundingFormSubmission = {
  prerequisites: RepositoryGroundingPrerequisites;
  analysisConfiguration: RepositoryGroundingAnalysisConfiguration;
  action: RepositoryGroundingAction;
};

export function parseRepositoryGroundingConversationSeed(
  value: unknown,
): RepositoryGroundingConversationSeed {
  return repositoryGroundingConversationSeedSchema.parse(value);
}

export const repositoryRelativePathSchema = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith('/') &&
      !/^[A-Za-z]:/.test(value) &&
      !value.includes('\\') &&
      !value.split('/').includes('..'),
    'Path must be repository-relative and cannot traverse outside the repository',
  );

const repositoryGroundingEvidenceItemSchema: z.ZodType<RepositoryGroundingEvidenceItem> =
  z
    .object({
      path: repositoryRelativePathSchema,
      summary: z.string().min(1),
      lineStart: z.number().int().min(1).optional(),
      lineEnd: z.number().int().min(1).optional(),
    })
    .strict();

const repositoryGroundingChildNodeSchema: z.ZodType<RepositoryGroundingChildNode> =
  z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().min(1),
      tag: repositoryGroundingFeatureTagSchema,
    })
    .strict();

const repositoryGroundingTopLevelNodeSchema: z.ZodType<RepositoryGroundingTopLevelNode> =
  z
    .object({
      id: z.string().min(1),
      name: z.string().min(1),
      description: z.string().min(1),
      tag: repositoryGroundingFeatureTagSchema,
      children: z.array(repositoryGroundingChildNodeSchema).min(1),
    })
    .strict();

export const repositoryGroundingHierarchySchema: z.ZodType<RepositoryGroundingHierarchy> =
  z
    .object({
      topLevels: z.array(repositoryGroundingTopLevelNodeSchema).min(1),
    })
    .strict();

const repositoryGroundingBriefDiscrepancySchema: z.ZodType<RepositoryGroundingBriefDiscrepancy> =
  z
    .object({
      summary: z.string().min(1),
      rationale: z.string().min(1),
      material: z.literal(true),
      evidencePaths: z.array(repositoryRelativePathSchema).optional(),
    })
    .strict();

export const repositoryGroundingSuccessSchema = z
  .object({
    outcome: z.literal(RepositoryGroundingSuccess.OutcomeEnum.Success),
    serviceId: z.string().min(1),
    provider: z.string().min(1),
    resolvedFrontierModel: z.string().min(1),
    narrative: z.string().min(1),
    hierarchy: repositoryGroundingHierarchySchema,
    evidence: z.array(repositoryGroundingEvidenceItemSchema).min(1),
    briefDiscrepancies: z.array(repositoryGroundingBriefDiscrepancySchema),
  })
  .strict() satisfies z.ZodType<RepositoryGroundingSuccess>;

export const repositoryGroundingRetryableFailureSchema: z.ZodType<RepositoryGroundingRetryableFailure> =
  z
    .object({
      outcome: z.literal(
        RepositoryGroundingRetryableFailure.OutcomeEnum.RetryableFailure,
      ),
      code: z.enum([
        RepositoryGroundingRetryableFailure.CodeEnum.MachineUnavailable,
        RepositoryGroundingRetryableFailure.CodeEnum.DirectoryUnresolved,
        RepositoryGroundingRetryableFailure.CodeEnum.ProviderUnavailable,
        RepositoryGroundingRetryableFailure.CodeEnum.ProviderTimeout,
        RepositoryGroundingRetryableFailure.CodeEnum.RateLimited,
        RepositoryGroundingRetryableFailure.CodeEnum.TransientReadFailure,
      ]),
      message: z.string().min(1),
      retryAfterSeconds: z.number().int().min(0).optional(),
    })
    .strict();

export const repositoryGroundingTerminalFailureSchema: z.ZodType<RepositoryGroundingTerminalFailure> =
  z
    .object({
      outcome: z.literal(
        RepositoryGroundingTerminalFailure.OutcomeEnum.TerminalFailure,
      ),
      code: z.enum([
        RepositoryGroundingTerminalFailure.CodeEnum.InvalidRequest,
        RepositoryGroundingTerminalFailure.CodeEnum.UnsupportedScope,
        RepositoryGroundingTerminalFailure.CodeEnum.UnsupportedProvider,
        RepositoryGroundingTerminalFailure.CodeEnum.UnsupportedModel,
        RepositoryGroundingTerminalFailure.CodeEnum.AccessDenied,
        RepositoryGroundingTerminalFailure.CodeEnum.InvalidCompletion,
      ]),
      message: z.string().min(1),
    })
    .strict();

export const repositoryGroundingCompletionSchema: z.ZodType<ApiRepositoryGroundingCompletion> =
  z.union([
    repositoryGroundingRetryableFailureSchema,
    repositoryGroundingSuccessSchema,
    repositoryGroundingTerminalFailureSchema,
  ]);

export const repositoryGroundingActions: ExternalAgentActionSchemas = {
  [REPOSITORY_GROUNDING_ACTIONS.SUCCESS]: {
    schema: repositoryGroundingSuccessSchema,
    waitForUser: false,
  },
  [REPOSITORY_GROUNDING_ACTIONS.RETRYABLE_FAILURE]: {
    schema: repositoryGroundingRetryableFailureSchema,
    waitForUser: false,
  },
  [REPOSITORY_GROUNDING_ACTIONS.TERMINAL_FAILURE]: {
    schema: repositoryGroundingTerminalFailureSchema,
    waitForUser: false,
  },
};

export type RepositoryGroundingCompletion = ApiRepositoryGroundingCompletion;

export class RepositoryGroundingInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RepositoryGroundingInputError';
  }
}

export function parseRepositoryGroundingIntentAnswer(
  value: unknown,
): RepositoryGroundingIntentAnswer {
  try {
    // The select presentation submits its option value directly (`yes` or
    // `no`); retain the typed object form for callers that already wrap it.
    const answer = repositoryGroundingIntentAnswerSchema.parse(
      typeof value === 'string' ? { choice: value } : value,
    );
    const choice = normalizeChoice(
      answer.choice,
      REPOSITORY_GROUNDING_INTENT_OPTIONS,
    );
    return { choice };
  } catch (error) {
    if (error instanceof RepositoryGroundingInputError) throw error;
    throw new RepositoryGroundingInputError(
      error instanceof Error
        ? error.message
        : 'A valid repository grounding choice is required',
    );
  }
}

export function parseProjectExistingWorkIntent(
  value: unknown,
): ProjectExistingWorkIntent {
  const answer = parseRepositoryGroundingIntentAnswer(value);
  return answer.choice === 'yes'
    ? ProjectExistingWorkIntent.Selected
    : ProjectExistingWorkIntent.Declined;
}

export function parseRepositoryGroundingScopeAnswer(
  value: unknown,
  focus: unknown,
): RepositoryGroundingScope {
  const scope = normalizeChoice(value, [
    { value: 'comprehensive', label: 'Comprehensive repository analysis' },
    { value: 'focused', label: 'Focused repository analysis' },
  ] as const);

  if (scope === 'focused') {
    if (typeof focus !== 'string' || focus.trim().length === 0) {
      throw new RepositoryGroundingInputError(
        'A focus is required for focused repository analysis',
      );
    }
    return repositoryGroundingFocusedScopeSchema.parse({
      scope,
      focus: focus.trim(),
    });
  }

  if (focus !== undefined && focus !== null && focus !== '') {
    throw new RepositoryGroundingInputError(
      'A comprehensive repository analysis cannot carry a focused scope',
    );
  }

  return repositoryGroundingComprehensiveScopeSchema.parse({ scope });
}

export function parseRepositoryGroundingPrerequisitesAnswer(
  answers: Record<string, unknown>,
  entryMode: RepositoryGroundingEntryMode,
): RepositoryGroundingPrerequisites {
  return {
    entryMode,
    serviceId: requireText(
      answers[REPOSITORY_GROUNDING_FIELDS.service],
      'A Service is required for repository analysis',
    ),
    confirmedServiceBrief: requireText(
      answers[REPOSITORY_GROUNDING_FIELDS.brief],
      'A confirmed Service brief is required for repository analysis',
    ),
    machineId: requireText(
      answers[REPOSITORY_GROUNDING_FIELDS.machine],
      'A paired machine is required for repository analysis',
    ),
  } satisfies RepositoryGroundingPrerequisites;
}

export function parseRepositoryGroundingConfigurationAnswer(
  answers: Record<string, unknown>,
): {
  scope: RepositoryGroundingScope;
  provider: string;
} {
  return {
    scope: parseRepositoryGroundingScopeAnswer(
      answers[REPOSITORY_GROUNDING_FIELDS.scope],
      answers[REPOSITORY_GROUNDING_FIELDS.focus],
    ),
    provider: requireText(
      answers[REPOSITORY_GROUNDING_FIELDS.provider],
      'A supported repository analysis provider is required',
    ),
  };
}

export function parseRepositoryGroundingStartAnswer(
  value: unknown,
): (typeof REPOSITORY_GROUNDING_START_ACTIONS)[keyof typeof REPOSITORY_GROUNDING_START_ACTIONS] {
  return normalizeChoice(value, [
    {
      value: REPOSITORY_GROUNDING_START_ACTIONS.START,
      label: 'Start analysis',
    },
    {
      value: REPOSITORY_GROUNDING_START_ACTIONS.FINISH_LATER,
      label: 'Finish later',
    },
  ] as const) as (typeof REPOSITORY_GROUNDING_START_ACTIONS)[keyof typeof REPOSITORY_GROUNDING_START_ACTIONS];
}

export function parseRepositoryGroundingRecoveryAnswer(
  value: unknown,
): (typeof REPOSITORY_GROUNDING_RECOVERY_ACTIONS)[keyof typeof REPOSITORY_GROUNDING_RECOVERY_ACTIONS] {
  return normalizeChoice(value, [
    {
      value: REPOSITORY_GROUNDING_RECOVERY_ACTIONS.RETRY,
      label: 'Retry analysis',
    },
    {
      value: REPOSITORY_GROUNDING_RECOVERY_ACTIONS.EDIT_PREREQUISITES,
      label: 'Edit Service or machine',
    },
    {
      value: REPOSITORY_GROUNDING_RECOVERY_ACTIONS.EDIT_CONFIGURATION,
      label: 'Edit scope or provider',
    },
    {
      value: REPOSITORY_GROUNDING_RECOVERY_ACTIONS.CONTINUE_WITHOUT_ANALYSIS,
      label: 'Continue without analysis',
    },
  ] as const) as (typeof REPOSITORY_GROUNDING_RECOVERY_ACTIONS)[keyof typeof REPOSITORY_GROUNDING_RECOVERY_ACTIONS];
}

export function parseRepositoryGroundingCompletion(
  action: string,
  payload: unknown,
): RepositoryGroundingCompletion | undefined {
  const actionSchema = repositoryGroundingActions[action]?.schema;
  if (!actionSchema) return undefined;
  const parsed = repositoryGroundingCompletionSchema.safeParse(payload);
  if (!parsed.success) return undefined;

  const actionOutcome = {
    [REPOSITORY_GROUNDING_ACTIONS.SUCCESS]: 'success',
    [REPOSITORY_GROUNDING_ACTIONS.RETRYABLE_FAILURE]: 'retryable_failure',
    [REPOSITORY_GROUNDING_ACTIONS.TERMINAL_FAILURE]: 'terminal_failure',
  }[action];
  if (parsed.data.outcome !== actionOutcome) return undefined;

  return parsed.data;
}

export function parseRepositoryGroundingWorkflowContext(
  value: unknown,
): RepositoryGroundingWorkflowContext {
  return repositoryGroundingWorkflowContextSchema.parse(value);
}

export function parseRepositoryGroundingConversationContext(
  value: unknown,
): RepositoryGroundingConversationSeed | RepositoryGroundingWorkflowContext {
  const workflowContext =
    repositoryGroundingWorkflowContextSchema.safeParse(value);
  if (workflowContext.success) return workflowContext.data;

  const seed = repositoryGroundingConversationSeedSchema.safeParse(value);
  if (seed.success) return seed.data;

  throw new RepositoryGroundingInputError(
    'Repository grounding context must be a valid seed or complete workflow context',
  );
}

/**
 * Normalize the workflow-only context envelope before it is merged into a
 * saved flow context. The generated onboarding conversation context is the
 * only public field; the intent marker and test provider identity remain
 * workflow ingress metadata and are never copied into that DTO.
 */
export function normalizeRepositoryGroundingAdditionalContext(
  additionalContext?: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!additionalContext) return undefined;

  const normalized = { ...additionalContext };
  if ('repositoryGrounding' in additionalContext) {
    const repositoryGrounding = parseRepositoryGroundingConversationContext(
      additionalContext.repositoryGrounding,
    );
    delete normalized.repositoryGrounding;
    if ('prerequisites' in repositoryGrounding) {
      normalized.repositoryGrounding = repositoryGrounding;
    } else {
      normalized.repositoryGroundingSeed = repositoryGrounding;
    }
  }
  if (
    'repositoryGroundingIntentRequired' in additionalContext &&
    typeof additionalContext.repositoryGroundingIntentRequired !== 'boolean'
  ) {
    throw new RepositoryGroundingInputError(
      'repositoryGroundingIntentRequired must be boolean when supplied',
    );
  }
  return normalized;
}

export function buildOnboardingConversationContext(
  additionalContext?: Record<string, unknown>,
): CreateRepositoryImportConversationContext {
  if (!additionalContext || !('repositoryGrounding' in additionalContext)) {
    throw new RepositoryGroundingInputError(
      'repositoryGrounding is required for repository import creation',
    );
  }

  return {
    repositoryGrounding: parseRepositoryGroundingConversationContext(
      additionalContext.repositoryGrounding,
    ),
  };
}

export function mergeRepositoryGroundingAdditionalContext<T extends object>(
  context: T,
  additionalContext?: Record<string, unknown>,
): T {
  const normalized =
    normalizeRepositoryGroundingAdditionalContext(additionalContext);
  if (normalized) {
    Object.assign(context, normalized);
  }
  return context;
}

export function getRepositoryGroundingAnswers(
  message: FlowUserMessage,
): Record<string, unknown> {
  const data = message.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new RepositoryGroundingInputError(
      'Repository grounding answers must be an object',
    );
  }
  return data as Record<string, unknown>;
}

export function hasRepositoryGroundingTypedAnswers(
  answers: Record<string, unknown>,
): boolean {
  return Object.values(REPOSITORY_GROUNDING_TYPED_FIELDS).some(
    (field) => field in answers,
  );
}

export function parseRepositoryGroundingFormSubmission(
  answers: Record<string, unknown>,
): RepositoryGroundingFormSubmission {
  const prerequisites = repositoryGroundingPrerequisitesSchema.parse(
    answers[REPOSITORY_GROUNDING_TYPED_FIELDS.prerequisites],
  );
  const analysisConfiguration =
    repositoryGroundingAnalysisConfigurationSchema.parse(
      answers[REPOSITORY_GROUNDING_TYPED_FIELDS.analysisConfiguration],
    );
  const action = repositoryGroundingActionSchema.parse(
    answers[REPOSITORY_GROUNDING_TYPED_FIELDS.action],
  );

  return { prerequisites, analysisConfiguration, action };
}

/**
 * Cross-field validation that cannot be expressed by the generic UI form
 * validator. It runs before the answer message is persisted, so an invalid
 * combination cannot partially advance the workflow.
 */
export function validateRepositoryGroundingFormAnswers(
  nodeId: string,
  answers: Record<string, unknown>,
): void {
  try {
    switch (nodeId) {
      case ONBOARDING_NODES.REPOSITORY_GROUNDING_INTENT:
        parseRepositoryGroundingIntentAnswer(
          answers[REPOSITORY_GROUNDING_FIELDS.intent],
        );
        return;
      case REPOSITORY_IMPORT_NODES.PREREQUISITES:
        if (hasRepositoryGroundingTypedAnswers(answers)) {
          parseRepositoryGroundingFormSubmission(answers);
          return;
        }
        parseRepositoryGroundingPrerequisitesAnswer(
          answers,
          RepositoryGroundingEntryMode.NewProject,
        );
        return;
      case REPOSITORY_IMPORT_NODES.CONFIGURATION:
        parseRepositoryGroundingConfigurationAnswer(answers);
        return;
      case REPOSITORY_IMPORT_NODES.START:
        parseRepositoryGroundingStartAnswer(
          answers[REPOSITORY_GROUNDING_FIELDS.start],
        );
        return;
      case REPOSITORY_IMPORT_NODES.RECOVERY:
        if (hasRepositoryGroundingTypedAnswers(answers)) {
          parseRepositoryGroundingFormSubmission(answers);
          return;
        }
        parseRepositoryGroundingRecoveryAnswer(
          answers[REPOSITORY_GROUNDING_FIELDS.recovery],
        );
        return;
      default:
        return;
    }
  } catch (error) {
    if (error instanceof RepositoryGroundingInputError) throw error;
    throw new RepositoryGroundingInputError(
      error instanceof Error
        ? error.message
        : 'Invalid repository grounding answers',
    );
  }
}

function normalizeChoice<
  const T extends readonly { value: string; label: string }[],
>(value: unknown, choices: T): T[number]['value'] {
  if (typeof value !== 'string') {
    throw new RepositoryGroundingInputError(
      'A valid repository grounding choice is required',
    );
  }
  const choice = choices.find(
    (candidate) => candidate.value === value || candidate.label === value,
  );
  if (!choice) {
    throw new RepositoryGroundingInputError(
      `Repository grounding choice '${value}' is not available`,
    );
  }
  return choice.value;
}

function requireText(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RepositoryGroundingInputError(message);
  }
  return value.trim();
}
