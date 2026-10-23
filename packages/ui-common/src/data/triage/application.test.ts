import { describe, expect, it, vi } from "vitest";
import {
  EntityType,
  type OpenItemsTriageItem,
  type OpenItemsTriageSuggestion,
} from "../../api";
import {
  TriageApplicationCoordinator,
  type TriageApplicationPorts,
  type TriageTarget,
} from "./application";

const a: OpenItemsTriageItem = {
  entityType: EntityType.Task,
  entityId: "a",
  title: "First task",
};
const b: OpenItemsTriageItem = { ...a, entityId: "b", title: "Second task" };
const base = {
  suggestionId: "suggestion",
  rationale: "Related work",
  evidence: [{ kind: "attention" as const, summary: "Viewed together" }],
};
const remove: OpenItemsTriageSuggestion = {
  ...base,
  kind: "removeOpenItems",
  items: [a, b],
};
function setup() {
  const targets = new Map<string, TriageTarget>([
    ["a", { open: true, groupId: null, pinned: false }],
    ["b", { open: true, groupId: null, pinned: false }],
  ]);
  const groups = new Set(["existing"]);
  const ports: TriageApplicationPorts = {
    refresh: vi.fn().mockResolvedValue(undefined),
    target: (item) => ({ ...targets.get(item.entityId)! }),
    groupExists: (id) => groups.has(id),
    remove: vi.fn(async (item) => {
      targets.set(item.entityId, { open: false, groupId: null, pinned: false });
    }),
    reopen: vi.fn(async (item) => {
      targets.set(item.entityId, { open: true, groupId: null, pinned: false });
    }),
    createGroup: vi.fn(async () => {
      groups.add("new-group");
      return "new-group";
    }),
    group: vi.fn(async (item, groupId) => {
      targets.set(item.entityId, { open: true, groupId, pinned: false });
    }),
    createGoal: vi.fn().mockResolvedValue("created-goal"),
    track: vi.fn().mockResolvedValue(undefined),
    promote: vi.fn().mockResolvedValue("success"),
    revalidateGoals: vi.fn().mockResolvedValue(undefined),
  };
  return {
    targets,
    groups,
    ports,
    owner: new TriageApplicationCoordinator(ports),
  };
}
describe("triage manual application coordinator", () => {
  it.each(["collection", "Goals", "both"])(
    "preserves completed work and independent suggestions after %s refresh failure",
    async (failure) => {
      const { owner, ports } = setup();
      const first = { ...remove, items: [a] };
      if (failure !== "Goals")
        vi.mocked(ports.refresh)
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new Error("collection unavailable"));
      if (failure !== "collection")
        vi.mocked(ports.revalidateGoals).mockRejectedValueOnce(
          new Error("Goals unavailable"),
        );
      const independent = {
        ...remove,
        suggestionId: "independent",
        items: [b],
      };
      await owner.applyAll("reply", [first, independent]);
      expect(ports.revalidateGoals).toHaveBeenCalledTimes(2);
      expect(ports.refresh).toHaveBeenCalledTimes(6);
      expect(owner.outcome("reply", first)).toMatchObject({
        state: "success",
        items: [{ item: a, state: "success" }],
        error: expect.stringContaining("unavailable"),
      });
      expect(owner.outcome("reply", independent).state).toBe("success");
      await owner.apply("reply", first);
      expect(ports.remove).toHaveBeenCalledTimes(2);
    },
  );
  it("observing a reply has no collection, Goal, or confirmation side effects", () => {
    const { owner, ports } = setup();
    owner.observe("reply", remove);
    expect(ports.refresh).not.toHaveBeenCalled();
    expect(ports.remove).not.toHaveBeenCalled();
    expect(ports.createGoal).not.toHaveBeenCalled();
    expect(ports.promote).not.toHaveBeenCalled();
  });
  it("shows pending and independent partial outcomes, then retries only unfinished removal with the same key", async () => {
    const { owner, ports } = setup();
    vi.mocked(ports.remove)
      .mockImplementationOnce(async () => {})
      .mockRejectedValueOnce(new Error("Cannot remove second"));
    const run = owner.apply("reply", remove);
    expect(owner.outcome("reply", remove).state).toBe("pending");
    await run;
    expect(
      owner.outcome("reply", remove).items.map((item) => item.state),
    ).toEqual(["success", "failure"]);
    const key = vi.mocked(ports.remove).mock.calls[1][1];
    await owner.apply("reply", remove);
    expect(ports.remove).toHaveBeenCalledTimes(3);
    expect(vi.mocked(ports.remove).mock.calls[2]).toEqual([b, key]);
    expect(owner.outcome("reply", remove).state).toBe("success");
    expect(ports.revalidateGoals).toHaveBeenCalledTimes(2);
  });
  it("accepts already removed or reopened items as no-ops despite unrelated collection changes", async () => {
    const { owner, ports, targets } = setup();
    owner.observe("reply", remove);
    targets.set("a", { open: false, groupId: null, pinned: false });
    await owner.apply("reply", { ...remove, items: [a] });
    expect(ports.remove).not.toHaveBeenCalled();
    const reopen: OpenItemsTriageSuggestion = {
      ...base,
      suggestionId: "reopen",
      kind: "reopenItems",
      items: [a, b],
    };
    await owner.apply("reply", reopen);
    expect(ports.reopen).toHaveBeenCalledTimes(1);
    expect(ports.reopen).toHaveBeenCalledWith(a, expect.any(String));
  });
  it("warns on interim moves while grouping independent items and accepting the same destination", async () => {
    const { owner, ports, targets } = setup();
    const group: OpenItemsTriageSuggestion = {
      ...base,
      kind: "groupOpenItems",
      group: { kind: "existingGroup", groupId: "existing", name: "Existing" },
      items: [a, b],
    };
    owner.observe("reply", group);
    targets.set("a", { open: true, groupId: "elsewhere", pinned: false });
    await owner.apply("reply", group);
    expect(ports.group).toHaveBeenCalledTimes(1);
    expect(owner.outcome("reply", group).state).toBe("failure");
    targets.set("a", { open: true, groupId: "existing", pinned: false });
    await owner.apply("reply", group);
    expect(owner.outcome("reply", group).state).toBe("success");
    expect(ports.group).toHaveBeenCalledTimes(1);
  });
  it("retains new group identity and successful membership on retry", async () => {
    const { owner, ports, targets } = setup();
    const group: OpenItemsTriageSuggestion = {
      ...base,
      kind: "groupOpenItems",
      group: { kind: "newGroup", newGroupName: "This week" },
      items: [a, b],
    };
    vi.mocked(ports.group)
      .mockImplementationOnce(async (item, groupId) => {
        // A successful manual write updates authoritative membership.
        targets.set(item.entityId, { open: true, groupId, pinned: false });
      })
      .mockRejectedValueOnce(new Error("offline"));
    await owner.apply("reply", group);
    await owner.apply("reply", group);
    expect(ports.createGroup).toHaveBeenCalledTimes(1);
    expect(ports.group).toHaveBeenCalledTimes(3);
  });
  it("warns on an unchanged assignment result while continuing independent items", async () => {
    const { owner, ports } = setup();
    const group: OpenItemsTriageSuggestion = {
      ...base,
      kind: "groupOpenItems",
      group: { kind: "existingGroup", groupId: "existing", name: "Existing" },
      items: [a, b],
    };
    // The provider returns a successful no-op if the target disappeared
    // between the applicability read and assignment.
    vi.mocked(ports.group).mockImplementationOnce(async () => {});
    await owner.apply("reply", group);
    expect(
      owner.outcome("reply", group).items.map((result) => result.state),
    ).toEqual(["failure", "success"]);
    expect(owner.outcome("reply", group).state).toBe("failure");
    await owner.apply("reply", group);
    expect(ports.group).toHaveBeenCalledTimes(3);
    expect(ports.group).toHaveBeenLastCalledWith(
      a,
      "existing",
      expect.any(String),
    );
    expect(owner.outcome("reply", group).state).toBe("success");
  });
  it("retains a created Goal and completed attachment when another attachment fails", async () => {
    const { owner, ports } = setup();
    const track: OpenItemsTriageSuggestion = {
      ...base,
      kind: "trackOnGoal",
      goal: { kind: "newGoal", newGoal: { name: "Ship" } },
      items: [a, b],
    };
    vi.mocked(ports.track)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("not eligible"));
    await owner.apply("reply", track);
    expect(owner.outcome("reply", track).createdGoal).toEqual({
      entityType: EntityType.Task,
      entityId: "created-goal",
      title: "Ship",
    });
    await owner.apply("reply", track);
    expect(ports.createGoal).toHaveBeenCalledTimes(1);
    expect(ports.track).toHaveBeenCalledTimes(3);
    expect(ports.track).toHaveBeenLastCalledWith(b, "created-goal");
  });
  it("never repeats uncertain ordinary Goal creation", async () => {
    const { owner, ports } = setup();
    const track: OpenItemsTriageSuggestion = {
      ...base,
      kind: "trackOnGoal",
      goal: { kind: "newGoal", newGoal: { name: "Ship" } },
      items: [a, b],
    };
    vi.mocked(ports.createGoal).mockRejectedValue(new Error("response lost"));
    await owner.apply("reply", track);
    await owner.apply("reply", track);
    expect(ports.createGoal).toHaveBeenCalledTimes(1);
    expect(ports.track).not.toHaveBeenCalled();
  });
  it("tracks an existing Goal through the authoritative attachment policy without creating one", async () => {
    const { owner, ports } = setup();
    await owner.apply("reply", {
      ...base,
      kind: "trackOnGoal",
      goal: { kind: "existingGoal", goalId: "goal", title: "Goal" },
      items: [a],
    });
    expect(ports.createGoal).not.toHaveBeenCalled();
    expect(ports.track).toHaveBeenCalledWith(a, "goal");
  });
  it("continues Apply all after failure and cancelled shared promotion", async () => {
    const { owner, ports } = setup();
    const promote: OpenItemsTriageSuggestion = {
      ...base,
      suggestionId: "promote",
      kind: "promoteGroupToGoal",
      groupId: "existing",
      groupName: "Existing",
      goalName: "Ship",
      affectedMembers: [a],
    };
    vi.mocked(ports.promote).mockResolvedValue("cancelled");
    vi.mocked(ports.remove).mockRejectedValueOnce(new Error("failed"));
    await owner.applyAll("reply", [
      { ...remove, items: [a] },
      promote,
      { ...remove, suggestionId: "independent", items: [b] },
    ]);
    expect(owner.outcome("reply", promote).state).toBe("cancelled");
    expect(ports.remove).toHaveBeenCalledTimes(2);
    expect(
      owner.outcome("reply", { ...remove, suggestionId: "independent" }).state,
    ).toBe("success");
  });
  it("rejects a missing promotion group before confirmation and keeps overlapping work current", async () => {
    const { owner, ports } = setup();
    const promote: OpenItemsTriageSuggestion = {
      ...base,
      kind: "promoteGroupToGoal",
      groupId: "missing",
      groupName: "Missing",
      goalName: "Ship",
      affectedMembers: [a],
    };
    await owner.apply("reply", promote);
    expect(ports.promote).not.toHaveBeenCalled();
    await owner.applyAll("reply", [
      { ...remove, suggestionId: "first" },
      { ...remove, suggestionId: "overlap" },
    ]);
    expect(ports.remove).toHaveBeenCalledTimes(2);
  });
});
