import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TaskAllowedStatusEntry, WorkStatus } from "../../api";
import { tasksClient } from "../../clients/serviceClients";

export interface UseTaskAllowedStatusesParams {
  organizationId: string;
  projectId: string;
  enabled?: boolean;
}

export interface UseTaskAllowedStatusesReturn {
  isLoading: boolean;
  error: string | null;
  /**
   * The complete set of work statuses the backend permits for a given task
   * type. Returns an empty array until the per-type sets have loaded or when
   * the type is unknown — the status picker is driven entirely off this set
   * and never re-derives validity client-side.
   */
  getAllowedStatuses: (taskType?: string) => WorkStatus[];
}

/**
 * Fetches the per-type allowed work status sets for a project. This is the
 * single backed source for the status picker: the backend owns which statuses
 * each task type permits (including whether SUPERSEDED is offered), so the
 * frontend keeps no hardcoded selectable-status list.
 */
export function useTaskAllowedStatuses({
  organizationId,
  projectId,
  enabled = true,
}: UseTaskAllowedStatusesParams): UseTaskAllowedStatusesReturn {
  const [entries, setEntries] = useState<TaskAllowedStatusEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    if (!enabled || !organizationId || !projectId) {
      return;
    }

    setIsLoading(true);
    setError(null);

    tasksClient
      .getTaskAllowedStatuses({
        organizationId: organizationId,
        projectId: projectId,
      })
      .then((response) => {
        if (cancelledRef.current) return;
        setEntries(response.data?.data?.entries ?? []);
        setIsLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelledRef.current) return;
        setError(
          err instanceof Error
            ? err.message
            : "Failed to load allowed statuses."
        );
        setIsLoading(false);
      });

    return () => {
      cancelledRef.current = true;
    };
  }, [organizationId, projectId, enabled]);

  const getAllowedStatuses = useCallback(
    (taskType?: string): WorkStatus[] => {
      if (!taskType) return [];
      const entry = entries.find((e) => e.taskType === taskType);
      return entry?.allowedStatuses ?? [];
    },
    [entries]
  );

  return useMemo(
    () => ({ isLoading, error, getAllowedStatuses }),
    [isLoading, error, getAllowedStatuses]
  );
}
