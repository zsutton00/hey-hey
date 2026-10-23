import { Injectable, Logger } from '@nestjs/common';
import { v4 as uuidv4 } from 'uuid';
import { GenerateNodeBase } from '../base/';
import type {
  Influence,
  SystemMessageData,
  TaskResponseDto,
  TasksSystemMessageData,
} from '../../../generated';
import { TaskService } from '../../../services/tasks/task.service';
import { TaskDraft } from '../../../services/tasks/types';
import { z } from 'zod';
import {
  CompensationContext,
  CompensationResult,
  FlowContext,
  FlowUserMessage,
  IntermediateSystemMessageData,
  ProcessLlmResult,
  TaskGenerationFlowContext,
} from '../../../types/flow-internal.types';
import { DesignDocId, TaskId } from '../../../types';
import { TASK_GENERATION_NODES } from '../../constants/node-ids';
import { taskGenerationResponseSchema } from '../../utils/shared-schemas';
import { ClaudeModel, LLMProviderName } from 'src/services/llm/llm-shared';
import {
  buildTaskGenerationContextSection,
  hasActiveStubSession,
} from './utils/prompt-context.util';
import { DesignDocService } from 'src/services/design-doc/design-doc.service';
import { MutableContext } from 'src/utils/mutable-context';

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
    generatedTaskIds: data.tasks.map((t) => t.id), // Array of created task IDs
    tasks: data.tasks, // Real task objects with database IDs
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
          // Categories not stored in DB, using empty array for now
          categories: [] as string[],
        },
      },
    ],
  };
}

/**
 * Task Generation Generate Node - Creates tasks for initiatives
 *
 * GENERATE node that:
 * - Uses LLM to generate actionable, well-structured tasks
 * - Aligns tasks with initiative objectives
 * - Persists tasks to database with artifacts
 * - Returns structured task data with real IDs
 * - Routes back to welcome node after completion
 */
@Injectable()
export class TaskGenerationGenerateNode extends GenerateNodeBase<TaskGenerationFlowContext> {
  private readonly logger = new Logger(TaskGenerationGenerateNode.name);
  readonly id = TASK_GENERATION_NODES.GENERATE;
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

    systemPromptTemplate: (context: TaskGenerationFlowContext) => {
      const sections: string[] = [];

      // Detect if we're in stub expansion mode
      const isStubExpansionMode = hasActiveStubSession(context);

      sections.push(
        'You are a task generation assistant that creates actionable, well-structured tasks that directly support and advance the given initiative.',
      );

      sections.push(
        buildTaskGenerationContextSection(context, {
          includeInitiativeArtifacts: true,
        }),
      );

      // Conditional guidance based on mode
      if (isStubExpansionMode) {
        sections.push(`STUB EXPANSION MODE:
Your primary goal is to expand the approved task stubs into complete, production-ready tasks.
- Treat ALL stubs in "Outstanding suggestions awaiting review" as requiring expansion
- Treat ALL stubs in "Approved or user supplied stubs" as requiring expansion
- Do NOT revisit or recreate rejected stubs
- Maintain 1:1 mapping: each stub becomes exactly one task
- Only generate additional tasks if the user explicitly requests more in the conversation history

If the user asks for specific modifications (different quantity, focus, etc.), apply those modifications to the stub expansion process.`);
      } else {
        sections.push(`TASK GENERATION MODE:
Generate new tasks that help achieve the initiative's objectives.

USER REQUEST PRIORITY (CRITICAL):
Pay close attention to the user's specific requests in the conversation history. Their requests override all defaults:
- If they ask for ONE task, create exactly one task
- If they ask for "a few tasks", create 2-4 tasks
- If they ask for tasks on a SPECIFIC SUBJECT (e.g., "tasks for authentication"), focus exclusively on that subject
- If they specify priorities or effort levels, honor those preferences
- If they mention specific technologies or approaches, incorporate those into the tasks
- The user's explicit requests take precedence over general initiative scope`);
      }

      sections.push(`Initiative Alignment Guidelines:
- Each task must directly contribute to achieving the initiative's goals and objectives
- Use the initiative's title, description, and context to inform task creation
- Ensure tasks collectively provide a clear path toward initiative completion
- Consider how each task moves the initiative forward from its current state`);

      if (!isStubExpansionMode) {
        sections.push(`Task Structure Guidelines:
- FIRST, check the conversation history for specific user requests about quantity, scope, or focus
- Create tasks that are specific and actionable
- Task titles must use minimal, generic wording; do NOT include proper names, project names, or org names unless the user explicitly used them
- Default to 3-8 tasks ONLY if the user hasn't specified otherwise
- Categorize tasks appropriately (development, planning, testing, deployment, etc.)
- Make descriptions clear and specific, explaining how each task supports the initiative
- Consider dependencies and logical ordering that makes sense for the initiative's workflow`);
      } else {
        sections.push(`Task Structure Guidelines:
- Expand each stub into a complete, actionable task
- Task titles must use minimal, generic wording; do NOT add proper names, project names, or org names beyond the stub title
- Make descriptions clear and specific, explaining how each task supports the initiative
- Choose taskType explicitly:
  - STANDARD for feature/delivery work (must include acceptanceCriteria)
  - BUG for defect-fix work (must omit acceptanceCriteria)
- For STANDARD tasks, create specific, measurable acceptance criteria
- Consider dependencies and logical ordering that makes sense for the initiative's workflow`);
      }

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

  /**
   * Convert LLM task response to TaskDraft format
   * Pattern: Similar to InitiativeService.convertLLMInitiativesToDrafts
   */
  private convertLLMTasksToDrafts(llmTasks: LLMTaskResponse[]): TaskDraft[] {
    return llmTasks.map((task) => ({
      id: uuidv4(), // Temporary ID, will be replaced by database
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
    context: TaskGenerationFlowContext,
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

  async processLlmResponse(
    systemMessageData: IntermediateSystemMessageData,
    _userMessage: FlowUserMessage | undefined,
    tracker: MutableContext<TaskGenerationFlowContext>,
  ): Promise<ProcessLlmResult> {
    const context = tracker.getContext();
    const typedData = systemMessageData as TasksSystemMessageData;
    const response = this.requireResponse(typedData, 'task generation');
    const { tasks, response: _response, ...remainingData } = typedData;

    // Step 1: Convert LLM tasks to drafts
    // Cast needed because OpenAPI GeneratedTask doesn't include all schema fields
    let parentTaskId: TaskId | null = null;
    if (context.core.workflowAboutType === 'design-doc') {
      parentTaskId =
        (await this.resolveParentTaskFromDesignDoc(context)) ?? null;
    } else if (context.core.workflowAboutType === 'task') {
      parentTaskId = context.core.workflowAboutId as TaskId;
    }

    this.logger.log(
      '[processLlmResponse] Processing LLM response for task generation',
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

    // Step 2: Create database tasks via TaskService
    const realTasks = await this.taskService.createFromDrafts(
      taskDrafts,
      context.core.organizationId,
      context.initiativeId ?? undefined,
      context.core.conversationId,
      {
        projectId: context.core.projectId,
        generationModel: 'claude-haiku-4-5',
        generationPrompt: 'task-generation',
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

    // Step 3: Create enhanced response with real task data
    const modifiedResult = {
      ...remainingData,
      ...createTaskGenerationActionData({
        tasks: realTasks, // Real database entities with IDs
        response,
      }),
    } as SystemMessageData;

    tracker.mutate((ctx) => {
      ctx.stubSession = undefined;
    });

    return { modifiedResult };
  }

  async compensate(
    _context: FlowContext,
    _error: Error,
    compensationContext: CompensationContext,
  ): Promise<CompensationResult> {
    const { errorClassification, attemptCount } = compensationContext;

    // Generation often needs more attempts due to complexity
    if (errorClassification.type === 'TIMEOUT' && attemptCount < 3) {
      const delay = 8000 + attemptCount * 2000; // Progressive delay
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

    // Generation failures fallback to conversation mode
    if (attemptCount >= 3) {
      return {
        action: 'SKIP_TO_NODE',
        nextNodeId: TASK_GENERATION_NODES.CONVERSATION,
        reason: 'Task generation failed, falling back to conversation mode',
      };
    }

    return { action: 'FAIL' };
  }
}
