import { describe, expect, it } from "vitest";
import {
  renderStartupPlanMarkdown,
  type StartupPlanRenderable,
} from "../startupPlanRendering";

const buildPlan = (
  executionPlan: StartupPlanRenderable["executionPlan"]
): StartupPlanRenderable => ({
  sessionTitle: "Difficulty and phase rendering",
  executionPlan,
  discrepancies: [],
  clarificationQuestions: [],
});

describe("renderStartupPlanMarkdown — difficulty and phase", () => {
  it("preserves substantive approved sources, full implementation content and all connection evidence", () => {
    const content =
      "Reuse existing shared triage cards.\n```tsx\n<TriageModal />\n```\nKeep both Diagram branches.";
    const plan: StartupPlanRenderable = {
      ...buildPlan([
        {
          stepId: "step-1",
          title: "Approved modal redraw",
          description: "Honor the reviewed interface.",
          phase: 1,
          targetFiles: ["src/TriageModal.tsx"],
          references: [
            {
              sourceType: "designDoc",
              sourceId: "11111111-1111-4111-8111-111111111111",
              rationale: "Approved modal and shared cards.",
            },
            {
              sourceType: "task",
              sourceId: "22222222-2222-4222-8222-222222222222",
              rationale: "Custom review constraint.",
            },
          ],
        },
      ]),
      primaryImplementations: [
        {
          title: "Modal design",
          location: "src/TriageModal.tsx",
          language: "markdown",
          content,
          rationale: "Apply the reviewed design to the whole result.",
          connections: [
            {
              entityType: "workflowStep",
              entityId: "33333333-3333-4333-8333-333333333333",
              entityTitle: "Triage decision",
              relationship: "fulfills",
              sourceField: "outputs",
              sourceExcerpt:
                "Both branches retain cards.\nPreserve review evidence.",
              rationale: "Honor the Diagram branches.",
            },
          ],
        },
      ],
    };
    const markdown = renderStartupPlanMarkdown(plan);
    expect(markdown).toContain(content);
    expect(markdown).toContain("````markdown\n");
    expect(markdown.indexOf("References:")).toBeGreaterThan(
      markdown.indexOf("Target files:")
    );
    expect(markdown).toContain(
      "designDoc:11111111-1111-4111-8111-111111111111 — Approved modal and shared cards.; task:22222222-2222-4222-8222-222222222222 — Custom review constraint."
    );
    expect(markdown).toContain(
      "Both branches retain cards.\nPreserve review evidence."
    );
    expect(markdown).toMatchSnapshot();
  });

  it("omits empty reference and implementation sections", () => {
    const markdown = renderStartupPlanMarkdown({
      ...buildPlan([
        {
          stepId: "step-1",
          title: "Step",
          description: "Work",
          phase: 1,
          references: [],
        },
      ]),
      primaryImplementations: [],
    });
    expect(markdown).not.toContain("References:");
    expect(markdown).not.toContain("Primary Implementations");
  });

  it("emits a per-step difficulty label, distinguishing hard from medium and omitting when absent", () => {
    const markdown = renderStartupPlanMarkdown(
      buildPlan([
        {
          stepId: "step-1",
          title: "Hard step",
          description: "A hard step.",
          phase: 1,
          difficulty: "hard",
        },
        {
          stepId: "step-2",
          title: "Medium step",
          description: "A medium step.",
          phase: 1,
          difficulty: "medium",
        },
        {
          stepId: "step-3",
          title: "Unlabeled step",
          description: "No difficulty.",
          phase: 1,
        },
      ])
    );

    // Hard is bold so it stands out; medium is italic; absent renders nothing.
    expect(markdown).toContain("**Hard step** **[hard]**");
    expect(markdown).toContain("**Medium step** _[medium]_");
    expect(markdown).toContain("**Unlabeled step**\n");
    expect(markdown).not.toContain("Unlabeled step** _[");
  });

  it("groups contiguous steps under their 1-based phase with global numbering", () => {
    const markdown = renderStartupPlanMarkdown(
      buildPlan([
        {
          stepId: "step-1",
          title: "Phase one first",
          description: "First.",
          phase: 1,
        },
        {
          stepId: "step-2",
          title: "Phase one second",
          description: "Second.",
          phase: 1,
        },
        {
          stepId: "step-3",
          title: "Phase two first",
          description: "Third.",
          phase: 2,
        },
      ])
    );

    expect(markdown).toContain("#### Phase 1");
    expect(markdown).toContain("#### Phase 2");
    // Phase 1 header appears once for the contiguous run.
    expect(markdown.match(/#### Phase 1/g)).toHaveLength(1);
    // Numbering is global across phases, not reset per phase.
    expect(markdown).toContain("1. `step-1`");
    expect(markdown).toContain("2. `step-2`");
    expect(markdown).toContain("3. `step-3`");
    // The phase-2 header precedes its step.
    expect(markdown.indexOf("#### Phase 2")).toBeLessThan(
      markdown.indexOf("3. `step-3`")
    );
  });

  it("repeats a phase header for a non-contiguous run of the same phase", () => {
    const markdown = renderStartupPlanMarkdown(
      buildPlan([
        {
          stepId: "step-1",
          title: "Phase one",
          description: "First.",
          phase: 1,
        },
        {
          stepId: "step-2",
          title: "Phase two",
          description: "Second.",
          phase: 2,
        },
        {
          stepId: "step-3",
          title: "Phase one again",
          description: "Third.",
          phase: 1,
        },
      ])
    );

    expect(markdown.match(/#### Phase 1/g)).toHaveLength(2);
  });
});
