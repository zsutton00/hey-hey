import { describe, expect, it } from "vitest";
import { workItemDetailRead } from "../workItemLists";

const scope = { organizationId: "org-1", projectId: "project-1" };

describe("workItemDetailRead", () => {
  it("requests tracked entities so a goal page can list its tracked work", () => {
    const read = workItemDetailRead(scope, "goal-1");

    expect(read.variables.withTrackedEntities).toBe(true);
  });

  it("lets a caller opt out of tracked entities", () => {
    const read = workItemDetailRead(scope, "goal-1", {
      includeTrackedEntities: false,
    });

    expect(read.variables.withTrackedEntities).toBe(false);
  });
});
