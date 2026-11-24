import type {
  WorkItemExecutionFreshness,
  TaskMonitorStateProjection,
} from "../../api";
import type { WorkItemExecutionStateDelivery } from "../../data/collections/workItemExecutionState";
import {
  monitorNeedsFeedback,
  monitorPhase,
} from "./useTaskMonitorPresentation";

export type TaskMonitorRowStatus =
  | "running"
  | "paused"
  | "needs_feedback"
  | "awaiting_approval"
  | "failed"
  | "completed"
  | "halted";

/**
 * Render-ready monitor signal for one Open Items row. `none` carries why
 * nothing is shown, so a missing record, a monitor that has not started and a
 * read still in flight stay distinguishable without guessing a status.
 */
export type TaskMonitorRowSignal =
  | { kind: "none"; reason: "loading" | "missing" | "not_started" }
  | {
      kind: "status";
      status: TaskMonitorRowStatus;
      /** The owner's last report; newer reports may exist. */
      stale: boolean;
    };

export const TASK_MONITOR_ROW_LABELS: Record<TaskMonitorRowStatus, string> = {
  running: "Running",
  paused: "Paused",
  needs_feedback: "Needs feedback",
  awaiting_approval: "Awaiting approval",
  failed: "Failed",
  completed: "Completed",
  halted: "Halted",
};

const hasHumanApproval = (snapshot: TaskMonitorStateProjection): boolean =>
  (snapshot.outstandingPermissions ?? []).some(
    (permission) => permission.owner === "HUMAN",
  );

/**
 * Priority: judgment or intervention, then a request awaiting a person's
 * approval, then the monitor's own execution status. Never reads the work
 * item's status or any session's activity.
 */
export function taskMonitorRowStatus(
  snapshot: TaskMonitorStateProjection,
): TaskMonitorRowStatus | null {
  const phase = monitorPhase(snapshot, false);
  switch (phase) {
    case "done":
      return "completed";
    case "halted":
      return "halted";
    case "setup":
    case "unknown":
      return null;
    case "attention":
      return monitorNeedsFeedback(snapshot) ? "needs_feedback" : "failed";
    case "paused":
    case "running":
      return hasHumanApproval(snapshot) ? "awaiting_approval" : phase;
  }
}

export type TaskMonitorRowStateInput =
  | { status: "loading" }
  | { status: "error" }
  | { status: "missing" }
  | {
      status: "retained";
      delivery: WorkItemExecutionStateDelivery;
      freshness: WorkItemExecutionFreshness;
      projection: TaskMonitorStateProjection;
    };

export function taskMonitorRowSignal(
  input: TaskMonitorRowStateInput,
): TaskMonitorRowSignal {
  if (input.status === "loading" || input.status === "error") {
    return { kind: "none", reason: "loading" };
  }
  if (input.status === "missing") {
    return { kind: "none", reason: "missing" };
  }
  const status = taskMonitorRowStatus(input.projection);
  if (!status) {
    return { kind: "none", reason: "not_started" };
  }
  const stale =
    input.delivery !== "LIVE" || input.freshness.status !== "CURRENT";

  return { kind: "status", status, stale };
}
