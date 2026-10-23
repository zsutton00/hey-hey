import { Injectable, Logger } from '@nestjs/common';
import { TaskDependencyRelationType } from '@prisma/client';
import { z } from 'zod';
import { TASK_DEPENDENCY_INFERENCE_NODES } from 'src/flows/constants';
import { TaskService } from 'src/services/tasks/task.service';
import {
  FlowContext,
  FlowUserMessage,
  IntermediateSystemMessageData,
  MutableContextHandle,
  NonInteractiveNodeBase,
  ProcessLlmResult,
  TaskDependencyInferenceFlowContext,
} from 'src/types/flow-internal.types';
import { SystemMessageData } from 'src/generated';
import { ClaudeModel, LLMProviderName } from 'src/services/llm/llm-shared';
import { TaskId } from 'src/types';
import { materializedSectionsToContentMap } from 'src/utils/work-item-section.util';

// Updated schema to match new response structure
const dependencyInferenceSchema = z.object({
  newTaskDependencies: z.array(
    z.object({
      dependencyTaskId: z.string(),
      reason: z.string().optional(),
    }),
  ),
  updatedDependencies: z.array(
    z.object({
      originalDependentTaskId: z.string(),
      originalDependencyTaskId: z.string(),
      newDependencyTaskId: z.string(),
      reason: z.string().optional(),
    }),
  ),
});

type InferredDependency = {
  dependentTaskId: TaskId;
  dependencyTaskId: TaskId;
  relationType: TaskDependencyRelationType;
  reason?: string | null;
};

type DependencyUpdate = {
  originalDependentTaskId: TaskId;
  originalDependencyTaskId: TaskId;
  newDependencyTaskId: TaskId;
  reason?: string | null;
};

type DependencyInferenceTask = {
  id: string;
  name: string;
  description?: string | null;
  status?: string | null;
  parentTaskId?: string | null;
};

type DependencyInferenceEdge = {
  dependentTaskId: string;
  dependencyTaskId: string;
  relationType: string;
  sourceType: string;
  reason?: string | null;
};

type DependencyInferenceMetadata = {
  newTask: DependencyInferenceTask;
  existingTasks: DependencyInferenceTask[];
  existingDependencies: DependencyInferenceEdge[];
};

@Injectable()
export class TaskDependencyInferenceNode extends NonInteractiveNodeBase<TaskDependencyInferenceFlowContext> {
  private readonly logger = new Logger(TaskDependencyInferenceNode.name);
  readonly id = TASK_DEPENDENCY_INFERENCE_NODES.GENERATE;

  constructor(private readonly taskService: TaskService) {
    super();
  }

  readonly promptConfig = {
    modelCriteria: {
      model: ClaudeModel.CLAUDE_4_HAIKU_5,
      provider: LLMProviderName.CLAUDE,
    },
    maxTokens: 20000,
    timeout: 240000,
    temperature: 0.2,
    systemPromptTemplate: (context: FlowContext) =>
      this.buildSystemPrompt(context as TaskDependencyInferenceFlowContext),
    responseSchema: dependencyInferenceSchema,
  };

  async beforeGeneration(
    tracker: MutableContextHandle<TaskDependencyInferenceFlowContext>,
    _previousUserMessage?: FlowUserMessage,
  ): Promise<void> {
    const context = tracker.getContext();
    if (!context.core.projectId) {
      throw new Error(
        '[TaskDependencyInferenceNode] projectId is required for dependency inference',
      );
    }
    if (!context.targetTaskIds?.[0]) {
      throw new Error(
        '[TaskDependencyInferenceNode] at least one targetTaskId is required for single-task dependency inference',
      );
    }

    const tasks = await this.taskService.findAllByOrganizationForAdapter(
      context.core.organizationId,
      {
        projectId: context.core.projectId,
        ...(context.initiativeId ? { initiativeId: context.initiativeId } : {}),
      },
    );

    const dependencies = context.initiativeId
      ? await this.taskService.listDependenciesForInitiative(
          context.core.organizationId,
          context.initiativeId,
        )
      : [];

    const newTasks = tasks.filter((t) =>
      context.targetTaskIds.includes(t.id as TaskId),
    );
    if (!newTasks.length) {
      throw new Error(
        `[TaskDependencyInferenceNode] Target tasks ${context.targetTaskIds.join(', ')} not found in project`,
      );
    }

    const newTaskSnapshots: DependencyInferenceTask[] = newTasks.map(
      (newTask) => {
        const content = materializedSectionsToContentMap(newTask.sections);
        return {
          id: newTask.id,
          name: newTask.name,
          description: content.description ?? undefined,
          status: newTask.status ?? undefined,
          parentTaskId: newTask.parentTaskId ?? undefined,
        };
      },
    );

    const existingTasksSnapshot: DependencyInferenceTask[] = tasks
      .filter((t) => !context.targetTaskIds.includes(t.id as TaskId))
      .map((task) => {
        const content = materializedSectionsToContentMap(task.sections);
        return {
          id: task.id,
          name: task.name,
          description: content.description ?? undefined,
          status: task.status ?? undefined,
          parentTaskId: task.parentTaskId ?? undefined,
        };
      });

    const existingDependenciesSnapshot: DependencyInferenceEdge[] =
      dependencies.map((dependency) => ({
        dependentTaskId: dependency.dependentTaskId,
        dependencyTaskId: dependency.dependencyTaskId,
        relationType: dependency.relationType,
        sourceType: dependency.sourceType,
        reason: dependency.reason ?? undefined,
      }));

    tracker.mutate((draft) => {
      draft.metadata = {
        ...draft.metadata,
        dependencyInference: {
          newTasks: newTaskSnapshots,
          existingTasks: existingTasksSnapshot,
          existingDependencies: existingDependenciesSnapshot,
        },
      };
    });

    this.logger.debug('[beforeGeneration] Loaded tasks for inference', {
      initiativeId: context.initiativeId,
      targetTaskIds: context.targetTaskIds,
      existingTaskCount: existingTasksSnapshot.length,
      existingDependencyCount: existingDependenciesSnapshot.length,
    });
  }

  async processLlmResponse(
    systemMessageData: IntermediateSystemMessageData,
    _userMessage: FlowUserMessage | undefined,
    tracker: MutableContextHandle<TaskDependencyInferenceFlowContext>,
  ): Promise<ProcessLlmResult> {
    const parsed = dependencyInferenceSchema.safeParse(systemMessageData);
    if (!parsed.success) {
      throw new Error(
        `[TaskDependencyInferenceNode] Invalid inference response: ${parsed.error.message}`,
      );
    }

    const context = tracker.getContext();
    const targetTaskId = context.targetTaskIds[0] as TaskId;

    // Convert new task dependencies to the standard format
    const newDependencies: InferredDependency[] =
      parsed.data.newTaskDependencies.map((dep) => ({
        dependentTaskId: targetTaskId,
        dependencyTaskId: dep.dependencyTaskId as TaskId,
        relationType: TaskDependencyRelationType.DEPENDS_ON,
        reason: dep.reason ?? undefined,
      }));

    // Convert updated dependencies
    const updatedDependencies: DependencyUpdate[] =
      parsed.data.updatedDependencies.map((dep) => ({
        originalDependentTaskId: dep.originalDependentTaskId as TaskId,
        originalDependencyTaskId: dep.originalDependencyTaskId as TaskId,
        newDependencyTaskId: dep.newDependencyTaskId as TaskId,
        reason: dep.reason ?? undefined,
      }));

    await this.taskService.applyInferredDependenciesForTask(
      context.core.organizationId,
      context.initiativeId,
      targetTaskId,
      {
        newDependencies,
        updatedDependencies,
      },
    );

    this.logger.log('[processLlmResponse] Applied inferred dependencies', {
      initiativeId: context.initiativeId,
      targetTaskId,
      newDependencyCount: newDependencies.length,
      updatedDependencyCount: updatedDependencies.length,
    });

    return { modifiedResult: parsed.data as unknown as SystemMessageData };
  }

  private buildSystemPrompt(
    context: TaskDependencyInferenceFlowContext,
  ): string {
    const metadata = (context.metadata?.dependencyInference ??
      {}) as DependencyInferenceMetadata;

    if (!metadata.newTask) {
      throw new Error(
        '[TaskDependencyInferenceNode] Missing new task snapshot for inference',
      );
    }

    const sections: string[] = [];

    sections.push(`You are a dependency inference assistant. A new task has been added to an initiative and you need to integrate it into the existing dependency graph.

Your goals:
1. Identify which existing tasks the new task depends on (things that must be done before the new task)
2. Identify if any existing dependencies should now route through the new task (where the new task is an intermediate step)`);

    sections.push(`RULES:
- Only reference tasks that exist in the EXISTING TASKS list
- For "updatedDependencies": only propose updates to edges in EXISTING DEPENDENCIES
- Prefer minimal dependencies: if A→B and B→C exist, don't add A→C
- If no dependencies are needed, return empty arrays`);

    sections.push('NEW TASK:');
    sections.push(JSON.stringify(metadata.newTask, null, 2));

    sections.push('EXISTING TASKS:');
    sections.push(JSON.stringify(metadata.existingTasks, null, 2));

    sections.push('EXISTING DEPENDENCIES:');
    sections.push(JSON.stringify(metadata.existingDependencies ?? [], null, 2));

    sections.push(`RESPONSE FORMAT:
{
  "newTaskDependencies": [
    {
      "dependencyTaskId": "id of task that must complete before the new task",
      "reason": "brief rationale"
    }
  ],
  "updatedDependencies": [
    {
      "originalDependentTaskId": "task that currently depends on something",
      "originalDependencyTaskId": "task it currently depends on",
      "newDependencyTaskId": "the new task ID - the dependency should now route through the new task",
      "reason": "brief rationale for why the new task is an intermediate step"
    }
  ]
}`);

    sections.push(`EXAMPLE - Updated Dependency:
If tasks A→C exists (C depends on A), and the new task B is an intermediate step, you would return:
{
  "updatedDependencies": [{
    "originalDependentTaskId": "C",
    "originalDependencyTaskId": "A", 
    "newDependencyTaskId": "B",
    "reason": "B is now an intermediate step between A and C"
  }]
}
This means: remove C→A, add C→B and B→A`);

    return sections.join('\n\n');
  }
}
