import type { WorkItemResponseDto } from "../../data/collections/workItems";
import { getWorkItemSectionContent } from "../../utils/workItemSections";
import type { GoalSnapshot } from "./types";

type GoalSnapshotWorkItem = Pick<
  WorkItemResponseDto,
  "type" | "sections" | "dueDate" | "trackedEntities"
>;

export const getGoalSnapshotFromWorkItem = (
  workItem: GoalSnapshotWorkItem | null | undefined,
): GoalSnapshot | undefined =>
  workItem?.type === "GOAL"
    ? {
        description: getWorkItemSectionContent(
          workItem.sections,
          "description",
        ).trim(),
        ...(workItem.dueDate ? { dueDate: workItem.dueDate } : {}),
        ...(workItem.trackedEntities
          ? { trackedEntities: workItem.trackedEntities }
          : {}),
      }
    : undefined;

export const buildGoalEntityFields = (snapshot: GoalSnapshot) => ({
  taskType: "GOAL" as const,
  description: snapshot.description,
  ...(snapshot.dueDate ? { dueDate: snapshot.dueDate } : {}),
  ...(snapshot.trackedEntities
    ? { trackedEntities: snapshot.trackedEntities }
    : {}),
});
