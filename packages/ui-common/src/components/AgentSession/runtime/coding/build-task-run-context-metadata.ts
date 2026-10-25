import type { RunContextMetadata } from "../../../../api";
import type { WorkItemResponseDto } from "../../../../data/collections/workItems";

export interface BuildTaskRunContextMetadataInput {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  task: WorkItemResponseDto;
  launchPlanId?: string | null;
  launchStepId?: string | null;
  launchStageId?: string | null;
  userComments?: string[];
  fileReferences?: {
    resolved: string[];
    unresolved: string[];
  };
}

const readNonEmptyString = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const buildTaskRunContextMetadata = (
  input: BuildTaskRunContextMetadataInput,
): RunContextMetadata => {
  const organizationId = readNonEmptyString(input.organizationId);
  if (!organizationId) {
    throw new Error("Task run context metadata requires organizationId.");
  }

  const projectId = readNonEmptyString(input.projectId);
  if (!projectId) {
    throw new Error("Task run context metadata requires projectId.");
  }

  const agentSessionId = readNonEmptyString(input.agentSessionId);
  if (!agentSessionId) {
    throw new Error("Task run context metadata requires agentSessionId.");
  }

  const taskId = readNonEmptyString(input.task.id);
  if (!taskId) {
    throw new Error("Task run context metadata requires task.id.");
  }

  return {
    capturedAt: new Date().toISOString(),
    organizationId,
    projectId,
    agentSessionId,
    ...(input.launchPlanId ? { launchPlanId: input.launchPlanId } : {}),
    ...(input.launchStepId ? { launchStepId: input.launchStepId } : {}),
    ...(input.launchStageId ? { launchStageId: input.launchStageId } : {}),
    task: input.task,
    userComments: input.userComments ?? [],
    fileReferences: input.fileReferences ?? { resolved: [], unresolved: [] },
  };
};
