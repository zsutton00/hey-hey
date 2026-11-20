import type { WorkItemTypeStatus } from "../../api/api";

const legacyStatusDefinitions = [
  {
    name: "GENERATED",
    label: "Generated",
    meaning: "NOT_STARTED",
  },
  {
    name: "BACKLOG",
    label: "Backlog",
    meaning: "NOT_STARTED",
  },
  {
    name: "READY",
    label: "Ready",
    meaning: "NOT_STARTED",
  },
  {
    name: "REFINING",
    label: "Refining",
    meaning: "NOT_STARTED",
  },
  {
    name: "BLOCKED",
    label: "Blocked",
    meaning: "UNFINISHED",
  },
  {
    name: "REFINING_DESCRIPTION",
    label: "Needs review",
    meaning: "NOT_STARTED",
  },
  {
    name: "REFINING_DETAILS",
    label: "Refining details",
    meaning: "NOT_STARTED",
  },
  {
    name: "REFINING_ACCEPTANCE_CRITERIA",
    label: "Refining criteria",
    meaning: "NOT_STARTED",
  },
  {
    name: "GENERATING_DESCRIPTION",
    label: "Generating description",
    meaning: "NOT_STARTED",
  },
  {
    name: "GENERATING_DETAILS",
    label: "Generating details",
    meaning: "NOT_STARTED",
  },
  {
    name: "GENERATING_DESCRIPTION_AND_DETAILS",
    label: "Generating content",
    meaning: "NOT_STARTED",
  },
  {
    name: "GENERATING_ACCEPTANCE_CRITERIA",
    label: "Generating criteria",
    meaning: "NOT_STARTED",
  },
  {
    name: "GENERATING_ALL",
    label: "Generating all",
    meaning: "NOT_STARTED",
  },
  {
    name: "ACTIVE",
    label: "In progress",
    meaning: "IN_PROGRESS",
  },
  {
    name: "ON_HOLD",
    label: "On Hold",
    meaning: "UNFINISHED",
  },
  {
    name: "VERIFYING",
    label: "Verifying",
    meaning: "IN_PROGRESS",
  },
  {
    name: "COMPLETED",
    label: "Completed",
    meaning: "FINISHED",
    completionBehavior: "COMPLETED",
  },
  {
    name: "CANCELLED",
    label: "Cancelled",
    meaning: "FINISHED",
    completionBehavior: "CANCELLED",
  },
] satisfies WorkItemTypeStatus[];

export function legacyStatuses(names: readonly string[]): WorkItemTypeStatus[] {
  return names
    .filter((name) => name !== "ARCHIVED" && name !== "SUPERSEDED")
    .map((name) => {
      const status = legacyStatusDefinitions.find(
        (status) => status.name === name,
      );
      if (!status) {
        return { name, meaning: "UNFINISHED" };
      }
      return status;
    });
}
