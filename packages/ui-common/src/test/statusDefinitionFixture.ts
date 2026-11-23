import type { WorkItemTypeDefinitionDto } from "../api/api";
import { getStatusLabel } from "../utils/statusUtils";

/**
 * The slice of an effective type definition that status UI reads. Names keep
 * the familiar platform labels, as migrated types do; ARCHIVED stays out of
 * the ordinary list and SUPERSEDED is a capability.
 */
export const statusDefinition = (
  names: readonly string[],
  overrides: Partial<WorkItemTypeDefinitionDto> = {},
): WorkItemTypeDefinitionDto =>
  ({
    key: "STANDARD",
    name: "Task",
    statuses: names
      .filter((name) => name !== "ARCHIVED" && name !== "SUPERSEDED")
      .map((name) => ({
        name,
        meaning: { kind: "CUSTOM" as const, text: getStatusLabel(name) },
      })),
    capabilities: { supportsSupersession: names.includes("SUPERSEDED") },
    ...overrides,
  }) as WorkItemTypeDefinitionDto;
