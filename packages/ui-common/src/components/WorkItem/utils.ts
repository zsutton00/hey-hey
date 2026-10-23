import type { TaskResponseDto } from "../../api";

export interface CountItem {
  label: string;
  count: number;
  pluralizable?: boolean;
}

export type CountGroup = CountItem[];

export function getWorkItemCounts(workItem: {
  childCounts?: TaskResponseDto["childCounts"];
}) {
  if (
    workItem.childCounts &&
    workItem.childCounts.total &&
    workItem.childCounts.total > 0
  ) {
    const countGroups: CountGroup[] = [];
    const taskGroup: CountGroup = [];
    const { total, done, inProgress = 0, backlog = 0 } = workItem.childCounts;

    taskGroup.push({ label: `tasks`, count: total });
    if (inProgress > 0)
      taskGroup.push({
        label: `active`,
        count: inProgress,
        pluralizable: false,
      });
    if (backlog > 0)
      taskGroup.push({ label: `backlog`, count: backlog, pluralizable: false });
    if (done && done > 0) taskGroup.push({ label: `complete`, count: done });

    countGroups.push(taskGroup);

    return countGroups;
  }
}
