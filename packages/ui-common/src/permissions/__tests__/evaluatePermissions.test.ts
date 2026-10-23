import { describe, it, expect } from "vitest";
import { evaluatePermissions, matchesRule } from "../evaluate";

describe("evaluatePermissions", () => {
  it("returns requiresProposal with threshold 2 for top-level features", () => {
    const result = evaluatePermissions({ type: "FEATURE", parentTaskId: null });
    expect(result).toEqual({ requiresProposal: true, threshold: 2 });
  });

  it("returns default config for child features", () => {
    const result = evaluatePermissions({
      type: "FEATURE",
      parentTaskId: "some-id",
    });
    expect(result).toEqual({ requiresProposal: false, threshold: 1 });
  });

  it("returns default config for non-feature types", () => {
    const result = evaluatePermissions({ type: "TASK", parentTaskId: null });
    expect(result).toEqual({ requiresProposal: false, threshold: 1 });
  });

  it("returns default config for tasks with a parent", () => {
    const result = evaluatePermissions({
      type: "TASK",
      parentTaskId: "parent-123",
    });
    expect(result).toEqual({ requiresProposal: false, threshold: 1 });
  });
});

describe("matchesRule", () => {
  it("returns true when all match fields are equal", () => {
    const entity = { type: "FEATURE", parentTaskId: null };
    expect(matchesRule(entity, { type: "FEATURE", parentTaskId: null })).toBe(
      true
    );
  });

  it("returns false when a field differs", () => {
    const entity = { type: "FEATURE", parentTaskId: "some-id" };
    expect(matchesRule(entity, { type: "FEATURE", parentTaskId: null })).toBe(
      false
    );
  });

  it("returns true for an empty match (matches everything)", () => {
    const entity = { type: "TASK", parentTaskId: null };
    expect(matchesRule(entity, {})).toBe(true);
  });

  it("returns false when type does not match", () => {
    const entity = { type: "TASK", parentTaskId: null };
    expect(matchesRule(entity, { type: "FEATURE" })).toBe(false);
  });
});
