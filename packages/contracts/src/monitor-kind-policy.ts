import type { WorkItemTypeMonitorKind } from "./generated/api/models/work-item-type-monitor-kind.js";

/** Supported combinations, shared by configuration and execution boundaries. */
export function monitorOperationPolicyIssues(
  kind: WorkItemTypeMonitorKind,
): string[] {
  const { start, done, supervision, acceptance } = kind;
  const issues: string[] = [];
  const reject = (reason: string): void => {
    issues.push(`"${kind.key}" monitor kind: ${reason}`);
  };
  if (done?.type === "ITEM_STATUS" && done.status !== "COMPLETED") {
    reject(
      "ITEM_STATUS requires canonical COMPLETED; an intermediate status cannot complete Task execution",
    );
  }
  if (acceptance?.type === "COMPLETE_ITEM") {
    if (done && done.type !== "ITEM_STATUS") {
      reject("COMPLETE_ITEM requires ITEM_STATUS COMPLETED");
    }
    if (supervision && supervision.type !== "COORDINATOR_REVIEW") {
      reject("COMPLETE_ITEM requires COORDINATOR_REVIEW");
    }
  }
  if (acceptance?.type === "NO_STATUS_CHANGE") {
    if (done && done.type !== "NORMALIZED_RESULT") {
      reject("NO_STATUS_CHANGE acceptance requires NORMALIZED_RESULT");
    }
    if (start && start.type !== "NO_STATUS_CHANGE") {
      reject("NO_STATUS_CHANGE acceptance requires NO_STATUS_CHANGE start");
    }
  }
  if (
    supervision?.type === "DIRECT_ACCEPTANCE" &&
    done &&
    done.type !== "NORMALIZED_RESULT"
  ) {
    reject("DIRECT_ACCEPTANCE requires NORMALIZED_RESULT");
  }
  return issues;
}
