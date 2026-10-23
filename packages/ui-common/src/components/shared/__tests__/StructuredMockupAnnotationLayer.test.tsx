import { describe, expect, it } from "vitest";
import type { WorkItemStructuredMockupAnnotation } from "../../../api";
import { getAnnotationDisplayState } from "../StructuredMockupAnnotationLayer";

const annotation: WorkItemStructuredMockupAnnotation = {
  id: "10000000-0000-4000-8000-000000000001",
  note: "Keep this aligned.",
  author: {
    type: "human",
    userId: "10000000-0000-4000-8000-000000000002",
  },
  category: "context",
  lifecycle: "resolved",
  authoredProposalId: "20000000-0000-4000-8000-000000000001",
  authoredSizeKey: "desktop",
  target: { type: "position", x: 0.5, y: 0.5 },
};

describe("getAnnotationDisplayState", () => {
  it("keeps lifecycle independent from matching proposal provenance", () => {
    expect(
      getAnnotationDisplayState(
        annotation,
        "20000000-0000-4000-8000-000000000001",
        "desktop"
      )
    ).toBe("resolved");
  });

  it("marks proposal or resolved-size changes outdated", () => {
    expect(
      getAnnotationDisplayState(
        annotation,
        "20000000-0000-4000-8000-000000000002",
        "desktop"
      )
    ).toBe("outdated");
    expect(
      getAnnotationDisplayState(
        annotation,
        annotation.authoredProposalId,
        "mobile"
      )
    ).toBe("outdated");
  });
});
