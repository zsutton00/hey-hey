import { describe, expect, it } from "vitest";
import { resolveFileReferenceScope } from "../fileReferences/types";

describe("resolveFileReferenceScope", () => {
  it("maps supported work-item subtypes to discriminated scopes", () => {
    expect(resolveFileReferenceScope("STANDARD", "task-1")).toEqual({
      kind: "task",
      taskId: "task-1",
    });
    expect(resolveFileReferenceScope("FEATURE", "feature-1")).toEqual({
      kind: "feature",
      featureId: "feature-1",
    });
  });

  it("does not infer scope from generic or unsupported types", () => {
    expect(resolveFileReferenceScope("TASK", "task-1")).toBeNull();
    expect(resolveFileReferenceScope("BUG", "task-1")).toBeNull();
    expect(resolveFileReferenceScope(undefined, "task-1")).toBeNull();
  });

  it("does not return a scope for an unresolved work-item id", () => {
    expect(resolveFileReferenceScope("STANDARD", "  ")).toBeNull();
  });
});
