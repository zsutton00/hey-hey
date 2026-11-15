import {
  TaskMonitorLaunchMethod,
  TaskMonitorLaunchProvider,
  TaskMonitorReasoningEffort,
  type WorkItemTypeMonitorKind,
} from "../../api";
import { useWorkItemTypeByKey } from "../../data/hooks/useWorkItemTypes";

const TASK_MONITOR_TYPE_KEY = "TASK_MONITOR";

/**
 * What every monitor resolves to when its type declares no kind; the same
 * default the API and CLI apply, so existing and custom monitor types keep
 * offering exactly what Task Monitor always offered.
 */
export const TASK_MONITOR_TASK_KIND: WorkItemTypeMonitorKind = {
  key: "task",
  allowedNodeTypes: ["STANDARD"],
  allowedLaunchMethods: Object.values(TaskMonitorLaunchMethod),
  allowedRuntimeProviders: Object.values(TaskMonitorLaunchProvider),
  allowedReasoningEfforts: Object.values(TaskMonitorReasoningEffort),
};

/**
 * The kind of the project's monitor type. Until the type has loaded, and for
 * a type that declares none, this is the Task kind.
 */
export const useMonitorKind = (
  organizationId: string,
  projectId: string,
): WorkItemTypeMonitorKind => {
  const { workItemTypeDefinition } = useWorkItemTypeByKey(
    organizationId,
    projectId,
    TASK_MONITOR_TYPE_KEY,
  );

  return (
    workItemTypeDefinition?.capabilities?.monitorKind ?? TASK_MONITOR_TASK_KIND
  );
};
