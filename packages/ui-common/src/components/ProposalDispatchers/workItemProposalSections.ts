import type {
  WorkItemTypeDefinitionDto,
  WorkItemTypeSectionDefinition,
} from "../../api";

interface ProposedSectionInput {
  key: string;
  content: unknown;
}

interface ExistingSectionInput {
  key: string;
  materializedMarkdown: string;
  materializedProposalId?: string;
}

export interface ProposalWorkItemSection {
  key: string;
  label: string;
  kind: "markdown" | "json" | "html/css" | "structured-mockup";
  definition: WorkItemTypeSectionDefinition;
  proposedValue: unknown;
  existingValue: unknown;
  proposedContent: string;
  existingContent: string;
  materializedProposalId?: string;
}

const sectionContentToMarkdown = (content: unknown): string => {
  if (typeof content === "string") {
    return content;
  }

  if (content === null || content === undefined) {
    return "";
  }

  return JSON.stringify(content, null, 2);
};

export function resolveProposalWorkItemSections(input: {
  definition: WorkItemTypeDefinitionDto;
  proposedSections: readonly ProposedSectionInput[] | undefined;
  existingSections?: readonly ExistingSectionInput[];
}): ProposalWorkItemSection[] {
  const proposedByKey = new Map(
    (input.proposedSections ?? []).map((section) => [section.key, section])
  );
  const existingByKey = new Map(
    (input.existingSections ?? []).map((section) => [section.key, section])
  );

  return input.definition.sections.flatMap((definition) => {
    const { key, label, kind } = definition;
    const proposed = proposedByKey.get(key);
    return proposed
      ? [
          {
            key,
            label,
            kind: kind ?? "markdown",
            definition,
            proposedValue: proposed.content,
            existingValue:
              existingByKey.get(key)?.materializedMarkdown ?? "",
            proposedContent: sectionContentToMarkdown(proposed.content),
            existingContent:
              existingByKey.get(key)?.materializedMarkdown ?? "",
            materializedProposalId:
              existingByKey.get(key)?.materializedProposalId,
          },
        ]
      : [];
  });
}
