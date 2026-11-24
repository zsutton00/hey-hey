import type { WorkItemStatusMeaning } from "../api";

/** Finished means Completed or Cancelled; every other meaning is not finished. */
export const isFinishedMeaning = (
  meaning: WorkItemStatusMeaning | undefined,
): boolean => meaning?.kind === "COMPLETED" || meaning?.kind === "CANCELLED";

/** Work is underway only for the built-in In progress meaning. */
export const isInProgressMeaning = (
  meaning: WorkItemStatusMeaning | undefined,
): boolean => meaning?.kind === "IN_PROGRESS";

/** The meaning as a person reads it: a built-in name or their own words. */
export const describeStatusMeaning = (
  meaning: WorkItemStatusMeaning,
): string => {
  switch (meaning.kind) {
    case "COMPLETED":
      return "Completed";
    case "CANCELLED":
      return "Cancelled";
    case "IN_PROGRESS":
      return "In progress";
    case "CUSTOM":
      return meaning.text ?? "";
  }
};
