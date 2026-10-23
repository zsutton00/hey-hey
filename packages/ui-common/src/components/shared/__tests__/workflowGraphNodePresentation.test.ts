import { describe, expect, it } from "vitest";
import {
  buildAuthoredWorkflowStepPresentation,
  getAuthoredWorkflowStepColor,
} from "../workflowGraphNodePresentation";

describe("workflow graph node presentation", () => {
  it("reads authored color from materialized JSON content", () => {
    expect(
      getAuthoredWorkflowStepColor([
        {
          key: "graphPresentation",
          materializedMarkdown: JSON.stringify(
            buildAuthoredWorkflowStepPresentation("#123456")
          ),
        },
      ])
    ).toBe("#123456");
  });

  it("does not treat invalid or absent authored color as presentation data", () => {
    expect(
      getAuthoredWorkflowStepColor([
        {
          key: "graphPresentation",
          content: {
            schemaVersion: "work-item-graph-node-presentation.v1",
            color: "red",
          },
        },
      ])
    ).toBeUndefined();
    expect(getAuthoredWorkflowStepColor([])).toBeUndefined();
  });
});
