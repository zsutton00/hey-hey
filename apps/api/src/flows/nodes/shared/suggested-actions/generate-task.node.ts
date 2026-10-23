import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { GenerateNodeBase } from '../../base/';
import type {
  Influence,
  SystemMessageData,
  TaskResponseDto,
  TasksSystemMessageData,
} from '../../../../generated';
import { TaskService } from '../../../../services/tasks/task.service';
import { TaskDraft } from '../../../../services/tasks/types';
import { z } from 'zod';
import {
  CompensationContext,
  CompensationResult,
  FlowContext,
  FlowUserMessage,
  IntermediateSystemMessageData,
  ProcessLlmResult,
  SuggestedActionsFlowContext,
} from '../../../../types/flow-internal.types';
import { DesignDocId, InitiativeId, TaskId } from '../../../../types';
import { SHARED_NODES } from '../../../constants/node-ids';
import { taskGenerationResponseSchema } from '../../../utils/shared-schemas';
import { ClaudeModel, LLMProviderName } from 'src/services/llm/llm-shared';
import { buildTaskGenerationContextSection } from '../../task-generation/utils/prompt-context.util';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';
import {
  MutableContext,
  MutableContextHandle,
} from 'src/utils/mutable-context';

/**
 * Task item shape from taskGenerationResponseSchema
 * Includes fields beyond the OpenAPI GeneratedTask type
 */
type LLMTaskResponse = z.infer<
  typeof taskGenerationResponseSchema
>['tasks'][number];

// Helper function to create properly typed task generation data
function createTaskGenerationActionData(data: {
  tasks: TaskResponseDto[];
  response: string;
}) {
  return {
    type: 'TASKS',
    response: data.response,
    detectedIntent: 'task_generation_complete',
    intentConfidence: 1.0,
    generatedTaskIds: data.tasks.map((t) => t.id),
    tasks: data.tasks,
    uiElements: [
      {
        id: 'task-list',
        type: 'task_list',
        label: 'Generated Tasks',
        required: true,
      },
    ],
    actions: [
      {
        type: 'task_management',
        payload: {
          payloadType: 'task_management',
          taskCount: data.tasks.length,
          categories: [] as string[],
        },
      },
    ],
  };
}

@Injectable()
export class SharedSuggestedActionsGenerateTaskNode extends GenerateNodeBase<SuggestedActionsFlowContext> {
  private readonly logger = new Logger(
    SharedSuggestedActionsGenerateTaskNode.name,
  );
  readonly id = SHARED_NODES.SUGGESTED_ACTIONS_GENERATE_TASK;
  readonly title = 'Generating Tasks';

  constructor(
    private taskService: TaskService,
    private readonly designDocService: DesignDocService,
  ) {
    super();
  }

  readonly promptConfig = {
    modelCriteria: {
      model: ClaudeModel.CLAUDE_4_HAIKU_5,
      provider: LLMProviderName.CLAUDE,
    },
    maxTokens: 25000,
    timeout: 240000,

    systemPromptTemplate: (context: SuggestedActionsFlowContext) => {
      const sections: string[] = [];

      sections.push(
        'You are a task generation assistant that creates actionable, well-structured tasks that directly support and advance the primary entity referenced by workflowAboutType and workflowAboutId.',
      );

      sections.push(
        buildTaskGenerationContextSection(context, {
          includeInitiativeArtifacts: true,
          includeStubs: false,
        }),
      );

      sections.push(`SUGGESTED ACTION PRIORITY (CRITICAL):
This run is triggered by a suggested action and may not include a new user message. Use the primary entity context and conversation history as the signal sources:
- Treat prior user requests in the conversation history as the source of truth for quantity, scope, or focus
- If the user said ONE task, create exactly one task
- If the user said "a few tasks", create 2-4 tasks
- If the user focused on a SPECIFIC SUBJECT (e.g., "tasks for authentication"), focus exclusively on that subject
- If priorities, effort levels, technologies, or approaches were mentioned, honor those preferences
- If signals are weak or absent, default to generating 1 task aligned to the primary entity scope

Your primary goal is to generate complete, production-ready tasks based on the entity context and conversation history.`);

      sections.push(`Entity Alignment Guidelines:
- Each task must directly contribute to achieving the primary entity's goals and objectives
- Use the primary entity's title, description, and context to inform task creation
- Ensure tasks collectively provide a clear path toward the primary entity's outcome
- Consider how each task moves the primary entity forward from its current state
- Initiative context (if present) should be treated as supporting context only`);

      sections.push(`Task Structure Guidelines:
- FIRST, check the conversation history for specific signals about quantity, scope, or focus
- Create tasks that are specific and actionable
- Task titles must use minimal, generic wording; do NOT include proper names, project names, or org names unless the user explicitly used them
- Default to 1 task ONLY if the conversation history doesn't specify otherwise
- Categorize tasks appropriately (development, planning, testing, deployment, etc.)
- Make descriptions clear and specific, explaining how each task supports the initiative
- Consider dependencies and logical ordering that makes sense for the initiative's workflow`);

      sections.push(`RESPONSE FORMAT: Return an object with these fields:
- tasks: Array of tasks. Each task must include:
  - taskType: STANDARD or BUG
  - title: A clear, concise title for the task
  - description: High-level explanation of what needs to be done
  - acceptanceCriteria: Required for STANDARD tasks; omitted for BUG tasks
  - influences: Optional array of references to prior entities informing the task
- response: Brief acknowledgement to the user about the generated tasks and next steps`);

      sections.push(`ARTIFACT REFERENCING:
When generating tasks, you SHOULD include an "influences" array for each task that references specific entities from the initiative or conversation history that influenced or informed that task. For each influence, use the entityId and entityType from the evidence item you are referencing — both values come from the same source entity. Include:
- entityId: The UUID of the entity that influenced your choice
- entityType: The type of that same entity (as provided in the evidence)
- reasoning: Explanation of how this entity influenced the task
- reasonType: Type of influence (e.g., "previous_conversation", "related_initiative", "depends_on", "similar_to", "blocks", "references")

Example influences structure:
"influences": [
  {
    "entityId": "example-artifact-id",
    "entityType": "ARTIFACT",
    "reasoning": "Initiative generation context informed this task priority",
    "reasonType": "previous_conversation"
  }
]`);

      sections.push(`EXAMPLE JSON STRUCTURE:
{
  "tasks": [
    {
      "taskType": "STANDARD",
      "title": "Implement User Authentication System",
      "description": "Build a secure user authentication system with JWT tokens",
      "acceptanceCriteria": "- Users can register with email/password\\n- Users can log in and receive JWT token\\n- Token refresh mechanism works correctly\\n- Password reset flow implemented\\n- All endpoints properly secured",
      "influences": [
        {
          "entityId": "example-message-id",
          "entityType": "MESSAGE",
          "reasoning": "User requirements specified need for secure authentication",
          "reasonType": "previous_conversation"
        }
      ]
    }
  ],
  "response": "I've created tasks that will help implement the authentication system for your initiative."
}

Before finalizing tasks, verify that each one has a clear answer to: "How does this task help achieve the initiative's objectives?"`);

      return sections.join('\n\n');
    },
    responseSchema: taskGenerationResponseSchema,
    temperature: 0.7,
  };

  async beforeGeneration(
    tracker: MutableContextHandle<SuggestedActionsFlowContext>,
    previousUserMessage?: FlowUserMessage,
  ): Promise<void> {
    const suggestedAction =
      this.getSuggestedActionUserMessage(previousUserMessage);
    const resolved = await this.resolveTaskGenerationContext(
      tracker.getContext(),
      suggestedAction,
    );

    tracker.mutate((draft) => {
      draft.initiativeId = resolved.initiativeId;
      draft.parentTaskId = resolved.parentTaskId;
      draft.designDocId = resolved.designDocId;
    });
  }

  /**
   * Convert LLM task response to TaskDraft format
   */
  private convertLLMTasksToDrafts(llmTasks: LLMTaskResponse[]): TaskDraft[] {
    return llmTasks.map((task) => ({
      id: uuidv4(),
      title: task.title,
      description: task.description,
      taskType: task.taskType,
      acceptanceCriteria: task.acceptanceCriteria,
      priority: 'medium',
      influences: this.normalizeInfluences(task.influences),
    }));
  }

  private normalizeInfluences(
    influences: LLMTaskResponse['influences'],
  ): Influence[] {
    if (!influences) {
      return [];
    }

    return influences
      .filter(
        (influence): influence is NonNullable<typeof influences>[number] =>
          Boolean(influence?.entityId),
      )
      .map((influence) => ({
        entityId: influence.entityId,
        entityType: influence.entityType,
        reasoning: influence.reasoning ?? '',
        reasonType: influence.reasonType,
        confidence: influence.confidence ?? undefined,
      }));
  }

  private requireResponse(
    data: Pick<SystemMessageData, 'response'>,
    label: string,
  ): string {
    if (typeof data.response !== 'string') {
      throw new Error(`Missing required response for ${label}`);
    }
    return data.response;
  }

  private async resolveParentTaskFromDesignDoc(
    context: SuggestedActionsFlowContext,
  ): Promise<TaskId | undefined> {
    const designDocId = context.designDocId;
    if (!designDocId) {
      return undefined;
    }

    const links = await this.designDocService.getLinksForAdapter(
      designDocId as string,
      context.core.organizationId,
    );

    const taskLinks = links.filter((link) => link.entityType === 'task');
    if (taskLinks.length === 0) {
      return undefined;
    }

    const taskCache = new Map<string, TaskResponseDto | null>();
    const depthCache = new Map<string, number>();

    const fetchTask = async (taskId: string) => {
      if (taskCache.has(taskId)) {
        return taskCache.get(taskId) ?? null;
      }
      const task = await this.taskService.findOneForAdapter(
        taskId,
        context.core.organizationId,
      );
      taskCache.set(taskId, task);
      return task;
    };

    const computeDepth = async (
      taskId: string,
      visited: Set<string> = new Set(),
    ): Promise<number> => {
      const cachedDepth = depthCache.get(taskId);
      if (cachedDepth !== undefined) {
        return cachedDepth;
      }
      if (visited.has(taskId)) {
        return Number.POSITIVE_INFINITY;
      }
      visited.add(taskId);

      const task = await fetchTask(taskId);
      if (!task) {
        depthCache.set(taskId, Number.POSITIVE_INFINITY);
        return Number.POSITIVE_INFINITY;
      }

      if (!task.parentTaskId) {
        depthCache.set(taskId, 0);
        return 0;
      }

      const depth = (await computeDepth(task.parentTaskId, visited)) + 1;
      depthCache.set(taskId, depth);
      return depth;
    };

    let selected: { taskId: string; depth: number } | undefined;
    for (const link of taskLinks) {
      const depth = await computeDepth(link.entityId);
      if (!selected || depth < selected.depth) {
        selected = { taskId: link.entityId, depth };
      }
    }

    return selected?.taskId as TaskId | undefined;
  }

  private async resolveTaskGenerationContext(
    context: SuggestedActionsFlowContext,
    suggestedAction?: {
      initiativeId?: InitiativeId;
      parentTaskId?: TaskId;
    },
  ): Promise<{
    initiativeId?: InitiativeId;
    parentTaskId?: TaskId;
    designDocId?: DesignDocId;
  }> {
    const { workflowAboutId, workflowAboutType, organizationId } = context.core;

    if (!workflowAboutId) {
      throw new Error(
        'Suggested action task generation requires workflowAboutId',
      );
    }

    let initiativeId: InitiativeId | undefined =
      suggestedAction?.initiativeId ?? context.initiativeId;
    let parentTaskId: TaskId | undefined =
      suggestedAction?.parentTaskId ?? context.parentTaskId;
    let designDocId: DesignDocId | undefined = context.designDocId;

    if (workflowAboutType === 'design-doc') {
      designDocId = designDocId ?? (workflowAboutId as DesignDocId);
    }

    if (workflowAboutType === 'task') {
      parentTaskId = parentTaskId ?? (workflowAboutId as TaskId);
    }

    if (!initiativeId) {
      if (workflowAboutType === 'initiative') {
        initiativeId = workflowAboutId as InitiativeId;
      } else if (workflowAboutType === 'task' && parentTaskId) {
        const parentTask = await this.taskService.findOneForAdapter(
          parentTaskId,
          organizationId,
        );
        if (parentTask?.initiativeId) {
          initiativeId = parentTask.initiativeId as InitiativeId;
        }
      }
    }

    return { initiativeId, parentTaskId, designDocId };
  }

  async processLlmResponse(
    systemMessageData: IntermediateSystemMessageData,
    _userMessage: FlowUserMessage | undefined,
    tracker: MutableContext<SuggestedActionsFlowContext>,
  ): Promise<ProcessLlmResult> {
    const context = tracker.getContext();
    const typedData = systemMessageData as TasksSystemMessageData;
    const response = this.requireResponse(
      typedData,
      'suggested action task generation',
    );
    const { tasks, response: _response, ...remainingData } = typedData;

    let parentTaskId: TaskId | null = null;
    if (context.parentTaskId) {
      parentTaskId = context.parentTaskId;
    } else if (context.core.workflowAboutType === 'design-doc') {
      parentTaskId =
        (await this.resolveParentTaskFromDesignDoc(context)) ?? null;
    } else if (context.core.workflowAboutType === 'task') {
      parentTaskId = context.core.workflowAboutId as TaskId;
    }

    this.logger.log(
      '[processLlmResponse] Processing suggested action task generation',
      {
        taskCount: tasks.length,
        organizationId: context.core.organizationId,
        initiativeId: context.initiativeId,
        parentTaskId,
        'context.core': context.core,
      },
    );

    const taskDrafts = this.convertLLMTasksToDrafts(
      tasks as unknown as LLMTaskResponse[],
    ).map((draft) => ({
      ...draft,
      parentTaskId: parentTaskId ?? undefined,
    }));

    const realTasks = await this.taskService.createFromDrafts(
      taskDrafts,
      context.core.organizationId,
      context.initiativeId,
      context.core.conversationId,
      {
        projectId: context.core.projectId,
        generationModel: 'claude-haiku-4-5',
        generationPrompt: 'suggested-action-task-generation',
      },
    );

    if (context.designDocId) {
      await this.designDocService.createLinksForAdapter(
        context.designDocId as DesignDocId,
        realTasks.map((task) => ({
          entityType: 'task',
          entityId: task.id,
          relationType: 'TASK_CREATED_FROM_DOC',
        })),
        context.core.organizationId,
      );
    }

    this.logger.log('[processLlmResponse] Tasks created successfully', {
      taskCount: realTasks.length,
      taskIds: realTasks.map((t) => t.id),
    });

    const modifiedResult = {
      ...remainingData,
      ...createTaskGenerationActionData({
        tasks: realTasks,
        response,
      }),
    } as SystemMessageData;

    return { modifiedResult };
  }

  async compensate(
    _context: FlowContext,
    _error: Error,
    compensationContext: CompensationContext,
  ): Promise<CompensationResult> {
    const { errorClassification, attemptCount } = compensationContext;

    if (errorClassification.type === 'TIMEOUT' && attemptCount < 3) {
      const delay = 8000 + attemptCount * 2000;
      return {
        action: 'RETRY',
        retryDelayMs: delay,
        reason: `Generation timeout, retry ${attemptCount + 1}/3 with ${delay}ms delay`,
      };
    }

    if (errorClassification.type === 'RATE_LIMITED' && attemptCount < 3) {
      return {
        action: 'RETRY',
        retryDelayMs: 12000,
        reason: 'Generation rate limited, extended delay before retry',
      };
    }

    return { action: 'FAIL' };
  }

  private isSuggestedActionUserMessage(
    data: unknown,
  ): data is { type: string; nextAction: string } {
    return (
      !!data &&
      typeof data === 'object' &&
      (data as { type?: string }).type === 'SUGGESTED_ACTIONS' &&
      (data as { nextAction?: string }).nextAction === 'GENERATE_TASK'
    );
  }

  private getSuggestedActionUserMessage(userMessage?: FlowUserMessage):
    | {
        initiativeId?: InitiativeId;
        parentTaskId?: TaskId;
      }
    | undefined {
    const userMessageData = userMessage?.data;
    const data = (
      userMessageData ? Object.values(userMessageData)[0] : undefined
    ) as
      | {
          initiativeId?: InitiativeId;
          parentTaskId?: TaskId;
        }
      | undefined;
    if (!this.isSuggestedActionUserMessage(data)) {
      return undefined;
    }
    return data;
  }
}
