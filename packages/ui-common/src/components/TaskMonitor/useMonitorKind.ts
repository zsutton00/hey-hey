import type { WorkItemTypeMonitorKind } from "../../api";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";

const TASK_MONITOR_TYPE_KEY = "TASK_MONITOR";

/**
 * The project's effective monitor kind, as the API resolves it (legacy
 * definitions already carry the canonical Task kind). Undefined until the type
 * has loaded or when it cannot be read; callers then offer only what a node
 * already has rather than guessing a kind.
 */
export const useMonitorKind = (
  organizationId: string,
  projectId: string,
): WorkItemTypeMonitorKind | undefined => {
  const { workItemTypeDefinition } = useWorkItemTypeByKey(
    organizationId,
    projectId,
    TASK_MONITOR_TYPE_KEY,
  );

  return workItemTypeDefinition?.capabilities?.monitorKind;
};
