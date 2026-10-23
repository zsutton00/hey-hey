import { describe, expect, it } from "vitest";
import type { WorkItemTypeDefinitionDto } from "@hey-hey/ui-common/api";
import {
  applyGuidanceDraft,
  isGuidanceValid,
  moveGuidanceItem,
  type GuidanceDraft,
} from "./workItemTypeGuidanceForm";

const definition: WorkItemTypeDefinitionDto = {
  key: "TEST",
  name: "Test",
  role: "work-item",
  sections: [],
  allowedStatuses: [],
};
describe("guidance draft", () => {
  it("preserves omission, raw text, empty arrays and nested ordering", () => {
    expect(applyGuidanceDraft(definition, undefined)).toEqual(definition);
    const guidance: GuidanceDraft = {
      overview: " Overview \n",
      examples: [],
      contexts: [
        { focalTypeKeys: ["B", "A"], guidance: " Context " },
        { focalTypeKeys: ["A"], guidance: "Other", examples: [] },
      ],
    };
    expect(applyGuidanceDraft(definition, guidance).agentGuidance).toEqual(
      guidance
    );
    expect(
      applyGuidanceDraft({ ...definition, agentGuidance: guidance }, undefined)
    ).toEqual(definition);
    expect(guidance.contexts?.[0]).not.toHaveProperty("examples");
  });
  it("moves only the requested entry without mutating siblings", () => {
    const rows = [
      { title: "A", guidance: "one" },
      { title: "B", guidance: "two" },
    ];
    expect(moveGuidanceItem(rows, 1, -1)).toEqual([rows[1], rows[0]]);
    expect(rows[0].title).toBe("A");
    expect(moveGuidanceItem(rows, 0, -1)).toEqual(rows);
  });
  it.each<GuidanceDraft>([
    { overview: " " },
    { overview: "Overview", examples: [{ title: " ", guidance: "Body" }] },
    { overview: "Overview", examples: [{ title: "Title", guidance: " " }] },
    {
      overview: "Overview",
      contexts: [{ focalTypeKeys: [], guidance: "Body" }],
    },
    {
      overview: "Overview",
      contexts: [{ focalTypeKeys: ["A"], guidance: " " }],
    },
    {
      overview: "Overview",
      contexts: [
        {
          focalTypeKeys: ["A"],
          guidance: "Body",
          examples: [{ title: "Title", guidance: " " }],
        },
      ],
    },
  ])("rejects blank required authored values: %j", (guidance) => {
    expect(isGuidanceValid(guidance)).toBe(false);
  });
  it("accepts omitted guidance and optional arrays", () => {
    expect(isGuidanceValid(undefined)).toBe(true);
    expect(isGuidanceValid({ overview: " Overview " })).toBe(true);
  });
});
