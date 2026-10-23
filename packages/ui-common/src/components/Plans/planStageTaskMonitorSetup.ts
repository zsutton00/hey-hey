import {
  WorkStatus,
  type TaskMonitorExecutionDefinition,
  type TaskMonitorExecutionNodeLaunchConfiguration,
  type TaskMonitorLaunchPolicy,
} from "../../api";
import type {
  CanonicalPlanStageSource,
  PlanStageStandardTask,
} from "../../data/plans/canonicalPlan";
import { buildCanonicalPlanTaskGraph } from "../../data/plans/canonicalPlan";

export {
  parseCanonicalPlanStageSource,
  type PlanStageStandardTask,
  type PlanStageWorkItem,
  type PlanWorkItem,
} from "../../data/plans/canonicalPlan";

export interface PlanStageTaskMonitorSetupInput extends CanonicalPlanStageSource {
  organizationId: string;
  projectId: string;
  preparedAt: string;
  launchConfiguration: TaskMonitorExecutionNodeLaunchConfiguration;
  launchPolicy: TaskMonitorLaunchPolicy;
  preparedByAgentSessionId?: string;
}

export interface PlanStageTaskMonitorProvenance {
  organizationId: string;
  projectId: string;
  planId: string;
  planWorktreeBranch: string | null;
  planParentTaskId: string;
  planLabel: string;
  stageId: string;
  stageLabel: string;
  preparedAt: string;
  preparedByAgentSessionId?: string;
}

export interface PlanStageTaskMonitorExecutableTask {
  taskId: string;
  label: string;
  description: string | null;
  serviceIds: string[];
}

export interface PlanStageTaskMonitorSetupDraft {
  definition: TaskMonitorExecutionDefinition;
  provenance: PlanStageTaskMonitorProvenance;
  executableTasks: PlanStageTaskMonitorExecutableTask[];
}

export type PlanStageTaskMonitorSetupErrorCode =
  "invalid-source" | "no-executable-work";

export interface PlanStageTaskMonitorSetupError {
  code: PlanStageTaskMonitorSetupErrorCode;
  messages: string[];
}

export type PlanStageTaskMonitorSetupResult =
  | { ok: true; draft: PlanStageTaskMonitorSetupDraft }
  | { ok: false; error: PlanStageTaskMonitorSetupError };

const isNonEmpty = (value: string | null | undefined): value is string =>
  typeof value === "string" && value.trim().length > 0;

const addMessage = (messages: string[], message: string): void => {
  if (!messages.includes(message)) messages.push(message);
};

const taskDescriptionFor = (task: PlanStageStandardTask): string | null => {
  const description = task.sections
    ?.find((section) => section.key === "description")
    ?.materializedMarkdown.trim();
  return description && description.length > 0 ? description : null;
};

const isArchived = (task: PlanStageStandardTask): boolean =>
  task.status === WorkStatus.Archived || isNonEmpty(task.archivedAt);

const isExecutable = (task: PlanStageStandardTask): boolean =>
  task.status !== WorkStatus.Completed &&
  task.status !== WorkStatus.Cancelled &&
  !isArchived(task);

const validateSource = (
  input: PlanStageTaskMonitorSetupInput,
  messages: string[],
): void => {
  if (!isNonEmpty(input.organizationId) || !isNonEmpty(input.projectId)) {
    addMessage(messages, "Organization and project context are required.");
  }
  if (
    input.plan.organizationId !== input.organizationId ||
    input.stage.organizationId !== input.organizationId ||
    input.tasks.some((task) => task.organizationId !== input.organizationId)
  ) {
    addMessage(
      messages,
      "All selected Work Items must belong to the requested organization.",
    );
  }
  if (
    input.plan.projectId !== input.projectId ||
    input.stage.projectId !== input.projectId ||
    input.tasks.some((task) => task.projectId !== input.projectId)
  ) {
    addMessage(
      messages,
      "All selected Work Items must belong to the requested project.",
    );
  }
  if (input.stage.parentTaskId !== input.plan.id) {
    addMessage(
      messages,
      "The selected Plan Stage must be a direct child of the Plan.",
    );
  }
  if (input.tasks.some((task) => task.parentTaskId !== input.stage.id)) {
    addMessage(
      messages,
      "Every selected Task must be a direct child of the Plan Stage.",
    );
  }
  if (!isNonEmpty(input.plan.name) || !isNonEmpty(input.stage.name)) {
    addMessage(messages, "The Plan and Plan Stage labels are required.");
  }
  if (!isNonEmpty(input.preparedAt)) {
    addMessage(messages, "A preparation timestamp is required.");
  }
  if (
    input.preparedByAgentSessionId !== undefined &&
    !isNonEmpty(input.preparedByAgentSessionId)
  ) {
    addMessage(messages, "The preparation actor identity cannot be empty.");
  }
  for (const task of input.tasks) {
    if (!isNonEmpty(task.name)) {
      addMessage(messages, "Every selected Task must have a label.");
    }
    if (isArchived(task)) {
      addMessage(
        messages,
        "An archived Task cannot be selected for execution.",
      );
    }
  }
};

export const composePlanStageTaskMonitorSetup = (
  input: PlanStageTaskMonitorSetupInput,
): PlanStageTaskMonitorSetupResult => {
  const messages: string[] = [];
  validateSource(input, messages);
  if (!input.plan.parentTaskId) {
    messages.push("Task Monitor creation requires a parent Feature.");
  }
  const graph = buildCanonicalPlanTaskGraph(input.tasks, messages);
  if (messages.length > 0 || !graph || !input.plan.parentTaskId) {
    return { ok: false, error: { code: "invalid-source", messages } };
  }
  const executableTaskIds = new Set(
    graph.orderedTasks.filter(isExecutable).map((task) => task.id),
  );
  const executableTasks = graph.orderedTasks
    .filter(isExecutable)
    .map((task): PlanStageTaskMonitorExecutableTask => ({
      taskId: task.id,
      label: task.name.trim(),
      description: taskDescriptionFor(task),
      serviceIds: [
        ...new Set(
          (task.serviceRelations ?? []).map((relation) => relation.serviceId),
        ),
      ],
    }));
  if (executableTasks.length === 0) {
    return {
      ok: false,
      error: {
        code: "no-executable-work",
        messages: ["This Plan Stage has no executable STANDARD Tasks."],
      },
    };
  }
  const preparedByAgentSessionId = input.preparedByAgentSessionId?.trim();
  return {
    ok: true,
    draft: {
      provenance: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        planId: input.plan.id,
        planWorktreeBranch: input.configuration.worktreeBranch,
        planParentTaskId: input.plan.parentTaskId,
        planLabel: input.plan.name.trim(),
        stageId: input.stage.id,
        stageLabel: input.stage.name.trim(),
        preparedAt: input.preparedAt.trim(),
        ...(preparedByAgentSessionId ? { preparedByAgentSessionId } : {}),
      },
      executableTasks,
      definition: {
        executionPlan: executableTasks.map((task) => ({
          taskId: task.taskId,
          dependsOnTaskIds: (
            graph.dependenciesByTaskId.get(task.taskId) ?? []
          ).filter((taskId) => executableTaskIds.has(taskId)),
          launchConfiguration: input.launchConfiguration,
        })),
        launchPolicy: input.launchPolicy,
        cursor: 0,
      },
    },
  };
};
