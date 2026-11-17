import type { WorkItemTypeMonitorKind } from "../../api";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";

const TASK_MONITOR_TYPE_KEY = "TASK_MONITOR";

/**
 * The kind a monitor runs: the entry, keyed by the monitor's recorded kind
 * key, of its project's effective TASK_MONITOR type as the API resolves it.
 * Undefined until the type has loaded, when it cannot be read, or when the
 * type does not declare the key; callers then offer only what a node already
 * has rather than guessing a kind.
 */
export const useMonitorKind = (
  organizationId: string,
  projectId: string,
  kindKey: string,
): WorkItemTypeMonitorKind | undefined => {
  const { workItemTypeDefinition } = useWorkItemTypeByKey(
    organizationId,
    projectId,
    TASK_MONITOR_TYPE_KEY,
  );

  return workItemTypeDefinition?.capabilities?.monitorKinds?.find(
    (kind) => kind.key === kindKey,
  );
};
