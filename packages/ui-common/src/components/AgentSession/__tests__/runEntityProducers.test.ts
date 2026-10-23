import { describe, expect, it } from "vitest";
import { buildRunEntityReference } from "../runEntityReference";

describe("Run entity producers", () => {
  it("authors the common entity shape for a Plan conversation", () => {
    expect(
      buildRunEntityReference("task", "22222222-2222-4222-8222-222222222222"),
    ).toEqual({
      entityType: "TASK",
      entityId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("does not accept a work-item subtype as a Run entity family", () => {
    expect(() =>
      buildRunEntityReference(
        "FEATURE",
        "33333333-3333-4333-8333-333333333333",
      ),
    ).toThrow("Run entity scope must contain a supported type and id.");
  });

  it("fails instead of manufacturing a Run identity", () => {
    expect(() => buildRunEntityReference("", "")).toThrow();
  });
});
