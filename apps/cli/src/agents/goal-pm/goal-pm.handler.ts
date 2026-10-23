import { z } from 'zod';
import {
  EntityType,
  LocalPromptType,
  WorkflowName,
  type LocalGoalPmConversationInventoryItem,
  type LocalGoalPmGoal,
  type LocalGoalPmPromptPayload,
} from '../../shared/agent-bridge-contract/generated';
import type { AgenticSession } from '../../session/types';
import type { AssistantCompleteEvent } from '../../run/types';
import {
  type CompletionValidationFailure,
  type CompletionValidationResult,
  defaultAddUserMessage,
  type OnCompleteDeps,
  type OnInvalidCompletionContext,
  type PrepareResult,
  type PromptTypeHandlerContext,
  type PromptTypeHandlerDeps,
  type UserLaunchablePromptTypeHandler,
} from '../prompt-type-handler';
import { buildGoalPmPrompt } from '../prompts/goal-pm';
import { parseGoalPmRoutingResponseFromText } from '../response-parser';

const GOAL_PM_SESSION_SCOPE_KEY = 'goalPm.scope';
const GOAL_PM_SESSION_CONVERSATION_INVENTORY_KEY = 'goalPm.conversationInventory';

const goalPmSessionScopeSchema = z.object({
  entityId: z.string().min(1),
  taskType: z.literal('GOAL'),
  title: z.string().min(1).optional(),
  description: z.string().min(1).optional(),
  acceptanceCriteria: z.string().min(1).optional(),
  dueDate: z.string().min(1).optional(),
});

type GoalPmSessionScope = z.infer<typeof goalPmSessionScopeSchema>;

const goalPmConversationInventoryItemSchema = z
  .object({
    conversationId: z.string().uuid(),
    title: z
      .string()
      .min(1)
      .refine((title) => title.trim().length > 0),
    owner: z
      .object({
        entityType: z.literal('TASK'),
        entityId: z.string().uuid(),
        taskType: z.literal('GOAL'),
      })
      .strict(),
    workflowName: z.nativeEnum(WorkflowName),
  })
  .strict();

const parseGoalPmConversationInventory = (
  inventory: unknown,
): LocalGoalPmConversationInventoryItem[] | null => {
  if (!Array.isArray(inventory)) return null;
  return inventory.flatMap((item) => {
    const parsed = goalPmConversationInventoryItemSchema.safeParse(item);
    return parsed.success ? [parsed.data] : [];
  });
};

const goalPmTaskContextResponseSchema = z.object({
  data: z.object({
    id: z.string().min(1),
    name: z.string().min(1),
    type: z.string().min(1),
    sections: z
      .array(
        z.object({
          key: z.string(),
          materializedMarkdown: z.string(),
        }),
      )
      .optional(),
    dueDate: z.string().nullable().optional(),
    status: z.string().min(1).optional(),
    archivedAt: z.string().nullable().optional(),
    trackedEntities: z
      .array(
        z.object({
          targetEntityId: z.string(),
          targetEntityType: z.nativeEnum(EntityType),
          title: z.string(),
        }),
      )
      .optional(),
  }),
});

const goalPmCompletionPayloadSchema = z.object({
  entity: z.object({ entityId: z.string().uuid() }),
  conversationInventory: z.unknown(),
});

const readGoalPmSessionScope = (session: AgenticSession): GoalPmSessionScope | null => {
  const parsed = goalPmSessionScopeSchema.safeParse(
    session.sessionContext?.[GOAL_PM_SESSION_SCOPE_KEY],
  );
  return parsed.success ? parsed.data : null;
};

const readGoalPmSessionConversationInventory = (
  session: AgenticSession,
): LocalGoalPmConversationInventoryItem[] | null => {
  return parseGoalPmConversationInventory(
    session.sessionContext?.[GOAL_PM_SESSION_CONVERSATION_INVENTORY_KEY],
  );
};

const resolveGoalPmConversationInventory = (
  goalId: string,
  inventory: readonly LocalGoalPmConversationInventoryItem[],
): LocalGoalPmConversationInventoryItem[] => {
  const eligibleById = new Map<string, LocalGoalPmConversationInventoryItem>();
  const parsed = parseGoalPmConversationInventory(inventory) ?? [];

  for (const conversation of parsed) {
    if (
      conversation.owner.entityId === goalId &&
      conversation.workflowName !== WorkflowName.GoalPm
    ) {
      eligibleById.set(conversation.conversationId, conversation);
    }
  }
  return [...eligibleById.values()];
};

const toSessionScope = (goal: LocalGoalPmGoal): GoalPmSessionScope => ({
  entityId: goal.entityId,
  taskType: 'GOAL',
  ...(goal.title ? { title: goal.title } : {}),
  ...(goal.description ? { description: goal.description } : {}),
  ...(goal.acceptanceCriteria ? { acceptanceCriteria: goal.acceptanceCriteria } : {}),
  ...(goal.dueDate ? { dueDate: goal.dueDate } : {}),
});

const resolveCanonicalGoal = async (
  run: AgenticSession,
  entityId: string,
  promptDeps: PromptTypeHandlerDeps,
): Promise<LocalGoalPmGoal> => {
  const organizationId = run.contextMetadata?.organizationId;
  const projectId = run.contextMetadata?.projectId;
  if (!organizationId || !projectId) {
    promptDeps.logger.error('goal_pm.prepare.task_context_scope_missing', {
      runId: run.agentic_session_id,
      hasOrganizationId: Boolean(organizationId),
      hasProjectId: Boolean(projectId),
      entityId,
    });
    throw new Error(
      'goal_pm handler requires organizationId and projectId to resolve the canonical goal.',
    );
  }

  promptDeps.logger.debug('goal_pm.prepare.task_context_fetch_started', {
    runId: run.agentic_session_id,
    organizationId,
    projectId,
    entityId,
  });

  let accessToken: string;
  try {
    accessToken = await promptDeps.auth.getAccessToken();
  } catch (error) {
    promptDeps.logger.error('goal_pm.prepare.task_context_auth_failed', {
      runId: run.agentic_session_id,
      entityId,
      error,
    });
    throw new Error('goal_pm handler could not authenticate the canonical goal lookup.');
  }

  const url =
    `${promptDeps.apiBaseUrl}/organizations/${encodeURIComponent(organizationId)}` +
    `/projects/${encodeURIComponent(projectId)}` +
    `/work-items/${encodeURIComponent(entityId)}`;

  let response: Response;
  try {
    response = await promptDeps.fetchImpl(url, {
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (error) {
    promptDeps.logger.error('goal_pm.prepare.task_context_fetch_failed', {
      runId: run.agentic_session_id,
      entityId,
      error,
    });
    throw new Error('goal_pm handler could not fetch the canonical goal.');
  }

  if (!response.ok) {
    promptDeps.logger.error('goal_pm.prepare.task_context_http_error', {
      runId: run.agentic_session_id,
      entityId,
      status: response.status,
    });
    throw new Error(`goal_pm canonical goal lookup failed with status ${response.status}.`);
  }

  const parsed = goalPmTaskContextResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    promptDeps.logger.error('goal_pm.prepare.task_context_malformed', {
      runId: run.agentic_session_id,
      entityId,
      issues: parsed.error.issues,
    });
    throw new Error('goal_pm canonical goal lookup returned an invalid task.');
  }

  const context = parsed.data.data;
  if (context.id !== entityId) {
    promptDeps.logger.error('goal_pm.prepare.task_context_identity_conflict', {
      runId: run.agentic_session_id,
      runEntityId: entityId,
      contextEntityId: context.id,
      contextTaskType: context.type,
    });
    throw new Error('goal_pm canonical task context conflicts with the persisted Run entity.');
  }

  if (context.type !== 'GOAL') {
    promptDeps.logger.error('goal_pm.prepare.task_context_non_goal', {
      runId: run.agentic_session_id,
      entityId,
      taskType: context.type,
    });
    throw new Error('goal_pm handler requires the persisted TASK to be a canonical GOAL.');
  }

  if (context.status === 'ARCHIVED' || context.archivedAt) {
    promptDeps.logger.error('goal_pm.prepare.task_context_archived', {
      runId: run.agentic_session_id,
      entityId,
      status: context.status ?? null,
      hasArchivedAt: Boolean(context.archivedAt),
    });
    throw new Error('goal_pm handler cannot use an archived GOAL.');
  }

  const sections = new Map(
    (context.sections ?? []).map((section) => [section.key, section.materializedMarkdown]),
  );
  const description = sections.get('description');
  const acceptanceCriteria = sections.get('acceptanceCriteria');
  const goal: LocalGoalPmGoal = {
    entityType: 'TASK',
    entityId: context.id,
    taskType: 'GOAL',
    title: context.name,
    ...(description ? { description } : {}),
    ...(acceptanceCriteria ? { acceptanceCriteria } : {}),
    ...(context.dueDate ? { dueDate: context.dueDate } : {}),
    ...(context.trackedEntities ? { trackedEntities: context.trackedEntities } : {}),
  };

  promptDeps.logger.info('goal_pm.prepare.task_context_resolved', {
    runId: run.agentic_session_id,
    entityId: goal.entityId,
    taskType: goal.taskType,
    entityTitle: goal.title,
    dueDate: goal.dueDate ?? null,
  });
  return goal;
};

export class GoalPmHandler implements UserLaunchablePromptTypeHandler<LocalGoalPmPromptPayload> {
  public readonly id = 'goal_pm';
  public readonly promptType = LocalPromptType.GoalPm;
  public readonly service = 'optional';
  public readonly launchEntity = 'required_goal';
  public readonly implementationReadiness = 'none';
  public readonly graphResearchGuidance = true;
  public readonly epistemicCalibration = true;
  public readonly expectedResponseTypes = ['goal_pm_routing_v1'] as const;
  public readonly runnerKind = 'provider_session' as const;
  public readonly providerSessionCountsForContext = true;
  public readonly providerSessionLifetime = 'turn' as const;
  public readonly providerSessionStart = 'fresh' as const;
  public readonly rebuildPromptOnUserMessage = true;
  public readonly reports = [] as const;
  public readonly mcpToolUseCase = 'research' as const;
  public readonly builtinTools = [] as const;
  public readonly readOnlyFilesystem = true;
  public readonly omitServiceContextNote = true;
  public readonly addUserMessage = defaultAddUserMessage;

  public validateCompletion(
    event: AssistantCompleteEvent,
    payload?: unknown,
  ): CompletionValidationResult {
    const response = parseGoalPmRoutingResponseFromText(event.summary);
    if (!response.ok) {
      return { ok: false, error: { message: response.error } };
    }

    const goalPmPayload = goalPmCompletionPayloadSchema.safeParse(payload);
    const goalId = goalPmPayload.success ? goalPmPayload.data.entity.entityId : null;
    const conversationInventory = parseGoalPmConversationInventory(
      goalPmPayload.success ? goalPmPayload.data.conversationInventory : undefined,
    );
    if (!goalId || !conversationInventory) {
      return {
        ok: false as const,
        error: { message: 'Goal PM completion validation requires the prepared goal inventory.' },
      };
    }
    if (response.value.goalId !== goalId) {
      return {
        ok: false as const,
        error: { message: 'Goal PM routing response does not match the active canonical GOAL.' },
      };
    }

    const allowedConversations = new Map(
      conversationInventory.map((conversation) => [
        conversation.conversationId,
        conversation.title,
      ]),
    );
    const invalidConversation = response.value.options.find(
      (option) =>
        option.kind === 'existingConversation' &&
        allowedConversations.get(option.conversationId) !== option.title,
    );
    if (invalidConversation) {
      return {
        ok: false as const,
        error: {
          message:
            'Goal PM routing response referenced a conversation outside the active goal inventory.',
        },
      };
    }

    const refineSearchCount = response.value.options.filter(
      (option) => option.kind === 'refineSearch',
    ).length;
    if (conversationInventory.length === 0) {
      const isStartNewOnly =
        response.value.options.length === 1 &&
        response.value.options[0]?.kind === 'startNewConversation';
      return isStartNewOnly
        ? { ok: true as const }
        : {
            ok: false as const,
            error: {
              message:
                'Goal PM routing must return only startNewConversation when the goal conversation inventory is empty.',
            },
          };
    }

    return refineSearchCount === 1
      ? { ok: true as const }
      : {
          ok: false as const,
          error: {
            message:
              'Goal PM routing must return one refineSearch option when eligible conversations exist.',
          },
        };
  }

  public async onInvalidCompletion(
    _event: AssistantCompleteEvent,
    context: OnInvalidCompletionContext,
    deps: OnCompleteDeps,
    failure: CompletionValidationFailure,
  ): Promise<void> {
    deps.logger.warn('goal_pm.completion.rejected', {
      runId: context.runId,
      code: failure.code,
      message: failure.message,
    });
  }

  public async prepare(
    run: AgenticSession,
    payload: LocalGoalPmPromptPayload,
    promptDeps: PromptTypeHandlerDeps,
  ): Promise<PrepareResult<LocalGoalPmPromptPayload>> {
    const runEntity = run.entity;
    if (!runEntity) {
      promptDeps.logger.error('goal_pm.prepare.missing_run_entity', {
        runId: run.agentic_session_id,
      });
      throw new Error('goal_pm handler requires a persisted TASK Run entity.');
    }

    if (runEntity.entityType !== 'TASK') {
      promptDeps.logger.error('goal_pm.prepare.non_task_run_entity', {
        runId: run.agentic_session_id,
        entityType: runEntity.entityType,
        entityId: runEntity.entityId,
      });
      throw new Error('goal_pm handler requires a persisted TASK Run entity.');
    }

    const incomingGoal = payload.entity;
    const durableScope = readGoalPmSessionScope(run);
    if (incomingGoal) {
      if (incomingGoal.entityType !== 'TASK' || incomingGoal.taskType !== 'GOAL') {
        promptDeps.logger.error('goal_pm.prepare.invalid_goal_scope', {
          runId: run.agentic_session_id,
          entityType: incomingGoal.entityType,
          taskType: incomingGoal.taskType,
          entityId: incomingGoal.entityId,
        });
        throw new Error('goal_pm handler requires payload.entity to be a GOAL TASK.');
      }

      if (incomingGoal.entityId !== runEntity.entityId) {
        promptDeps.logger.error('goal_pm.prepare.payload_scope_conflict', {
          runId: run.agentic_session_id,
          runEntityId: runEntity.entityId,
          payloadEntityId: incomingGoal.entityId,
        });
        throw new Error('goal_pm payload scope conflicts with the persisted Run entity.');
      }

      if (durableScope && durableScope.entityId !== incomingGoal.entityId) {
        promptDeps.logger.error('goal_pm.prepare.durable_scope_conflict', {
          runId: run.agentic_session_id,
          durableEntityId: durableScope.entityId,
          payloadEntityId: incomingGoal.entityId,
        });
        throw new Error('goal_pm durable scope conflicts with the incoming goal scope.');
      }
    } else {
      if (!durableScope || durableScope.entityId !== runEntity.entityId) {
        promptDeps.logger.error('goal_pm.prepare.missing_durable_scope', {
          runId: run.agentic_session_id,
          runEntityId: runEntity.entityId,
          hasDurableScope: Boolean(durableScope),
        });
        throw new Error('goal_pm handler requires a durable GOAL scope for this turn.');
      }
    }

    const goal = await resolveCanonicalGoal(run, runEntity.entityId, promptDeps);
    const sessionScope = toSessionScope(goal);
    const incomingInventory = parseGoalPmConversationInventory(payload.conversationInventory);
    const durableInventory = readGoalPmSessionConversationInventory(run);
    if (!incomingInventory && !durableInventory) {
      promptDeps.logger.error('goal_pm.prepare.missing_conversation_inventory', {
        runId: run.agentic_session_id,
        entityId: goal.entityId,
      });
      throw new Error('goal_pm handler requires a canonical goal conversation inventory.');
    }
    const conversationInventory = resolveGoalPmConversationInventory(
      goal.entityId,
      incomingInventory ?? durableInventory ?? [],
    );
    promptDeps.logger.info('goal_pm.prepare.goal_scope_verified', {
      runId: run.agentic_session_id,
      entityId: goal.entityId,
      taskType: goal.taskType,
      usedIncomingEntity: Boolean(incomingGoal),
      eligibleConversationCount: conversationInventory.length,
    });

    return {
      payload: { ...payload, entity: goal, conversationInventory },
      sessionContext: {
        [GOAL_PM_SESSION_SCOPE_KEY]: sessionScope,
        [GOAL_PM_SESSION_CONVERSATION_INVENTORY_KEY]: conversationInventory,
      },
    };
  }

  public buildPrompt(
    payload: LocalGoalPmPromptPayload,
    _context?: PromptTypeHandlerContext,
  ): string {
    return buildGoalPmPrompt(payload);
  }

  public buildStartingMessage(payload: LocalGoalPmPromptPayload): string | null {
    return payload.entity.title
      ? `Finding the best place for your request about ${payload.entity.title}...`
      : 'Finding the best place for your goal request...';
  }
}
