import { useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { TriageApplicationPorts } from "../triage/application";
import { triageReopenRequest } from "../triage/reopen";
import type { OpenItemsAdapter } from "../openItemsAdapter";
import { useAttachToGoal } from "./useAttachToGoal";
import { useWorkItems } from "./useWorkItems";
import { workItemKeys } from "../collections/workItemLists";
import { Priority, WorkStatus } from "../../api";

export function useTriageApplicationPorts(
  adapter: OpenItemsAdapter,
  promote: TriageApplicationPorts["promote"],
): TriageApplicationPorts {
  const { organizationId, projectId } = adapter.scope;
  const queryClient = useQueryClient();
  const { attach } = useAttachToGoal({ organizationId, projectId });
  const { createTask } = useWorkItems(organizationId, "task", projectId);
  return useMemo(
    () => ({
      refresh: async () => {
        await adapter.refresh();
      },
      target: (item) => {
        const collection = adapter.collection();
        const row =
          collection?.state === "PRESENT"
            ? collection.items.find(
                (row) =>
                  row.entityType === item.entityType &&
                  row.entityId === item.entityId,
              )
            : undefined;
        return {
          open: !!row,
          groupId: row?.groupId ?? null,
          pinned: row?.pinned ?? false,
        };
      },
      groupExists: (groupId) => {
        const collection = adapter.collection();
        return (
          collection?.state === "PRESENT" &&
          collection.groups.some((group) => group.groupId === groupId)
        );
      },
      remove: async (item, key) => {
        await adapter.mutateWithResult({
          kind: "removeOpenItem",
          parameters: {
            ...item,
            removeOpenItemRequest: {
              idempotencyKey: key,
              includeDescendants: true,
            },
          },
        });
      },
      reopen: async (item, key) => {
        const request = await triageReopenRequest(
          { organizationId, projectId },
          item,
          key,
        );
        await adapter.mutateWithResult({
          kind: "activateOpenItem",
          parameters: { activateOpenItemRequest: request },
        });
      },
      createGroup: async (name, key) => {
        const result = await adapter.mutateWithResult({
          kind: "createOpenItemGroup",
          parameters: {
            createOpenItemGroupRequest: { name, idempotencyKey: key },
          },
        });
        const group = result.groups[0];
        if (!group)
          throw new Error(
            "The new group could not be resolved. Retry to recover it.",
          );
        return group.groupId;
      },
      group: async (item, groupId, key) => {
        await adapter.mutateWithResult({
          kind: "assignOpenItemsToGroup",
          parameters: {
            groupId,
            assignOpenItemsToGroupRequest: {
              idempotencyKey: key,
              items: [{ entityType: item.entityType, entityId: item.entityId }],
            },
          },
        });
      },
      createGoal: async (draft) => {
        const goal = await createTask({
          type: "GOAL",
          name: draft.name,
          priority: Priority.Medium,
          status: WorkStatus.RefiningDescription,
          ...(draft.targetDate ? { dueDate: draft.targetDate } : {}),
        });
        return goal.id;
      },
      track: async (item, goalId) => {
        await attach({
          goalId,
          targetEntityId: item.entityId,
          targetEntityType: item.entityType,
        });
      },
      promote,
      revalidateGoals: async () => {
        await queryClient.invalidateQueries({
          queryKey: workItemKeys.project(organizationId, projectId),
        });
      },
    }),
    [
      adapter,
      organizationId,
      projectId,
      attach,
      createTask,
      promote,
      queryClient,
    ],
  );
}
