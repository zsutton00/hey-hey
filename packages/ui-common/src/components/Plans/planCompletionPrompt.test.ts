import { describe, expect, it } from "vitest";
import { buildPlanCompletionReviewPrompt } from "./planCompletionPrompt";

describe("buildPlanCompletionReviewPrompt", () => {
  it("builds the canonical Plan-completion review message", () => {
    expect(buildPlanCompletionReviewPrompt("Release planning")).toBe(
      "The plan ‘Release planning’ has been completed. Review its design document and the resulting implementation, then identify any project features, requirements, decisions, contracts, or other project information that should be updated."
    );
  });

  it("appends only non-empty, trimmed guidance", () => {
    expect(
      buildPlanCompletionReviewPrompt(
        "Release planning",
        "  Check the billing feature first.  "
      )
    ).toBe(
      "The plan ‘Release planning’ has been completed. Review its design document and the resulting implementation, then identify any project features, requirements, decisions, contracts, or other project information that should be updated.\n\nCheck the billing feature first."
    );
    expect(buildPlanCompletionReviewPrompt("Release planning", "  ")).toBe(
      "The plan ‘Release planning’ has been completed. Review its design document and the resulting implementation, then identify any project features, requirements, decisions, contracts, or other project information that should be updated."
    );
  });
});
