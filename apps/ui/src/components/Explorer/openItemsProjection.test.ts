import { describe, expect, it } from "vitest";
import {
  collapseProjectedOpenItems,
  expandableProjectedOpenItemKeys,
  filterProjectedOpenItems,
  filterProjectedOpenItemsByActivity,
  projectOpenItems,
} from "./openItemsProjection";

const lineageEntry = (entityType: string, entityId: string) => ({
  entityId,
  entityType,
});

describe("projectOpenItems", () => {
  it.each(["BUG", "STANDARD"])(
    "nests a repaired %s session only beneath its open parent in the same explicit group",
    (taskType) => {
      const parent = {
        entityType: "task",
        entityId: "parent",
        groupId: "group-a",
        presentation: { kind: "task", label: "Parent", taskType },
      };
      const session = {
        entityType: "agent_session",
        entityId: "session",
        groupId: "group-a",
        lineage: [lineageEntry("task", "parent")],
      };
      const groups = [
        { id: "group-a", name: "Active", order: 0, collapsed: false },
      ];
      expect(
        projectOpenItems([session, parent], "oldest", undefined, groups).map(
          ({ item, depth }) => [item.entityId, depth]
        )
      ).toEqual([
        ["parent", 0],
        ["session", 1],
      ]);
      expect(
        projectOpenItems([session], "oldest", undefined, groups)[0]?.depth
      ).toBe(0);
      expect(
        projectOpenItems(
          [{ ...session, groupId: undefined }, parent],
          "oldest",
          undefined,
          groups
        ).find(({ item }) => item.entityId === "session")?.depth
      ).toBe(0);
    }
  );
  it("promotes surviving descendants when a visible ancestor is removed", () => {
    const projected = projectOpenItems([
      {
        entityId: "session-1",
        entityType: "agent_session",
        lineage: [
          lineageEntry("plan", "plan-1"),
          lineageEntry("task", "task-1"),
        ],
      },
      { entityId: "task-1", entityType: "task" },
    ]);

    expect(projected.map(({ item, depth }) => [item.entityId, depth])).toEqual([
      ["task-1", 0],
      ["session-1", 1],
    ]);
  });

  it("does not synthesize lineage entities that are not open items", () => {
    const projected = projectOpenItems([
      {
        entityId: "session-1",
        entityType: "agent_session",
        lineage: [
          lineageEntry("plan", "plan-1"),
          lineageEntry("plan_stage", "stage-1"),
          lineageEntry("plan_step", "step-1"),
        ],
      },
    ]);

    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      item: { entityId: "session-1" },
      depth: 0,
    });
  });

  it("renders pinned items first in first-added order and keeps unpinned order", () => {
    const projected = projectOpenItems([
      { entityId: "task-3", entityType: "task", firstAddedOrder: 3 },
      {
        entityId: "task-1",
        entityType: "task",
        firstAddedOrder: 1,
        pinned: true,
      },
      {
        entityId: "task-2",
        entityType: "task",
        firstAddedOrder: 2,
        pinned: true,
      },
      { entityId: "task-4", entityType: "task", firstAddedOrder: 4 },
    ]);

    expect(projected.map(({ item, group }) => [item.entityId, group])).toEqual([
      ["task-1", "pinned"],
      ["task-2", "pinned"],
      ["task-3", "unpinned"],
      ["task-4", "unpinned"],
    ]);
  });

  it("reverses first-added order within pinned and unpinned groups", () => {
    const items = [
      { entityId: "unpinned-old", entityType: "task" as const },
      {
        entityId: "pinned-old",
        entityType: "task" as const,
        firstAddedOrder: 2,
        pinned: true,
      },
      {
        entityId: "pinned-new",
        entityType: "task" as const,
        firstAddedOrder: 3,
        pinned: true,
      },
      { entityId: "unpinned-new", entityType: "task" as const },
    ];

    expect(
      projectOpenItems(items, "newest").map(({ item, group }) => [
        item.entityId,
        group,
      ]),
    ).toEqual([
      ["pinned-new", "pinned"],
      ["pinned-old", "pinned"],
      ["unpinned-new", "unpinned"],
      ["unpinned-old", "unpinned"],
    ]);
  });

  it("moves the newest branch first while keeping every visible ancestor above it", () => {
    const projected = projectOpenItems(
      [
        { entityId: "feature-old", entityType: "feature", firstAddedOrder: 1 },
        {
          entityId: "task-parent",
          entityType: "task",
          firstAddedOrder: 2,
          lineage: [lineageEntry("feature", "feature-old")],
        },
        { entityId: "task-new", entityType: "task", firstAddedOrder: 3 },
        {
          entityId: "session-newest",
          entityType: "agent_session",
          firstAddedOrder: 4,
          lineage: [
            lineageEntry("feature", "feature-old"),
            lineageEntry("task", "task-parent"),
          ],
        },
      ],
      "newest",
    );

    expect(projected.map(({ item, depth }) => [item.entityId, depth])).toEqual([
      ["feature-old", 0],
      ["task-parent", 1],
      ["session-newest", 2],
      ["task-new", 0],
    ]);
  });

  it("keeps lineage nesting within each pinned group", () => {
    const projected = projectOpenItems([
      {
        entityId: "task-1",
        entityType: "task",
        firstAddedOrder: 1,
        pinned: true,
      },
      {
        entityId: "session-1",
        entityType: "agent_session",
        firstAddedOrder: 2,
        pinned: true,
        lineage: [lineageEntry("task", "task-1")],
      },
    ]);

    expect(projected.map(({ item, depth }) => [item.entityId, depth])).toEqual([
      ["task-1", 0],
      ["session-1", 1],
    ]);
  });

  it("projects named groups first and preserves lineage inside each group", () => {
    const projected = projectOpenItems(
      [
        { entityId: "ungrouped", entityType: "task", firstAddedOrder: 1 },
        {
          entityId: "group-parent",
          entityType: "task",
          groupId: "group-a",
          firstAddedOrder: 2,
        },
        {
          entityId: "group-child",
          entityType: "agent_session",
          groupId: "group-a",
          firstAddedOrder: 3,
          lineage: [lineageEntry("task", "group-parent")],
        },
        {
          entityId: "later",
          entityType: "task",
          groupId: "group-b",
          firstAddedOrder: 4,
        },
      ],
      "oldest",
      undefined,
      [
        { id: "group-a", name: "Active", order: 0, collapsed: false },
        { id: "group-b", name: "Later", order: 1, collapsed: false },
      ],
    );

    expect(
      projected.map(({ item, depth, groupId }) => [item.entityId, depth, groupId]),
    ).toEqual([
      ["group-parent", 0, "group-a"],
      ["group-child", 1, "group-a"],
      ["later", 0, "group-b"],
      ["ungrouped", 0, undefined],
    ]);
  });

  it("keeps legacy pinned fallback order stable when explicit ranks collide", () => {
    const projected = projectOpenItems([
      { entityId: "task-1", entityType: "task", pinned: true },
      {
        entityId: "task-2",
        entityType: "task",
        firstAddedOrder: 1,
        pinned: true,
      },
    ]);

    expect(projected.map(({ item }) => item.entityId)).toEqual([
      "task-1",
      "task-2",
    ]);
  });

  it("computes each subtree rank once for 200 nested items", () => {
    const items = Array.from({ length: 200 }, (_, index) => {
      const groupOffset = index < 100 ? 0 : 100;
      const parentIndex = index === groupOffset ? null : index - 1;
      return {
        entityId: `task-${index}`,
        entityType: "task" as const,
        firstAddedOrder: index + 1,
        ...(groupOffset === 0 ? { pinned: true } : {}),
        ...(parentIndex === null
          ? {}
          : {
              lineage: [
                lineageEntry("task", `task-${parentIndex}`),
              ],
            }),
      };
    });
    const computedKeys: string[] = [];

    const projected = projectOpenItems(items, {
      onSubtreeRankComputed: (key) => computedKeys.push(key),
    });

    expect(projected).toHaveLength(200);
    expect(new Set(computedKeys)).toHaveLength(200);
    expect(computedKeys).toHaveLength(200);
    expect(projected.map(({ item }) => item.entityId)).toEqual(
      items.map((item) => item.entityId),
    );
  });

  it("identifies expandable branches and hides only their projected descendants", () => {
    const projected = projectOpenItems([
      {
        entityId: "feature-1",
        entityType: "task",
        presentation: { kind: "task", label: "Feature", taskType: "FEATURE" },
      },
      {
        entityId: "task-1",
        entityType: "task",
        lineage: [lineageEntry("task", "feature-1")],
        presentation: { kind: "task", label: "Task", taskType: "STANDARD" },
      },
      {
        entityId: "session-1",
        entityType: "agent_session",
        lineage: [
          lineageEntry("task", "feature-1"),
          lineageEntry("task", "task-1"),
        ],
        presentation: { kind: "agent_session", label: "Session" },
      },
      { entityId: "task-2", entityType: "task" },
    ]);

    expect([...expandableProjectedOpenItemKeys(projected)]).toEqual([
      "task:feature-1",
      "task:task-1",
    ]);
    expect(
      collapseProjectedOpenItems(projected, new Set(["task:task-1"])).map(
        ({ item }) => item.entityId,
      ),
    ).toEqual(["feature-1", "task-1", "task-2"]);
  });
});

describe("filterProjectedOpenItems", () => {
  it("matches trimmed labels case-insensitively and restores the projection for blank input", () => {
    const projected = projectOpenItems([
      {
        entityId: "task-1",
        entityType: "task",
        presentation: { kind: "task", label: "Investigate Search" },
      },
      {
        entityId: "task-2",
        entityType: "task",
        presentation: { kind: "task", label: "Ship Results" },
      },
    ]);

    expect(
      filterProjectedOpenItems(projected, "  SEARCH ").map(
        ({ item }) => item.entityId,
      ),
    ).toEqual(["task-1"]);
    expect(filterProjectedOpenItems(projected, "   ")).toBe(projected);
  });

  it("retains only already-open ancestors for matching descendants", () => {
    const projected = projectOpenItems([
      {
        entityId: "plan-1",
        entityType: "plan",
        presentation: { kind: "plan", label: "Importer" },
      },
      {
        entityId: "task-1",
        entityType: "task",
        lineage: [lineageEntry("plan", "plan-1")],
        presentation: { kind: "task", label: "Normalize records" },
      },
      {
        entityId: "session-1",
        entityType: "agent_session",
        lineage: [
          lineageEntry("plan", "plan-1"),
          lineageEntry("task", "task-1"),
        ],
        presentation: { kind: "agent_session", label: "Run importer" },
      },
      {
        entityId: "session-2",
        entityType: "agent_session",
        lineage: [lineageEntry("plan", "missing-plan")],
        presentation: { kind: "agent_session", label: "Unrelated session" },
      },
    ]);

    const filtered = filterProjectedOpenItems(projected, "run");

    expect(filtered.map(({ item, depth }) => [item.entityId, depth])).toEqual([
      ["plan-1", 0],
      ["task-1", 1],
      ["session-1", 2],
    ]);
  });

  it("fails closed when a stable label is missing and preserves projected order", () => {
    const projected = projectOpenItems([
      {
        entityId: "task-2",
        entityType: "task",
        firstAddedOrder: 2,
        presentation: { kind: "task", label: "Second" },
      },
      { entityId: "task-1", entityType: "task", firstAddedOrder: 1 },
    ], "newest");

    expect(
      filterProjectedOpenItems(projected, "second").map(
        ({ item }) => item.entityId,
      ),
    ).toEqual(["task-2"]);
  });
});

describe("filterProjectedOpenItemsByActivity", () => {
  it("keeps active sessions with their lineage and counts every hidden row", () => {
    const projected = projectOpenItems([
      { entityId: "feature-1", entityType: "feature" },
      {
        entityId: "task-1",
        entityType: "task",
        lineage: [lineageEntry("feature", "feature-1")],
      },
      {
        entityId: "active",
        entityType: "agent_session",
        lineage: [lineageEntry("feature", "feature-1"), lineageEntry("task", "task-1")],
      },
      {
        entityId: "task-2",
        entityType: "task",
        lineage: [lineageEntry("feature", "feature-1")],
      },
      {
        entityId: "idle",
        entityType: "agent_session",
        lineage: [lineageEntry("feature", "feature-1"), lineageEntry("task", "task-2")],
      },
      { entityId: "task-3", entityType: "task", pinned: true },
    ]);

    const result = filterProjectedOpenItemsByActivity(
      projected,
      (item) => item.entityId === "active",
    );

    expect(result.items.map(({ item, depth }) => [item.entityId, depth])).toEqual([
      ["feature-1", 0],
      ["task-1", 1],
      ["active", 2],
    ]);
    expect(result.hiddenCount).toBe(3);
  });
});
