import {
  EntityPromptTemplateSyntaxVersion,
  type EntityPromptTemplateSelectorDto,
} from "../../api";
import { ENTITY_PROMPT_TEMPLATE_LANGUAGES } from "../../generated/entity-prompt-template-language";
import { describe, expect, it } from "vitest";
import { getEntityPromptTemplateCompositionMetadata } from "../entityPromptTemplateComposition";

const getMetadata = (selector: EntityPromptTemplateSelectorDto) =>
  getEntityPromptTemplateCompositionMetadata({
    selector,
    syntaxVersion: EntityPromptTemplateSyntaxVersion.V1,
  });

describe("getEntityPromptTemplateCompositionMetadata", () => {
  it("keeps generated template metadata alongside the shared layer ownership", () => {
    const selector: EntityPromptTemplateSelectorDto = {
      entityType: "WORK_ITEM",
      workItemTypeKey: "FEATURE",
    };

    expect(getMetadata(selector)).toEqual({
      templateLanguage: {
        authoring: ENTITY_PROMPT_TEMPLATE_LANGUAGES.V1.authoring,
        syntaxVersion: "V1",
        selector,
        selectorLabel: "Work item (FEATURE)",
        supportedPaths: ENTITY_PROMPT_TEMPLATE_LANGUAGES.V1.supportedPaths,
        pathFamilies: ENTITY_PROMPT_TEMPLATE_LANGUAGES.V1.pathFamilies,
      },
      layers: [
        {
          owner: "Entity Prompt Templates",
          responsibility: "Focal-entity grounding from Context.",
        },
        {
          owner: "System Prompt",
          responsibility: "Shared session-level rules.",
        },
        {
          owner: "Modes",
          responsibility:
            "Selected coding behavior and tool contract when applicable.",
        },
      ],
      authority: {
        owner: "Agent Prompt Composition",
        responsibility:
          "Which layers apply, their order, provider placement, and startup-versus-turn boundaries.",
      },
    });
    expect(
      getMetadata(selector).templateLanguage.supportedPaths.length,
    ).toBeGreaterThan(0);
    expect(
      getMetadata(selector).templateLanguage.pathFamilies.length,
    ).toBeGreaterThan(0);
  });

  it.each([
    [{ entityType: "PROJECT" }, "Project"],
    [{ entityType: "WORK_ITEM", workItemTypeKey: "PLAN" }, "Work item (PLAN)"],
    [{ entityType: "DESIGN_DOC" }, "Design doc"],
    [{ entityType: "AGENT_SESSION" }, "Agent session"],
    [{ entityType: "WORK_ITEM", workItemTypeKey: "BUG" }, "Work item (BUG)"],
  ] satisfies Array<[EntityPromptTemplateSelectorDto, string]>)(
    "formats the %s selector",
    (selector, expectedLabel) => {
      expect(getMetadata(selector).templateLanguage.selectorLabel).toBe(
        expectedLabel,
      );
    },
  );
});
