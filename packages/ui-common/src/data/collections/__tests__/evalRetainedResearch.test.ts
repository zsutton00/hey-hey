import { describe, expect, it } from "vitest";
import { readRetainedResearch } from "../evalRetainedResearch";

const research = {
  reportType: "CODING_RESEARCH",
  summary: "Pairing is replaced by the desktop app.",
  analysis: "The Help Welcome tab explains pairing.",
  frame: { focalId: "task-1", nodes: [] },
  provenance: {
    discoveryCalls: [
      { tool: "get_context", query: "task-1", intent: "Orient" },
    ],
    edgesTraversed: [],
  },
  updates: [
    {
      type: "update",
      targets: [{ entityType: "TASK", entityId: "task-1", title: "Help" }],
      description: "Update the Help tab.",
      reason: "It names pairing.",
    },
  ],
};

describe("readRetainedResearch", () => {
  it("reads the research the runner kept as the attempt's output text", () => {
    const result = readRetainedResearch({
      outputText: JSON.stringify(research),
    });
    expect(result.status).toBe("readable");
    if (result.status === "readable") {
      expect(result.payload.summary).toBe(research.summary);
      expect(result.payload.updates).toHaveLength(1);
    }
  });

  it("treats a summary with no output as no retained research", () => {
    expect(readRetainedResearch(undefined)).toEqual({ status: "none" });
    expect(readRetainedResearch(null)).toEqual({ status: "none" });
    expect(readRetainedResearch("Case on gpt")).toEqual({ status: "none" });
    expect(readRetainedResearch({})).toEqual({ status: "none" });
    expect(readRetainedResearch({ outputText: "  " })).toEqual({
      status: "none",
    });
  });

  it("says saved output that isn't JSON can't be read as research", () => {
    const result = readRetainedResearch({ outputText: "Just some prose." });
    expect(result.status).toBe("unreadable");
  });

  it("says saved JSON that isn't a research report can't be read as one", () => {
    const result = readRetainedResearch({
      outputText: JSON.stringify({ reportType: "SNAPSHOT" }),
    });
    expect(result.status).toBe("unreadable");
  });

  it("says a research report missing required fields can't be shown", () => {
    const { analysis: _analysis, ...incomplete } = research;
    const result = readRetainedResearch({
      outputText: JSON.stringify(incomplete),
    });
    expect(result).toEqual({
      status: "unreadable",
      reason: "The saved research report is missing required fields.",
    });
  });

  it("says a summary of an unexpected shape can't be read", () => {
    expect(readRetainedResearch({ outputText: 5 }).status).toBe("unreadable");
    expect(readRetainedResearch([1, 2]).status).toBe("unreadable");
  });
});
