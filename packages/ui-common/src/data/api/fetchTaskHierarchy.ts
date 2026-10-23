import { tasksClient } from "../../clients/serviceClients";
import type { TaskHierarchyResponseDto } from "../../api";

export async function fetchTaskHierarchy(
  organizationId: string,
  projectId: string,
  taskId: string,
  options?: {
    includeDesignDocCounts?: boolean;
    includeAgentSessionCounts?: boolean;
  }
): Promise<TaskHierarchyResponseDto> {
  const response =
    await tasksClient.organizationsOrganizationIdProjectsProjectIdTasksTaskIdHierarchyGet(
      {
        organizationId: organizationId,
        projectId: projectId,
        taskId: taskId,
        includeDesignDocCounts: options?.includeDesignDocCounts ?? true,
        includeAgentSessionCounts: options?.includeAgentSessionCounts ?? true,
      }
    );

  const hierarchy = response.data?.data;
  if (!hierarchy) {
    throw new Error("Failed to fetch task hierarchy");
  }

  return hierarchy;
}
