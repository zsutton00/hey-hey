import { describe, expect, it } from "vitest";
import { parseCodingResearchSubagentParentAnalysis } from "./codingResearchSubagentParentUncertainties";

describe("parseCodingResearchSubagentParentAnalysis", () => {
  it("extracts parent-authored entries while preserving surrounding analysis and old Markdown", () => {
    const analysis = [
      "The parent reviewed the child evidence and reached this conclusion.",
      "",
      "## Uncertainties",
      "",
      "- **lack_of_evidence · low** — The project does not specify the fallback. — References: @[task:2533ce2a-653e-46c1-a3eb-bc2039d85c97|Fallback behavior]",
      "- **conflict · medium** — Two requirements disagree. — References: @[feature:2533ce2a-653e-46c1-a3eb-bc2039d85c97|Reporting]",
      "- **ambiguity · high** — The design allows two readings. — References: @[design_doc:2533ce2a-653e-46c1-a3eb-bc2039d85c97|Report decisions], @[task:2533ce2a-653e-46c1-a3eb-bc2039d85c97|Related task]",
      "- **not_implemented · medium** — The reviewed behavior is absent. — References: none",
      "Historical uncertainty text that does not follow the current convention.",
      "",
      "## Next section",
      "Keep this analysis too.",
    ].join("\n");

    const result = parseCodingResearchSubagentParentAnalysis(analysis);

    expect(result.uncertainties).toHaveLength(4);
    expect(
      result.uncertainties.map(({ category, severity }) => [
        category,
        severity,
      ]),
    ).toEqual([
      ["lack_of_evidence", "low"],
      ["conflict", "medium"],
      ["ambiguity", "high"],
      ["not_implemented", "medium"],
    ]);
    expect(result.uncertainties[0]?.references[0]).toEqual({
      entityType: "TASK",
      entityId: "2533ce2a-653e-46c1-a3eb-bc2039d85c97",
      title: "Fallback behavior",
    });
    expect(result.uncertainties[2]?.references).toHaveLength(2);
    expect(result.uncertainties[2]?.references[1]?.title).toBe("Related task");
    expect(result.analysis).toContain("The parent reviewed the child evidence");
    expect(result.analysis).toContain(
      "Historical uncertainty text that does not follow",
    );
    expect(result.analysis).toContain("## Next section");
    expect(result.analysis).not.toContain(
      "The project does not specify the fallback",
    );
  });
});
