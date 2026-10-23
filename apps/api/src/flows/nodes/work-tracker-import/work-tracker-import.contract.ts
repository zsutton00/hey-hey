import { z } from 'zod';
import {
  WorkTrackerImportAction,
  WorkTrackerImportConfiguration,
  type WorkTrackerConnectionCompletion,
  type WorkTrackerImportRequest,
  type WorkTrackerImportSuccess,
} from '../../../generated';
import type { ExternalAgentActionSchemas } from '../../../types/flow-internal.types';
import type { WorkTrackerImportFlowContext } from '../../../types/flow-internal.types';
import { type FeatureGenerationResponse } from '../../utils/shared-schemas';
import { repositoryGroundingHierarchySchema } from '../onboarding/repository-grounding.contract';

export const WORK_TRACKER_FIELDS = {
  source: 'work_tracker_source',
  machineId: 'work_tracker_machine_id',
  provider: 'work_tracker_provider',
  model: 'work_tracker_model',
  reasoningEffort: 'work_tracker_reasoning_effort',
  action: 'work_tracker_action',
} as const;

/** Completion actions emitted by the CLI work-tracker handlers. */
export const WORK_TRACKER_ACTIONS = {
  CONNECTED: 'connected',
  CONNECTION_REQUIRED: 'connection_required',
  SUCCESS: 'success',
} as const;

export class WorkTrackerImportInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkTrackerImportInputError';
  }
}

const sourceSchema = z.enum(['jira', 'linear']);

export const workTrackerConfigurationSchema: z.ZodType<WorkTrackerImportConfiguration> =
  z
    .object({
      source: sourceSchema,
      machineId: z.string().uuid(),
      provider: z.nativeEnum(WorkTrackerImportConfiguration.ProviderEnum),
      resolvedFrontierModel: z.string().trim().min(1),
      reasoningEffort: z.nativeEnum(
        WorkTrackerImportConfiguration.ReasoningEffortEnum,
      ),
      fastMode: z.boolean().optional(),
    })
    .strict();

export const workTrackerActionSchema = z.nativeEnum(WorkTrackerImportAction);

const connectionCompletionSchema: z.ZodType<WorkTrackerConnectionCompletion> = z
  .object({
    outcome: z.enum(['connected', 'connection_required']),
    source: sourceSchema,
  })
  .strict();

export const workTrackerImportSuccessSchema: z.ZodType<WorkTrackerImportSuccess> =
  z
    .object({
      outcome: z.literal('success'),
      source: sourceSchema,
      narrative: z.string().min(1),
      hierarchy: repositoryGroundingHierarchySchema,
      evidence: z
        .array(
          z
            .object({
              reference: z.string().min(1),
              summary: z.string().min(1),
            })
            .strict(),
        )
        .min(1),
    })
    .strict();

export const workTrackerConnectActions: ExternalAgentActionSchemas = {
  [WORK_TRACKER_ACTIONS.CONNECTED]: {
    schema: connectionCompletionSchema,
    waitForUser: false,
  },
  [WORK_TRACKER_ACTIONS.CONNECTION_REQUIRED]: {
    schema: connectionCompletionSchema,
    waitForUser: false,
  },
};

export const workTrackerImportActions: ExternalAgentActionSchemas = {
  [WORK_TRACKER_ACTIONS.SUCCESS]: {
    schema: workTrackerImportSuccessSchema,
    waitForUser: false,
  },
  [WORK_TRACKER_ACTIONS.CONNECTION_REQUIRED]: {
    schema: connectionCompletionSchema,
    waitForUser: false,
  },
};

export function getWorkTrackerAnswers(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new WorkTrackerImportInputError(
      'Work-tracker import answers must be an object',
    );
  }
  return data as Record<string, unknown>;
}

export function parseWorkTrackerConfigurationAnswers(
  answers: Record<string, unknown>,
): WorkTrackerImportConfiguration {
  const parsed = workTrackerConfigurationSchema.safeParse({
    source: answers[WORK_TRACKER_FIELDS.source],
    machineId: answers[WORK_TRACKER_FIELDS.machineId],
    provider: answers[WORK_TRACKER_FIELDS.provider],
    resolvedFrontierModel: answers[WORK_TRACKER_FIELDS.model],
    reasoningEffort: answers[WORK_TRACKER_FIELDS.reasoningEffort],
  });
  if (!parsed.success) {
    throw new WorkTrackerImportInputError(
      `Work-tracker import choices are invalid: ${parsed.error.issues
        .map((issue) => issue.path.join('.') || issue.message)
        .join(', ')}`,
    );
  }
  return parsed.data;
}

export function parseWorkTrackerAction(
  answers: Record<string, unknown>,
): WorkTrackerImportAction {
  const parsed = workTrackerActionSchema.safeParse(
    answers[WORK_TRACKER_FIELDS.action],
  );
  if (!parsed.success) {
    throw new WorkTrackerImportInputError(
      'A valid work-tracker import action is required',
    );
  }
  return parsed.data;
}

export function buildWorkTrackerRequest(
  context: Readonly<WorkTrackerImportFlowContext>,
  promptType: 'work_tracker_connect' | 'work_tracker_import',
  workflowNodeId: string,
): WorkTrackerImportRequest {
  const configuration = context.workTrackerImportConfiguration;
  if (!configuration) {
    throw new Error(
      'Work-tracker import requires accepted source and runtime choices',
    );
  }
  return {
    promptType,
    projectId: context.core.projectId,
    conversationId: context.core.conversationId,
    workflowId: context.core.workflowId,
    workflowNodeId,
    machineId: configuration.machineId,
    source: configuration.source,
    provider: configuration.provider,
    resolvedFrontierModel: configuration.resolvedFrontierModel,
    reasoningEffort: configuration.reasoningEffort,
    ...(configuration.fastMode === undefined
      ? {}
      : { fastMode: configuration.fastMode }),
    ...(context.workTrackerConnectionConfirmed
      ? { connectionConfirmed: true }
      : {}),
  } satisfies WorkTrackerImportRequest;
}

export function sourceLabel(
  source: WorkTrackerImportSuccess['source'],
): string {
  return source === 'jira' ? 'Jira' : 'Linear';
}

/**
 * Pure projection of the accepted work-tracker outline into the shared
 * Feature-generation review input; it never creates proposals itself.
 */
export function mapWorkTrackerSuccessToFeatureGeneration(
  completion: WorkTrackerImportSuccess,
): FeatureGenerationResponse {
  return {
    type: 'FEATURES',
    response: `Based on your ${sourceLabel(completion.source)} work, here is a feature proposal for review.`,
    detectedIntent: 'feature_generation_complete',
    intentConfidence: 1,
    narrative: completion.narrative,
    topLevels: completion.hierarchy.topLevels.map((topLevel) => ({
      candidateId: topLevel.id,
      name: topLevel.name,
      description: topLevel.description,
      tag: topLevel.tag,
      priority: 'medium',
      reasoning: topLevel.description,
      influences: [],
      children: topLevel.children.map((child) => ({
        candidateId: child.id,
        name: child.name,
        description: child.description,
        tag: child.tag,
        priority: 'medium',
        reasoning: child.description,
        influences: [],
      })),
    })),
  } satisfies FeatureGenerationResponse;
}

const entrySchema = z
  .object({
    entryMode: z.enum(['new_project', 'existing_project']),
    source: sourceSchema.optional(),
  })
  .strict();

/** Carries validated conversation-creation context into flow state. */
export function mergeWorkTrackerImportAdditionalContext<T extends object>(
  context: T,
  additionalContext?: Record<string, unknown>,
): T {
  const parsed = entrySchema.safeParse(
    additionalContext?.workTrackerImportEntry ?? additionalContext,
  );
  if (parsed.success) {
    Object.assign(context, { workTrackerImportEntry: parsed.data });
  }
  return context;
}
