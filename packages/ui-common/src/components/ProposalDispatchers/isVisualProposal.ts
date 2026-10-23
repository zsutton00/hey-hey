import type { WorkItemTypeDefinitionDto } from "../../api";

/** Section kinds that render as a visual rather than as text. */
export const isVisualSectionKind = (kind: string | undefined): boolean =>
  kind === "html/css" || kind === "structured-mockup";

/**
 * A work-item type is visual when its registry definition declares a visual
 * section. Classification comes from the resolved definition, never the type
 * key, so project-defined visual types behave like built-in mockups.
 */
export const definesVisualSections = (
  definition: Pick<WorkItemTypeDefinitionDto, "sections"> | undefined
): boolean =>
  definition?.sections.some(({ kind }) => isVisualSectionKind(kind)) ?? false;
