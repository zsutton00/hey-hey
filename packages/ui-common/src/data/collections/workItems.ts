import type { MaterializedWorkItemSection, TaskResponseDto } from "../../api";

// Work items are now tasks only (initiatives removed)
export type WorkItemResponseDto = Omit<TaskResponseDto, "sections"> & {
  sections?: MaterializedWorkItemSection[];
};

const PLAN_WORK_ITEM_TYPE = "PLAN" as const;

export interface PlanWorkItem extends WorkItemResponseDto {
  type: typeof PLAN_WORK_ITEM_TYPE;
  parentTaskId: string;
}

/** @deprecated Initiatives removed. Always returns false. */
export function isInitiative(_workItem: WorkItemResponseDto): boolean {
  return false;
}

// Type guard to determine if work item is a task (always true now)
export function isTask(_workItem: WorkItemResponseDto): boolean {
  return true;
}

export function isPlanWorkItem(
  workItem: WorkItemResponseDto,
): workItem is PlanWorkItem {
  return (
    workItem.type === PLAN_WORK_ITEM_TYPE &&
    typeof workItem.parentTaskId === "string" &&
    workItem.parentTaskId.trim().length > 0
  );
}
