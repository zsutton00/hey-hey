import type {
  EntityPromptTemplateAuthoringMetadataDto,
  EntityPromptTemplateEffectiveDto,
  EntityPromptTemplateSelectorDto,
  EntityPromptTemplateSyntaxVersion,
} from "../api";
import { ENTITY_PROMPT_TEMPLATE_LANGUAGES } from "../generated/entity-prompt-template-language";

export interface EntityPromptTemplateCompositionLayerMetadata {
  readonly owner: string;
  readonly responsibility: string;
}

export interface EntityPromptTemplateCompositionMetadata {
  readonly templateLanguage: {
    readonly authoring: EntityPromptTemplateAuthoringMetadataDto;
    readonly syntaxVersion: EntityPromptTemplateSyntaxVersion;
    readonly selector: EntityPromptTemplateSelectorDto;
    readonly selectorLabel: string;
    readonly supportedPaths: readonly string[];
    readonly pathFamilies: readonly {
      readonly template: string;
      readonly pattern: string;
    }[];
  };
  readonly layers: readonly EntityPromptTemplateCompositionLayerMetadata[];
  readonly authority: EntityPromptTemplateCompositionLayerMetadata;
}

const LAYERS = [
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
] as const satisfies readonly EntityPromptTemplateCompositionLayerMetadata[];

const AUTHORITY = {
  owner: "Agent Prompt Composition",
  responsibility:
    "Which layers apply, their order, provider placement, and startup-versus-turn boundaries.",
} as const satisfies EntityPromptTemplateCompositionLayerMetadata;

const formatSelectorLabel = (
  selector: EntityPromptTemplateSelectorDto,
): string => {
  switch (selector.entityType) {
    case "PROJECT":
      return "Project";
    case "DESIGN_DOC":
      return "Design doc";
    case "AGENT_SESSION":
      return "Agent session";
    case "WORK_ITEM":
      return `Work item (${selector.workItemTypeKey})`;
  }
};

export const getEntityPromptTemplateCompositionMetadata = (
  effective: Pick<
    EntityPromptTemplateEffectiveDto,
    "syntaxVersion" | "selector"
  >,
): EntityPromptTemplateCompositionMetadata => {
  const language = ENTITY_PROMPT_TEMPLATE_LANGUAGES[effective.syntaxVersion];

  return {
    templateLanguage: {
      authoring: language.authoring,
      syntaxVersion: effective.syntaxVersion,
      selector: effective.selector,
      selectorLabel: formatSelectorLabel(effective.selector),
      supportedPaths: language.supportedPaths,
      pathFamilies: language.pathFamilies,
    },
    layers: LAYERS,
    authority: AUTHORITY,
  };
};
