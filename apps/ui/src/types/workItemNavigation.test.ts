import {
  WorkItemTypeRole,
  type WorkItemTypeDefinitionDto,
} from "@hey-hey/ui-common/api";
import { describe, expect, it } from "vitest";
import {
  buildWorkItemRoleNavigationGroups,
  getWorkItemRoleNavigationTooltip,
  resolveWorkItemRoleNavigationTypeKey,
} from "./workItemNavigation";

const definition = (
  key: string,
  name: string,
  role: WorkItemTypeRole,
): WorkItemTypeDefinitionDto =>
  ({ key, name, role, sections: [], allowedStatuses: [] }) as WorkItemTypeDefinitionDto;

describe("workItemNavigation", () => {
  it("groups only visible registry definitions and counts definitions, not records", () => {
    const definitions = new Map([
      ["BUG", definition("BUG", "Bug", WorkItemTypeRole.WorkItem)],
      ["STANDARD", definition("STANDARD", "Task", WorkItemTypeRole.WorkItem)],
      [
        "DESIGN_DOC",
        definition("DESIGN_DOC", "Design Doc", WorkItemTypeRole.ProjectInfo),
      ],
    ]);

    expect(
      buildWorkItemRoleNavigationGroups(definitions, [
        "STANDARD",
        "BUG",
        "MISSING",
      ]),
    ).toEqual([
      {
        role: WorkItemTypeRole.WorkItem,
        label: "Work Items",
        items: [
          { key: "STANDARD", label: "Tasks", role: WorkItemTypeRole.WorkItem },
          { key: "BUG", label: "Bugs", role: WorkItemTypeRole.WorkItem },
        ],
      },
    ]);
  });

  it("resolves role/type URL state while preserving legacy child links", () => {
    const groups = buildWorkItemRoleNavigationGroups(
      new Map([
        ["BUG", definition("BUG", "Bug", WorkItemTypeRole.WorkItem)],
        [
          "STANDARD",
          definition("STANDARD", "Task", WorkItemTypeRole.WorkItem),
        ],
      ]),
      ["BUG", "STANDARD"],
    );

    expect(
      resolveWorkItemRoleNavigationTypeKey(
        groups,
        WorkItemTypeRole.WorkItem,
        "BUG",
      ),
    ).toBe("BUG");
    expect(
      resolveWorkItemRoleNavigationTypeKey(groups, "children:STANDARD", null),
    ).toBe("STANDARD");
    expect(resolveWorkItemRoleNavigationTypeKey(groups, "task", "BUG")).toBe(
      undefined,
    );
  });

  it("defaults the work-item role to Standard when no valid subtype is selected", () => {
    const groups = buildWorkItemRoleNavigationGroups(
      new Map([
        ["BUG", definition("BUG", "Bug", WorkItemTypeRole.WorkItem)],
        [
          "STANDARD",
          definition("STANDARD", "Task", WorkItemTypeRole.WorkItem),
        ],
      ]),
      ["BUG", "STANDARD"],
    );

    expect(
      resolveWorkItemRoleNavigationTypeKey(
        groups,
        WorkItemTypeRole.WorkItem,
        null,
      ),
    ).toBe("STANDARD");
    expect(
      resolveWorkItemRoleNavigationTypeKey(
        groups,
        WorkItemTypeRole.WorkItem,
        "ARCHIVED",
      ),
    ).toBe("STANDARD");
    expect(
      resolveWorkItemRoleNavigationTypeKey(
        groups,
        WorkItemTypeRole.WorkItem,
        "BUG",
      ),
    ).toBe("BUG");
  });

  it("falls back to the first visible type when Standard is unavailable", () => {
    const groups = buildWorkItemRoleNavigationGroups(
      new Map([
        ["BUG", definition("BUG", "Bug", WorkItemTypeRole.WorkItem)],
        [
          "CUSTOM",
          definition("CUSTOM", "Custom", WorkItemTypeRole.WorkItem),
        ],
      ]),
      ["BUG", "CUSTOM"],
    );

    expect(
      resolveWorkItemRoleNavigationTypeKey(
        groups,
        WorkItemTypeRole.WorkItem,
        null,
      ),
    ).toBe("BUG");
  });

  it("formats a role tooltip from the visible type labels", () => {
    expect(
      getWorkItemRoleNavigationTooltip([
        { label: "Tasks" },
        { label: "Bugs" },
      ]),
    ).toBe("Types: Tasks, Bugs");
  });
});
