import { useQueries } from "@tanstack/react-query";
import { workItemListQueryOptions } from "../collections/workItemLists";
import { useWebsocketSubscriptions } from "./useWebsocketSubscriptions";

// GET tasks accepts at most 200 distinct taskIds per request.
const TASK_ID_BATCH_SIZE = 200;

/** Current records in the normal work-item cache, shared across review hosts. */
export function useExistingPlanTasks(
  organizationId: string,
  projectId: string,
  taskIds: string[],
) {
  const ids = [...new Set(taskIds)].sort();
  const batches: string[][] = [];
  for (let offset = 0; offset < ids.length; offset += TASK_ID_BATCH_SIZE) {
    batches.push(ids.slice(offset, offset + TASK_ID_BATCH_SIZE));
  }

  const reads = useQueries({
    queries: batches.map((batch) =>
      workItemListQueryOptions(organizationId, projectId, {
        taskIds: batch,
        limit: batch.length,
      }),
    ),
  });
  useWebsocketSubscriptions({ projectIds: [projectId] }, { enabled: true });

  return new Map(
    batches.flatMap((batch, index) => {
      const read = reads[index]!;
      const tasks = new Map((read.data ?? []).map((task) => [task.id, task]));
      return batch.map((id) => {
        const task = tasks.get(id);
        const presentation = read.isError
          ? { state: "error" as const }
          : read.isPending
            ? { state: "loading" as const }
            : task
              ? { state: "ready" as const, task }
              : { state: "unavailable" as const };
        return [id, presentation] as const;
      });
    }),
  );
}
