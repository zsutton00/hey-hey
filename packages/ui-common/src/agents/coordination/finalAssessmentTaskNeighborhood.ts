import { AgentEdgeType, type TaskResponseDto } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import type { WorkItemResponseDto } from "../../data/collections/workItems";
import {
  isPlanStageStandardTask,
  isPlanStageWorkItem,
  isPlanWorkItem,
  type PlanStageStandardTask,
} from "../../data/plans/canonicalPlan";
import { getWorkItemSectionContent } from "../../utils/workItemSections";
import type {
  FinalAssessmentRelatedTaskInput,
  FinalAssessmentTaskNeighborhoodInput,
} from "./types";

interface ResolveFinalAssessmentTaskNeighborhoodInput {
  organizationId: string;
  projectId: string;
  planId: string;
  taskId: string;
}

const EMPTY_TASK_NEIGHBORHOOD: FinalAssessmentTaskNeighborhoodInput = {
  parentTasks: [],
  childTasks: [],
};

const taskResponseToRelatedTask = (
  task: WorkItemResponseDto
): FinalAssessmentRelatedTaskInput => ({
  id: task.id,
  title: task.name,
  taskType: task.type,
  description: getWorkItemSectionContent(task.sections, "description"),
  acceptanceCriteria: getWorkItemSectionContent(
    task.sections,
    "acceptanceCriteria"
  ),
});

const dependencyIdsFor = (
  task: PlanStageStandardTask,
  siblingTaskIds: ReadonlySet<string>
): string[] => [
  ...new Set(
    (task.edges ?? []).flatMap((edge) =>
      edge.type === AgentEdgeType.DependsOn &&
      edge.sourceNodeId === task.id &&
      siblingTaskIds.has(edge.targetNodeId)
        ? [edge.targetNodeId]
        : []
    )
  ),
];

export const deriveFinalAssessmentTaskNeighborhood = (input: {
  activeTaskId: string;
  siblingTasks: readonly PlanStageStandardTask[];
}): FinalAssessmentTaskNeighborhoodInput => {
  const activeTaskId = input.activeTaskId.trim();
  const tasksById = new Map(input.siblingTasks.map((task) => [task.id, task]));
  if (activeTaskId.length === 0 || !tasksById.has(activeTaskId)) {
    return EMPTY_TASK_NEIGHBORHOOD;
  }

  const siblingTaskIds = new Set(tasksById.keys());
  const activeTask = tasksById.get(activeTaskId);
  if (!activeTask) return EMPTY_TASK_NEIGHBORHOOD;

  const parentIds = new Set(dependencyIdsFor(activeTask, siblingTaskIds));
  const childIds = new Set(
    input.siblingTasks.flatMap((task) =>
      dependencyIdsFor(task, siblingTaskIds).includes(activeTaskId)
        ? [task.id]
        : []
    )
  );

  const collect = (ids: ReadonlySet<string>): FinalAssessmentRelatedTaskInput[] =>
    input.siblingTasks.flatMap((task) =>
      ids.has(task.id) && task.id !== activeTaskId
        ? [taskResponseToRelatedTask(task)]
        : []
    );

  return {
    parentTasks: collect(parentIds),
    childTasks: collect(childIds),
  };
};

export const deriveSiblingTaskNeighborhood = (input: {
  activeTaskId: string;
  siblingTasks: TaskResponseDto[];
}): FinalAssessmentTaskNeighborhoodInput => {
  const activeTaskId = input.activeTaskId.trim();
  if (activeTaskId.length === 0 || input.siblingTasks.length === 0) {
    return EMPTY_TASK_NEIGHBORHOOD;
  }

  const activeIndex = input.siblingTasks.findIndex(
    (task) => task.id === activeTaskId
  );
  if (activeIndex < 0) return EMPTY_TASK_NEIGHBORHOOD;

  const previousTask = input.siblingTasks[activeIndex - 1];
  const nextTask = input.siblingTasks[activeIndex + 1];
  return {
    parentTasks: previousTask ? [taskResponseToRelatedTask(previousTask)] : [],
    childTasks: nextTask ? [taskResponseToRelatedTask(nextTask)] : [],
  };
};

/** @deprecated Use deriveSiblingTaskNeighborhood instead. */
export const deriveInitiativeFinalAssessmentTaskNeighborhood =
  deriveSiblingTaskNeighborhood;

const requireTask = async (input: {
  organizationId: string;
  projectId: string;
  taskId: string;
}): Promise<TaskResponseDto> => {
  const response = await unifiedApiClient.getTask({
    ...input,
    includeEdges: true,
    edgeTypes: [AgentEdgeType.DependsOn],
  });
  const task = response.data?.data;
  if (!task) throw new Error(`Failed to load Work Item ${input.taskId}`);
  return task;
};

export const resolveFinalAssessmentTaskNeighborhood = async (
  input: ResolveFinalAssessmentTaskNeighborhoodInput
): Promise<FinalAssessmentTaskNeighborhoodInput> => {
  const organizationId = input.organizationId.trim();
  const projectId = input.projectId.trim();
  const planId = input.planId.trim();
  const taskId = input.taskId.trim();
  if (
    organizationId.length === 0 ||
    projectId.length === 0 ||
    planId.length === 0 ||
    taskId.length === 0
  ) {
    return EMPTY_TASK_NEIGHBORHOOD;
  }

  const activeTask = await requireTask({ organizationId, projectId, taskId });
  if (!isPlanStageStandardTask(activeTask)) {
    throw new Error(`Work Item ${taskId} is not a Standard Task in a Plan Stage`);
  }

  const stage = await requireTask({
    organizationId,
    projectId,
    taskId: activeTask.parentTaskId,
  });
  if (!isPlanStageWorkItem(stage) || stage.parentTaskId !== planId) {
    throw new Error(`Task ${taskId} does not belong to Plan ${planId}`);
  }

  const plan = await requireTask({ organizationId, projectId, taskId: planId });
  if (!isPlanWorkItem(plan)) {
    throw new Error(`Work Item ${planId} is not a canonical Plan`);
  }

  const response = await unifiedApiClient.getTasks({
    organizationId,
    projectId,
    parentTaskId: stage.id,
    type: "STANDARD",
    includeEdges: true,
    edgeTypes: [AgentEdgeType.DependsOn],
    includeSectionKeys: ["description", "acceptanceCriteria"],
    limit: 500,
  });
  const tasks = response.data?.data ?? [];
  if (tasks.length >= 500) {
    throw new Error(`Plan Stage ${stage.id} has too many Tasks to resolve safely`);
  }
  const canonicalTasks = tasks.filter(
    (task): task is TaskResponseDto & PlanStageStandardTask =>
      isPlanStageStandardTask(task)
  );
  if (canonicalTasks.length !== tasks.length) {
    throw new Error(`Plan Stage ${stage.id} returned an invalid Task hierarchy`);
  }

  return deriveFinalAssessmentTaskNeighborhood({
    activeTaskId: taskId,
    siblingTasks: canonicalTasks,
  });
};
