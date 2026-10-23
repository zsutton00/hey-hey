import { describe, expect, it } from "vitest";

import { ProjectFeatureNextStepKind } from "../../../api";
import { buildGuidedFirstStepsWalkthrough } from "../buildGuidedFirstStepsWalkthrough";
import type { HelpFeatureNextStep } from "../helpCapabilities";

const nextStep = (kind: ProjectFeatureNextStepKind): HelpFeatureNextStep => ({
  feature: {
    id: "feat-1",
    name: "Recipe Library",
    href: "/projects/p/features/feat-1",
  },
  kind,
  rationale: "Its scope is clear enough to start.",
  starterPrompt: `Flesh out Recipe Library with the meal-plan import I described, then create its ${kind}.`,
});

const TITLES: Record<ProjectFeatureNextStepKind, string> = {
  TASKS: "Break Recipe Library into tasks",
  MOCKUPS: "Mock up Recipe Library",
  DIAGRAM: "Diagram Recipe Library",
};

describe("buildGuidedFirstStepsWalkthrough", () => {
  it.each(Object.values(ProjectFeatureNextStepKind))(
    "builds the titled conditional four-action %s walkthrough with the saved starter prompt",
    (kind) => {
      const walkthrough = buildGuidedFirstStepsWalkthrough(nextStep(kind));
      const entity = { kind: "feature", id: "feat-1" };

      expect(walkthrough.steps[0]).toEqual({
        actionKey: "open-explorer-section",
        inputs: {
          entity,
          sectionKey: "work-item:FEATURE",
          sectionName: "Features",
        },
        condition: {
          kind: "explorer-section-collapsed",
          sectionKey: "work-item:FEATURE",
        },
      });
      expect(walkthrough.title).toBe(TITLES[kind]);
      expect(walkthrough.steps.map((step) => step.actionKey)).toEqual([
        "open-explorer-section",
        "open-entity",
        "open-discuss",
        "compose-and-start",
      ]);
      expect(walkthrough.steps[1].inputs).toEqual({
        entity,
        entityName: "Recipe Library",
      });
      expect(walkthrough.steps[2].inputs).toEqual({ entity });

      const compose = walkthrough.steps[3];
      if (compose.actionKey !== "compose-and-start") throw new Error();
      expect(compose.inputs.entity).toEqual(entity);
      expect(compose.inputs.suggestedPrompt).toBe(nextStep(kind).starterPrompt);
    }
  );

  it("produces an immutable definition", () => {
    const walkthrough = buildGuidedFirstStepsWalkthrough(nextStep("TASKS"));
    expect(Object.isFrozen(walkthrough)).toBe(true);
    expect(Object.isFrozen(walkthrough.steps[2].inputs)).toBe(true);
  });
});
