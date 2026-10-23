import { WorkStatus } from "../../api";

export type TaskMonitorStartPresentation =
  | { status: "ready" }
  | { status: "starting" }
  | { status: "active" };

export type TaskMonitorLifecycleAction = "START" | "PAUSE" | null;

export const resolveTaskMonitorLifecycleAction = (
  monitorStatus: WorkStatus
): TaskMonitorLifecycleAction => {
  switch (monitorStatus) {
    case WorkStatus.Backlog:
    case WorkStatus.OnHold:
      return "START";
    case WorkStatus.Active:
      return "PAUSE";
    case WorkStatus.Generated:
    case WorkStatus.Ready:
    case WorkStatus.Refining:
    case WorkStatus.Blocked:
    case WorkStatus.RefiningDescription:
    case WorkStatus.RefiningDetails:
    case WorkStatus.RefiningAcceptanceCriteria:
    case WorkStatus.GeneratingDescription:
    case WorkStatus.GeneratingDetails:
    case WorkStatus.GeneratingDescriptionAndDetails:
    case WorkStatus.GeneratingAcceptanceCriteria:
    case WorkStatus.GeneratingAll:
    case WorkStatus.Verifying:
    case WorkStatus.Completed:
    case WorkStatus.Cancelled:
    case WorkStatus.Archived:
    case WorkStatus.Superseded:
      return null;
  }
};

export interface ResolveTaskMonitorStartPresentationOptions {
  monitorStatus: WorkStatus;
  isSubmitting: boolean;
  acceptedAwaitingRefresh: boolean;
}

export const resolveTaskMonitorStartPresentation = ({
  monitorStatus,
  isSubmitting,
  acceptedAwaitingRefresh,
}: ResolveTaskMonitorStartPresentationOptions): TaskMonitorStartPresentation => {
  if (resolveTaskMonitorLifecycleAction(monitorStatus) !== "START") {
    return { status: "active" };
  }
  if (isSubmitting || acceptedAwaitingRefresh) {
    return { status: "starting" };
  }
  return { status: "ready" };
};
