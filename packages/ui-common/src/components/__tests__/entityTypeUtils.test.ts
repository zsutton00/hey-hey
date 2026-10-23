import { describe, expect, it } from "vitest";
import { EntityType } from "../../api";
import { normalizeEntityType } from "../entityTypeUtils";

describe("normalizeEntityType", () => {
  it("normalizes workflow to the task entity type for generated API calls", () => {
    expect(normalizeEntityType("workflow")).toBe(EntityType.Task);
  });
});
