import type { ApolloClient } from "@apollo/client";
import type { TaskHierarchyResponseDto } from "../../api";
import { fetchWorkItemHierarchy } from "../collections/workItemLists";

export async function fetchTaskHierarchy(
  client: ApolloClient,
  organizationId: string,
  projectId: string,
  taskId: string,
  options?: {
    includeDesignDocCounts?: boolean;
    includeAgentSessionCounts?: boolean;
  },
): Promise<TaskHierarchyResponseDto> {
  return fetchWorkItemHierarchy(client, { organizationId, projectId }, taskId, {
    includeDesignDocCounts: options?.includeDesignDocCounts ?? true,
    includeAgentSessionCounts: options?.includeAgentSessionCounts ?? true,
  });
}
