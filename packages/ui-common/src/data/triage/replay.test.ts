import { describe, expect, it } from "vitest";
import {
  EntityType,
  type OpenItem,
  type OpenItemsTriageItem,
  type OpenItemsTriageSuggestion,
} from "../../api";
import { replayTriage, resolveSelection } from "./replay";

const ref = (id: string): OpenItemsTriageItem => ({
  entityType: EntityType.Task,
  entityId: id,
  title: `Item ${id}`,
});
function row(
  id: string,
  extra: Partial<Pick<OpenItem, "groupId" | "pinned">> & {
    lineage?: string[];
  } = {},
): OpenItem {
  return {
    entityType: EntityType.Task,
    entityId: id,
    groupId: extra.groupId ?? null,
    pinned: extra.pinned ?? false,
    lineage: (extra.lineage ?? []).map((entityId) => ({
      entityType: EntityType.Task,
      entityId,
    })),
    presentation: { label: `Item ${id}` },
  } as OpenItem;
}
const base = { rationale: "why", evidence: [] };
const remove = (id: string, ids: string[]): OpenItemsTriageSuggestion => ({
  ...base,
  suggestionId: id,
  kind: "removeOpenItems",
  items: ids.map(ref),
});
const reopen = (id: string, ids: string[]): OpenItemsTriageSuggestion => ({
  ...base,
  suggestionId: id,
  kind: "reopenItems",
  items: ids.map(ref),
});
const group = (
  id: string,
  ids: string[],
  target: { existing: string } | { name: string },
): OpenItemsTriageSuggestion => ({
  ...base,
  suggestionId: id,
  kind: "groupOpenItems",
  items: ids.map(ref),
  group:
    "existing" in target
      ? { kind: "existingGroup", groupId: target.existing, name: "Existing" }
      : { kind: "newGroup", newGroupName: target.name },
});
const many = (count: number) =>
  Array.from({ length: count }, (_, i) => row(`f${i}`));

describe("triage replay", () => {
  it("removes items with eligible descendants, keeping pinned ones, and counts totals", () => {
    const items = [
      row("a"),
      row("child", { lineage: ["a"] }),
      row("pinned-child", { lineage: ["a"], pinned: true }),
      row("other"),
    ];
    const preview = replayTriage({
      items,
      groups: [],
      suggestions: [remove("r", ["a"])],
      accepted: ["r"],
    });
    expect(preview.before.map((r) => r.key)).toEqual(["TASK:a", "TASK:child"]);
    expect(preview.after).toEqual([]);
    expect(preview.totals).toMatchObject({ before: 4, after: 2, removed: 2 });
    expect(preview.unchangedCount).toBe(2);
    expect(preview.ribbons.every((r) => r.to === null)).toBe(true);
  });

  it("groups items into a new group that converges and preserves the count", () => {
    const preview = replayTriage({
      items: [row("a"), row("b"), row("c")],
      groups: [],
      suggestions: [group("g", ["a", "b"], { name: "Docs" })],
      accepted: ["g"],
    });
    expect(preview.totals).toMatchObject({
      before: 3,
      after: 3,
      groupsCreated: 1,
      removed: 0,
    });
    expect(preview.after[0]).toMatchObject({
      isGroup: true,
      provisional: true,
    });
    expect(preview.ribbons.map((r) => r.to)).toEqual([1, 2]);
  });

  it("treats already satisfied outcomes as no-ops and warns on conflicts", () => {
    const items = [row("a", { groupId: "g1" }), row("b", { groupId: "other" })];
    const preview = replayTriage({
      items,
      groups: [
        { groupId: "g1", name: "One" },
        { groupId: "other", name: "Other" },
      ],
      suggestions: [
        group("g", ["a", "b"], { existing: "g1" }),
        remove("r", ["gone"]),
      ],
      accepted: ["g", "r"],
      baselineFor: (_s, item) =>
        item.entityId === "b"
          ? { open: true, groupId: null, pinned: false }
          : undefined,
    });
    expect(preview.before).toEqual([]);
    expect(preview.warnings.map((w) => w.itemKey)).toEqual(["TASK:b"]);
  });

  it("skips reopens at capacity, fills the last slot, and lets earlier removals make room", () => {
    const run = (count: number, suggestions: OpenItemsTriageSuggestion[]) =>
      replayTriage({
        items: many(count),
        groups: [],
        suggestions,
        accepted: suggestions.map((s) => s.suggestionId),
      });
    const full = run(100, [reopen("o", ["x"])]);
    expect(full.totals.after).toBe(100);
    expect(full.warnings[0].message).toMatch(/full/);
    const last = run(99, [reopen("o", ["x", "y"])]);
    expect(last.totals.after).toBe(100);
    expect(last.warnings).toHaveLength(1);
    const room = replayTriage({
      items: many(100),
      groups: [],
      suggestions: [remove("r", ["f0"]), reopen("o", ["x"])],
      accepted: ["r", "o"],
    });
    expect(room.warnings).toEqual([]);
    expect(room.totals.after).toBe(100);
    const open = run(100, [reopen("o", ["f1"])]);
    expect(open.warnings).toEqual([]);
  });

  it("labels tracking on the existing row", () => {
    const preview = replayTriage({
      items: [row("a")],
      groups: [],
      suggestions: [
        {
          ...base,
          suggestionId: "t",
          kind: "trackOnGoal",
          items: [ref("a")],
          goal: { kind: "existingGoal", goalId: "g", title: "Launch" },
        },
      ],
      accepted: ["t"],
    });
    expect(preview.before[0]).toMatchObject({ change: "tracked" });
    expect(preview.after[0]).toMatchObject({ trackedOn: "Launch" });
    expect(preview.totals).toMatchObject({ before: 1, after: 1 });
  });

  it("promotes a group: eligible members leave, others ungroup, a pinned Goal appears", () => {
    const preview = replayTriage({
      items: [row("a", { groupId: "g" }), row("b", { groupId: "g" }), row("c")],
      groups: [{ groupId: "g", name: "Launch" }],
      suggestions: [
        {
          ...base,
          suggestionId: "p",
          kind: "promoteGroupToGoal",
          groupId: "g",
          groupName: "Launch",
          goalName: "Ship",
          affectedMembers: [ref("a")],
        },
      ],
      accepted: ["p"],
    });
    expect(preview.unverified).toHaveLength(1);
    expect(preview.totals).toMatchObject({
      before: 3,
      after: 3,
      removed: 0,
      goalsCreated: 1,
      goalMembersLeaving: 1,
      goalMembersUngrouped: 1,
    });
    expect(preview.after.find((r) => r.change === "goal")).toMatchObject({
      title: "Ship",
      pinned: true,
      provisional: true,
    });
    expect(preview.after.find((r) => r.key === "TASK:b")?.change).toBe(
      "ungrouped",
    );
  });

  it("warns when a promoted group is missing", () => {
    const preview = replayTriage({
      items: [row("a")],
      groups: [],
      suggestions: [
        {
          ...base,
          suggestionId: "p",
          kind: "promoteGroupToGoal",
          groupId: "gone",
          groupName: "Gone",
          goalName: "Ship",
          affectedMembers: [ref("a")],
        },
      ],
      accepted: ["p"],
    });
    expect(preview.warnings).toHaveLength(1);
    expect(preview.after).toEqual([]);
  });

  it("blocks competing suggestions with the holder and restores them when unaccepted", () => {
    const s = [remove("r", ["a"]), group("g", ["a", "b"], { name: "X" })];
    const items = [row("a"), row("b")];
    const held = resolveSelection(s, new Set(["r"]), items);
    expect(held.accepted).toEqual(["r"]);
    expect(held.blocked.get("g")).toMatchObject({
      blockedBy: "r",
      itemTitle: "Item a",
    });
    expect(resolveSelection(s, new Set(), items).blocked.size).toBe(0);
  });

  it("keeps the earlier acceptance when live membership creates an overlap", () => {
    const promote: OpenItemsTriageSuggestion = {
      ...base,
      suggestionId: "p",
      kind: "promoteGroupToGoal",
      groupId: "g",
      groupName: "G",
      goalName: "Goal",
      affectedMembers: [ref("a")],
    };
    const s = [remove("r", ["m"]), promote];
    const items = [row("m", { groupId: "g" }), row("a", { groupId: "g" })];
    const result = resolveSelection(s, new Set(["r", "p"]), items);
    expect(result.accepted).toEqual(["r"]);
    expect(result.blocked.has("p")).toBe(true);
  });

  it("reaches every changed row in a 100-item cleanup", () => {
    const items = many(100);
    const preview = replayTriage({
      items,
      groups: [],
      suggestions: [
        remove(
          "r",
          items.map((i) => i.entityId),
        ),
      ],
      accepted: ["r"],
    });
    expect(preview.before).toHaveLength(100);
    expect(preview.totals).toMatchObject({ after: 0, removed: 100 });
  });

  it("shows not-accepted suggestions as dashed rows without counting them", () => {
    const items = [row("a"), row("b"), row("c")];
    const suggestions = [remove("r", ["a"]), reopen("o", ["x"])];
    const preview = replayTriage({
      items,
      groups: [],
      suggestions,
      accepted: [],
    });
    expect(preview.totals).toMatchObject({ before: 3, after: 3, removed: 0 });
    expect(preview.before).toHaveLength(1);
    expect(preview.before[0]).toMatchObject({
      change: "pending",
      note: "Remove? not accepted",
    });
    expect(preview.after.map((r) => r.change)).toEqual([
      "unchanged",
      "pending",
    ]);
    expect(preview.ribbons[0].change).toBe("pending");
    expect(preview.unchangedCount).toBe(2);
    const hidden = replayTriage({
      items,
      groups: [],
      suggestions,
      accepted: [],
      hidePending: new Set(["r", "o"]),
    });
    expect(hidden.before).toEqual([]);
  });

  describe("layout", () => {
    type Row = ReturnType<typeof replayTriage>["layout"]["before"][number];
    const describeRow = (row: Row) =>
      row.kind === "fold"
        ? `fold ${row.count}`
        : `${row.depth ? "  " : ""}${row.key} ${row.marker?.kind ?? "-"}`;

    it("folds unchanged runs in original order on both sides and joins them", () => {
      const preview = replayTriage({
        items: [row("a"), row("u1"), row("u2"), row("b"), row("u3")],
        groups: [],
        suggestions: [remove("r", ["a"]), group("g", ["b"], { name: "New" })],
        accepted: ["r", "g"],
      });
      const { before, after, flows } = preview.layout;
      expect(before.map(describeRow)).toEqual([
        "TASK:a remove",
        "fold 2",
        "TASK:b group",
        "fold 1",
      ]);
      expect(after.map(describeRow)).toEqual([
        "fold 2",
        "group:new-group:g newGroup",
        "  TASK:b -",
        "fold 1",
      ]);
      // The removed item ends in a ✕; folds and moved rows run across.
      expect(flows).toEqual(
        expect.arrayContaining([
          { from: 0, to: null, tone: "removed", dashed: false },
          { from: 1, to: 0, tone: "same", dashed: false },
          { from: 2, to: 2, tone: "moved", dashed: false },
          { from: 3, to: 3, tone: "same", dashed: false },
          { from: null, to: 1, tone: "new", dashed: false },
        ]),
      );
    });

    it("pins the provisional Goal first and sends leaving members to it", () => {
      const preview = replayTriage({
        items: [
          row("u"),
          row("a", { groupId: "g" }),
          row("b", { groupId: "g" }),
        ],
        groups: [{ groupId: "g", name: "Launch" }],
        suggestions: [
          {
            ...base,
            suggestionId: "p",
            kind: "promoteGroupToGoal",
            groupId: "g",
            groupName: "Launch",
            goalName: "Ship",
            affectedMembers: [ref("a")],
          },
        ],
        accepted: ["p"],
      });
      const { before, after, flows } = preview.layout;
      expect(before.map(describeRow)).toEqual([
        "fold 1",
        "group:g promoteGroup",
        "  TASK:a goalLeaves",
        "  TASK:b ungrouped",
      ]);
      expect(after.map(describeRow)).toEqual([
        "new-goal:p pinnedGoal",
        "fold 1",
        "TASK:b ungrouped",
      ]);
      expect(flows).toEqual(
        expect.arrayContaining([
          { from: 1, to: 0, tone: "goal", dashed: false },
          { from: 2, to: 0, tone: "goal", dashed: false },
          { from: 3, to: 2, tone: "moved", dashed: false },
        ]),
      );
    });

    it("labels tracking on the existing row and shows unaccepted work dashed", () => {
      const preview = replayTriage({
        items: [row("a"), row("b")],
        groups: [],
        suggestions: [
          {
            ...base,
            suggestionId: "t",
            kind: "trackOnGoal",
            items: [ref("a")],
            goal: { kind: "existingGoal", goalId: "goal", title: "Launch" },
          },
          remove("r", ["b"]),
          reopen("o", ["z"]),
        ],
        accepted: ["t"],
      });
      const { before, after, flows } = preview.layout;
      expect(before.map(describeRow)).toEqual([
        "TASK:a tracked",
        "TASK:b pending",
      ]);
      expect(after.map(describeRow)).toEqual([
        "TASK:a tracked",
        "TASK:b -",
        "ghost:TASK:z pending",
      ]);
      expect(flows).toEqual(
        expect.arrayContaining([
          { from: 1, to: 1, tone: "same", dashed: true },
          { from: null, to: 2, tone: "new", dashed: true },
        ]),
      );
      expect(preview.totals).toMatchObject({ before: 2, after: 2, removed: 0 });
    });

    it("keeps every changed row in a 100-item cleanup", () => {
      const items = many(100);
      const preview = replayTriage({
        items,
        groups: [],
        suggestions: [
          remove(
            "r",
            items.filter((_, i) => i % 2 === 0).map((r) => r.entityId),
          ),
        ],
        accepted: ["r"],
      });
      const changed = preview.layout.before.filter((r) => r.kind === "item");
      expect(changed).toHaveLength(50);
      expect(preview.layout.before).toHaveLength(100);
      expect(preview.totals).toMatchObject({ before: 100, after: 50 });
    });
  });
});
