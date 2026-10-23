import type { ProjectFeatureNextStepKind } from "../../api";
import {
  defineWalkthrough,
  type GuidableEntity,
  type Walkthrough,
} from "../GuidedWalkthrough";
import type { HelpFeatureNextStep } from "./helpCapabilities";

/** Record-typed so a new ProjectFeatureNextStepKind fails typecheck here. */
const WALKTHROUGH_TITLES: Record<
  ProjectFeatureNextStepKind,
  (featureName: string) => string
> = {
  TASKS: (name) => `Break ${name} into tasks`,
  MOCKUPS: (name) => `Mock up ${name}`,
  DIAGRAM: (name) => `Diagram ${name}`,
};

/**
 * Walks the user from a Where to start card to a conversation they start
 * themselves: open Features if collapsed, select the Feature, open Discuss,
 * then accept the starter prompt
 * onboarding generated for the suggestion or write their own.
 */
export function buildGuidedFirstStepsWalkthrough({
  feature,
  kind,
  starterPrompt,
}: HelpFeatureNextStep): Walkthrough {
  const entity: GuidableEntity = { kind: "feature", id: feature.id };
  return defineWalkthrough(WALKTHROUGH_TITLES[kind](feature.name), [
    {
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
    },
    {
      actionKey: "open-entity",
      inputs: { entity, entityName: feature.name },
    },
    { actionKey: "open-discuss", inputs: { entity } },
    {
      actionKey: "compose-and-start",
      inputs: { entity, suggestedPrompt: starterPrompt },
    },
  ]);
}
