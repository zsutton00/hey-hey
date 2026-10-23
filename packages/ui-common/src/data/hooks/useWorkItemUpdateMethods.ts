import {
  useWorkItems,
  type UseWorkItemsReturn,
  type WorkItemHookOptions,
} from "./useWorkItems";

export function useWorkItemUpdateMethods(
  organizationId: string,
  entityType: "initiative" | "task",
  projectId: string,
  conversationId?: string,
  options: Omit<WorkItemHookOptions, "enabled"> = {}
): UseWorkItemsReturn {
  return useWorkItems(organizationId, entityType, projectId, conversationId, {
    initiativeId: options.initiativeId,
    enabled: false,
  });
}
