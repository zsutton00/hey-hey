import type { WorkItemTypeStatus } from "../../api/api";

const legacyStatusDefinitions = [
  {
    name: "GENERATED",
    meaning: { kind: "CUSTOM" as const, text: "Generated" },
  },
  { name: "BACKLOG", meaning: { kind: "CUSTOM" as const, text: "Backlog" } },
  { name: "READY", meaning: { kind: "CUSTOM" as const, text: "Ready" } },
  { name: "REFINING", meaning: { kind: "CUSTOM" as const, text: "Refining" } },
  { name: "BLOCKED", meaning: { kind: "CUSTOM" as const, text: "Blocked" } },
  {
    name: "REFINING_DESCRIPTION",
    meaning: { kind: "CUSTOM" as const, text: "Needs review" },
  },
  {
    name: "REFINING_DETAILS",
    meaning: { kind: "CUSTOM" as const, text: "Refining details" },
  },
  {
    name: "REFINING_ACCEPTANCE_CRITERIA",
    meaning: { kind: "CUSTOM" as const, text: "Refining criteria" },
  },
  {
    name: "GENERATING_DESCRIPTION",
    meaning: { kind: "CUSTOM" as const, text: "Generating description" },
  },
  {
    name: "GENERATING_DETAILS",
    meaning: { kind: "CUSTOM" as const, text: "Generating details" },
  },
  {
    name: "GENERATING_DESCRIPTION_AND_DETAILS",
    meaning: { kind: "CUSTOM" as const, text: "Generating content" },
  },
  {
    name: "GENERATING_ACCEPTANCE_CRITERIA",
    meaning: { kind: "CUSTOM" as const, text: "Generating criteria" },
  },
  {
    name: "GENERATING_ALL",
    meaning: { kind: "CUSTOM" as const, text: "Generating all" },
  },
  { name: "ACTIVE", meaning: { kind: "IN_PROGRESS" as const } },
  { name: "ON_HOLD", meaning: { kind: "CUSTOM" as const, text: "On Hold" } },
  { name: "VERIFYING", meaning: { kind: "IN_PROGRESS" as const } },
  { name: "COMPLETED", meaning: { kind: "COMPLETED" as const } },
  { name: "CANCELLED", meaning: { kind: "CANCELLED" as const } },
] satisfies WorkItemTypeStatus[];

export function legacyStatuses(names: readonly string[]): WorkItemTypeStatus[] {
  return names
    .filter((name) => name !== "ARCHIVED" && name !== "SUPERSEDED")
    .map((name) => {
      const status = legacyStatusDefinitions.find(
        (status) => status.name === name,
      );
      if (!status) {
        return { name, meaning: { kind: "CUSTOM" as const, text: name } };
      }
      return status;
    });
}
