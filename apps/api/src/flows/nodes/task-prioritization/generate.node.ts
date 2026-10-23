import { Injectable, Logger } from '@nestjs/common';
import { InitiativeService } from 'src/services/initiatives/initiative.service';
import { TaskService } from 'src/services/tasks/task.service';
import { materializedSectionsToContentMap } from 'src/utils/work-item-section.util';
import { TaskId } from 'src/types';
import { z } from 'zod';
import {
  SystemMessageData,
  TaskPrioritySystemMessageData,
  WorkflowName,
} from '../../../generated';
import {
  InitiativeTaskSnapshot,
  IntermediateSystemMessageData,
  ProcessLlmResult,
  TaskPrioritizationFlowContext,
  FlowUserMessage,
} from '../../../types/flow-internal.types';
import { TASK_PRIORITIZATION_NODES } from '../../constants';
import { GenerateNodeBase } from '../base/';
import { MutableContext } from 'src/utils/mutable-context';

const PRIORITY_ITEM_SCHEMA = z.object({
  taskId: z.string().describe('Task identifier'),
  initiativeId: z.string().describe('Parent initiative identifier'),
  title: z.string().describe('Task title'),
  rationale: z.string().describe('Why this task belongs in the priority queue'),
});

const taskPrioritizationResponseSchema = z.object({
  type: z.literal(SystemMessageData.TypeEnum.TaskPriority),
  response: z
    .string()
    .describe('Brief response summarizing prioritization outcome'),
  detectedIntent: z
    .literal('task_prioritization_complete')
    .describe('Intent to mark prioritization completion'),
  intentConfidence: z
    .number()
    .min(0)
    .max(1)
    .describe('Confidence in the prioritization intent'),
  reasoning: z.string().describe('Overall reasoning behind the queue ordering'),
  priorityQueue: z
    .array(PRIORITY_ITEM_SCHEMA)
    .max(10)
    .describe('Top tasks ordered from highest priority to lower priority'),
});

type TaskPrioritizationResponseBase = Required<
  z.infer<typeof taskPrioritizationResponseSchema>
>;

type TaskPrioritizationResponse = Omit<
  TaskPrioritizationResponseBase,
  'priorityQueue'
> & {
  priorityQueue: Required<
    TaskPrioritizationResponseBase['priorityQueue'][number]
  >[];
};

@Injectable()
export class TaskPrioritizationGenerateNode extends GenerateNodeBase<TaskPrioritizationFlowContext> {
  readonly id = TASK_PRIORITIZATION_NODES.GENERATE;
  readonly title = 'Generate Priority Queue';
  private readonly logger = new Logger(TaskPrioritizationGenerateNode.name);

  constructor(
    private readonly initiativeService: InitiativeService,
    private readonly taskService: TaskService,
  ) {
    super();
  }

  readonly promptConfig = {
    systemPromptTemplate: (context: TaskPrioritizationFlowContext): string =>
      this.buildSystemPrompt(context),
    responseSchema: taskPrioritizationResponseSchema,
    temperature: 0.3,
    maxTokens: 12000,
  };

  private formatSnapshot(snapshot: InitiativeTaskSnapshot[]): string {
    return JSON.stringify(snapshot, null, 2);
  }

  private buildSystemPrompt(context: TaskPrioritizationFlowContext): string {
    const snapshot = context.initiativeTaskSnapshot || [];
    const snapshotBlock =
      snapshot.length > 0
        ? this.formatSnapshot(snapshot)
        : '[] // No initiatives or tasks available';

    return `You are a planning assistant that produces a single priority queue of the next 10 tasks across all initiatives in this organization.

What you have:
- A dataset of every initiative and its tasks. Each task includes: title, id, description, status, and acceptanceCriteria (see JSON below).
- Initiative metadata (name, description, status, priority, acceptanceCriteria) that may influence urgency or sequencing.

Steps to follow:
1) Read the initiatives + tasks dataset below without skipping or truncating any content.
2) Analyze initiative context and task fields to determine the next 10 tasks to execute (highest priority first). If fewer than 10 tasks exist, return all available tasks. If none exist, return an empty queue with a clear explanation.
3) For each queue entry, return the taskId and title (include initiativeId and a short rationale when helpful).
4) Provide a concise "response" for the user plus a "reasoning" string that explains the ordering choices.

Required output shape (must match the response schema):
- type: "TASK_PRIORITY"
- detectedIntent: "task_prioritization_complete"
- intentConfidence: 0..1
- response: short user-facing summary
- reasoning: concise narrative of how you prioritized
- priorityQueue: ordered array (max 10) with taskId, title, initiativeId, and a brief rationale for inclusion.

Initiatives and tasks dataset (complete):
${snapshotBlock}
`;
  }

  async beforeGeneration(
    tracker: MutableContext<TaskPrioritizationFlowContext>,
  ): Promise<void> {
    const context = tracker.getContext();
    const organizationId = context.core.organizationId;
    const projectId = context.core.projectId;
    const pageSize = 100;
    let page = 1;
    const initiatives: InitiativeTaskSnapshot[] = [];

    while (true) {
      const batch = await this.initiativeService.findAllForAdapter(
        organizationId,
        { projectId, page, limit: pageSize },
      );

      if (!batch || batch.length === 0) {
        break;
      }

      for (const initiative of batch) {
        const tasks = await this.taskService.findAll(
          organizationId,
          initiative.id,
        );
        const initiativeContent = materializedSectionsToContentMap(
          initiative.sections,
        );

        initiatives.push({
          initiativeId: initiative.id,
          name: initiative.name,
          description: initiativeContent.description || '',
          status: initiative.status,
          priority: initiative.priority,
          acceptanceCriteria: initiativeContent.acceptanceCriteria || '',
          tasks: tasks.map((task) => {
            const taskContent = materializedSectionsToContentMap(task.sections);
            return {
              id: task.id as TaskId,
              title: task.name,
              description: taskContent.description || '',
              status: task.status,
              acceptanceCriteria: taskContent.acceptanceCriteria || '',
            };
          }),
        });
      }

      if (batch.length < pageSize) {
        break;
      }
      page += 1;
    }

    tracker.mutate((context) => {
      context.initiativeTaskSnapshot = initiatives;
    });
    this.logger.debug('Prepared initiative/task snapshot for prioritization', {
      workflowId: context.core.workflowId,
      initiativeCount: initiatives.length,
    });
  }

  async processLlmResponse(
    systemMessageData: IntermediateSystemMessageData,
    _userMessage: FlowUserMessage | undefined,
    tracker: MutableContext<TaskPrioritizationFlowContext>,
  ): Promise<ProcessLlmResult> {
    const parsedResponse = systemMessageData as TaskPrioritizationResponse;

    const modifiedResult: TaskPrioritySystemMessageData = {
      type: SystemMessageData.TypeEnum.TaskPriority,
      response: parsedResponse.response,
      detectedIntent: parsedResponse.detectedIntent,
      intentConfidence: parsedResponse.intentConfidence,
      reasoning: parsedResponse.reasoning,
      priorityQueue: parsedResponse.priorityQueue,
      title: this.title,
      flowId: tracker.getContext().flowId || WorkflowName.TaskPrioritization,
      nodeId: this.id,
    };

    return { modifiedResult };
  }
}
