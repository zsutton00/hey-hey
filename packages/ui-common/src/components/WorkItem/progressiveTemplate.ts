import type { WorkItemTypeDefinitionDto } from "../../api";
import type { EditorTemplate } from "../../types/editorTemplate";
import { log } from "../../utils/logger";

export interface ProgressiveTemplateContent extends Record<string, string> {
  description: string;
  acceptanceCriteria: string;
  requirements: string;
}

// The editor's section template is derived from the registered work-item type's
// section schema rather than hand-coded per built-in type. The first declared
// section is always required and rendered at full width; remaining sections are
// optional and rendered at partial width — mirroring the prior hand-coded
// templates for the four core types and extending uniformly to custom types.
export const createProgressiveTemplate = (input: {
  entityType: "initiative" | "task";
  definition?: WorkItemTypeDefinitionDto;
  content: ProgressiveTemplateContent;
  workItemStatus?: string;
  materializedProposalIds?: ReadonlyMap<string, string>;
}): EditorTemplate => {
  const {
    content,
    entityType,
    definition,
    workItemStatus,
    materializedProposalIds,
  } = input;

  log.info("general", "Creating progressive template", {
    entityType,
    typeKey: definition?.key,
    hasDescriptionContent: !!content.description?.trim(),
    hasAcceptanceContent: !!content.acceptanceCriteria?.trim(),
    workItemStatus,
  });

  if (entityType === "task" && definition) {
    return {
      id: `progressive-task-${definition.key.toLowerCase()}`,
      name: definition.name,
      description: definition.description ?? undefined,
      sections: definition.sections.map((section, index) => {
        const isFirst = index === 0;
        const initialText =
          content[section.key] ??
          (section.kind === "html/css"
            ? JSON.stringify({
                html: "",
                css: "",
                ...(section.defaultSizeKey
                  ? { sizeKey: section.defaultSizeKey }
                  : {}),
              })
            : section.kind === "structured-mockup"
            ? JSON.stringify({
                schemaVersion: "work-item-structured-mockup.v3",
                revision: 1,
                content: [],
                annotations: [],
                ...(section.defaultSizeKey
                  ? { sizeKey: section.defaultSizeKey }
                  : {}),
              })
            : "");
        const editorSection: EditorTemplate["sections"][number] = {
          id: section.key,
          materializedProposalId: materializedProposalIds?.get(section.key),
          kind: section.kind ?? "markdown",
          definition: section,
          header: { text: section.label, level: 2, editable: false },
          content: {
            initialText,
            showAsSkeleton: false,
            skeletonConfig: {
              type: "text",
              lines: 3,
              width: isFirst ? "full" : "partial",
              animated: false,
            },
          },
          editable: true,
          required: isFirst,
        };
        if (section.writingStandard) {
          editorSection.helperText = section.writingStandard;
        }
        return editorSection;
      }),
    };
  }

  // Fallback: description-only template for initiatives and for tasks whose
  // type definition hasn't loaded yet.
  return {
    id: "progressive-fallback",
    name: "Fallback Template",
    description: "Description-only fallback template",
    sections: [
      {
        id: "description",
        header: { text: "Description", level: 2, editable: false },
        content: {
          initialText: content.description || "",
          showAsSkeleton: false,
          skeletonConfig: {
            type: "text",
            lines: 3,
            width: "full",
            animated: false,
          },
        },
        editable: true,
        required: true,
      },
    ],
  };
};
