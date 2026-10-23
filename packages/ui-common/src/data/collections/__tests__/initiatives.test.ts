import { describe, expect, it } from "vitest";
import { initiativeKeys } from "../initiatives";
import { WorkStatus } from "../../../api";
describe("initiative keys", () => {
  it("canonicalizes unordered status and section filters", () => {
    expect(
      initiativeKeys.list("org", {
        status: [WorkStatus.Backlog, WorkStatus.Completed],
        includeSectionKeys: ["description", "acceptanceCriteria"],
      })
    ).toEqual(
      initiativeKeys.list("org", {
        status: [WorkStatus.Completed, WorkStatus.Backlog],
        includeSectionKeys: ["acceptanceCriteria", "description"],
      })
    );
  });
  it("keeps real projections and conversation scopes distinct", () => {
    const base = initiativeKeys.list("org", { projectId: "project" });
    expect(
      initiativeKeys.list("org", {
        projectId: "project",
        includeSectionKeys: ["description"],
      })
    ).not.toEqual(base);
    expect(
      initiativeKeys.list("org", {
        projectId: "project",
        conversationId: "conversation",
      })
    ).not.toEqual(base);
    expect(initiativeKeys.detail("org", "item")).not.toEqual(
      initiativeKeys.detail("other", "item")
    );
  });
});
