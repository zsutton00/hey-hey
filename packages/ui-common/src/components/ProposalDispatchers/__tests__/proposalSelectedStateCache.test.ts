import { afterEach, describe, expect, it, vi } from "vitest";
import {
  __resetForTests,
  getEntry,
  setLifecycle,
  setNewEntityId,
  subscribe,
} from "../proposalSelectedStateCache";

afterEach(() => {
  __resetForTests();
});

describe("proposalSelectedStateCache", () => {
  it("returns undefined for unknown ids", () => {
    expect(getEntry("nope")).toBeUndefined();
  });

  it("stores lifecycle by id", () => {
    setLifecycle("p-1", "applied");
    expect(getEntry("p-1")).toEqual({ lifecycle: "applied" });

    setLifecycle("p-1", "rejected");
    expect(getEntry("p-1")).toEqual({ lifecycle: "rejected" });
  });

  it("preserves an existing newEntityId when lifecycle is updated", () => {
    setLifecycle("p-2", "applied");
    setNewEntityId("p-2", "entity-real");
    setLifecycle("p-2", "rejected");
    expect(getEntry("p-2")).toEqual({
      lifecycle: "rejected",
      newEntityId: "entity-real",
    });
  });

  it("setNewEntityId without prior lifecycle defaults to applied", () => {
    setNewEntityId("p-3", "entity-real");
    expect(getEntry("p-3")).toEqual({
      lifecycle: "applied",
      newEntityId: "entity-real",
    });
  });

  it("notifies subscribers when lifecycle is set", () => {
    const listener = vi.fn();
    subscribe("p-4", listener);
    setLifecycle("p-4", "applied");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("notifies subscribers when newEntityId changes", () => {
    const listener = vi.fn();
    subscribe("p-5", listener);
    setNewEntityId("p-5", "entity-1");
    setNewEntityId("p-5", "entity-1"); // identical write should not re-notify
    setNewEntityId("p-5", "entity-2");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("only fires listeners registered for the same id", () => {
    const a = vi.fn();
    const b = vi.fn();
    subscribe("p-a", a);
    subscribe("p-b", b);
    setLifecycle("p-a", "applied");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).not.toHaveBeenCalled();
  });

  it("unsubscribe stops further notifications", () => {
    const listener = vi.fn();
    const unsubscribe = subscribe("p-6", listener);
    setLifecycle("p-6", "applied");
    unsubscribe();
    setLifecycle("p-6", "rejected");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("__resetForTests clears all entries and listeners", () => {
    const listener = vi.fn();
    setLifecycle("p-7", "applied");
    subscribe("p-7", listener);
    __resetForTests();
    expect(getEntry("p-7")).toBeUndefined();
    setLifecycle("p-7", "rejected");
    expect(listener).not.toHaveBeenCalled();
  });
});
