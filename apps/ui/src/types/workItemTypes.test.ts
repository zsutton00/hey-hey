import type {
  WorkItemTypeDefinitionDto,
  WorkItemTypeSummaryDto,
} from "@hey-hey/ui-common/api";
import { WorkItemTypeRole } from "@hey-hey/ui-common/api";
import { describe, expect, it } from "vitest";
import {
  canWorkItemTypeOwnAgentSessions,
  indexWorkItemTypeDefinitions,
  selectActiveWorkItemTypeDefinitions,
} from "./workItemTypes";

const definition = (
  key: string,
  overrides: Partial<WorkItemTypeDefinitionDto> = {},
): WorkItemTypeDefinitionDto =>
  ({
    key,
    name: key,
    sections: [],
    allowedStatuses: [],
    role: WorkItemTypeRole.WorkItem,
    ...overrides,
  }) as WorkItemTypeDefinitionDto;

const summary = (
  key: string,
  status: WorkItemTypeSummaryDto["status"],
  projectId: string | null,
): WorkItemTypeSummaryDto =>
  ({
    definition: definition(key),
    status,
    projectId,
  }) as unknown as WorkItemTypeSummaryDto;

describe("work-item type definition selectors", () => {
  it("selects active current-project definitions only", () => {
    const summaries = [
      summary("STANDARD", "ACTIVE", null),
      summary("ACTIVE_CUSTOM", "ACTIVE", "project-1"),
      summary("ARCHIVED_CUSTOM", "ARCHIVED", "project-1"),
      summary("OTHER_PROJECT", "ACTIVE", "project-2"),
    ];

    const active = selectActiveWorkItemTypeDefinitions(summaries, "project-1");

    expect([...active.keys()]).toEqual(["ACTIVE_CUSTOM"]);
    expect(active.get("ACTIVE_CUSTOM")).toEqual(
      expect.objectContaining({ key: "ACTIVE_CUSTOM" }),
    );
  });

  it("does not select any definitions without an authoritative project", () => {
    const summaries = [
      summary("STANDARD", "ACTIVE", null),
      summary("ACTIVE_CUSTOM", "ACTIVE", "project-1"),
    ];

    expect([
      ...selectActiveWorkItemTypeDefinitions(summaries).keys(),
    ]).toEqual([]);
    expect([
      ...selectActiveWorkItemTypeDefinitions(summaries, "").keys(),
    ]).toEqual([]);
  });

  it("keeps archived definitions available in the all-definition index", () => {
    const archived = summary("ARCHIVED_CUSTOM", "ARCHIVED", "project-1");

    expect(indexWorkItemTypeDefinitions([archived]).get("ARCHIVED_CUSTOM")).toBe(
      archived.definition,
    );
    expect(
      selectActiveWorkItemTypeDefinitions([archived], "project-1").has(
        "ARCHIVED_CUSTOM",
      ),
    ).toBe(false);
  });
});

describe("canWorkItemTypeOwnAgentSessions", () => {
  it.each(["STANDARD", "BUG", "CUSTOM_WORK_ITEM"])(
    "allows the %s work-item role without a type-key allow-list",
    (key) => {
      expect(canWorkItemTypeOwnAgentSessions(definition(key))).toBe(true);
    },
  );

  it("rejects non-work-item roles even when an unrelated capability is enabled", () => {
    expect(
      canWorkItemTypeOwnAgentSessions(
        definition("FEATURE", {
          role: WorkItemTypeRole.ProjectInfo,
          capabilities: { planEligible: true },
        }),
      ),
    ).toBe(false);
  });

  it("fails closed when the resolved definition is unavailable", () => {
    expect(canWorkItemTypeOwnAgentSessions(undefined)).toBe(false);
  });
});
