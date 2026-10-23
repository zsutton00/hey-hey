import { expect, it } from "vitest";
import { buildTaskNavigationLineage } from "./taskNavigationLineage";
it("keeps canonical Plan tasks nested without a duplicate Step identity", () => {
  expect(
    buildTaskNavigationLineage({
      taskId: "task-1",
      parentTaskId: "stage-1",
      planId: "plan-1",
      stageId: "stage-1",
    })
  ).toEqual([
    { entityType: "task", entityId: "plan-1" },
    { entityType: "task", entityId: "stage-1" },
    { entityType: "task", entityId: "task-1" },
  ]);
});
