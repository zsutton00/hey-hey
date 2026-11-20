import type { TaskResponseDto } from "../../api/api";
import { WorkStatus } from "../../api";
import { TASK_MONITOR_TYPE } from "./PlanStageTaskMonitorCreateOrReopen.utils";

const TERMINAL_MONITOR_STATUSES: ReadonlySet<TaskResponseDto["status"]> =
  new Set([
    WorkStatus.Completed,
    WorkStatus.Cancelled,
    WorkStatus.Superseded,
    WorkStatus.Archived,
  ]);

export interface PlanAutomationCandidate {
  type: string;
  status: TaskResponseDto["status"];
  archivedAt?: string | null;
}

export const isRelatedNonTerminalTaskMonitor = (
  monitor: PlanAutomationCandidate,
): boolean =>
  monitor.type === TASK_MONITOR_TYPE &&
  !monitor.archivedAt &&
  !TERMINAL_MONITOR_STATUSES.has(monitor.status);
