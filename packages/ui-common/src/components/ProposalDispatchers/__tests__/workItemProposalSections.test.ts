import { describe, expect, it } from "vitest";
import type { WorkItemTypeDefinitionDto } from "../../../api";
import { resolveProposalWorkItemSections } from "../workItemProposalSections";

const definition = {
  key: "RESEARCH_BRIEF",
  name: "Research Brief",
  sections: [
    { key: "audience", label: "Audience" },
    { key: "description", label: "Summary" },
  ],
  allowedStatuses: [],
} as unknown as WorkItemTypeDefinitionDto;

describe("resolveProposalWorkItemSections", () => {
  it("selects declared sections in registry order with registry labels", () => {
    const sections = resolveProposalWorkItemSections({
      definition,
      proposedSections: [
        { key: "description", content: "New summary" },
        { key: "undeclared", content: "Hidden" },
        { key: "audience", content: "Product teams" },
      ],
      existingSections: [
        { key: "description", materializedMarkdown: "Old summary" },
        { key: "audience", materializedMarkdown: "Operations teams" },
      ],
    });

    expect(sections).toEqual([
      {
        definition: definition.sections[0],
        key: "audience",
        label: "Audience",
        kind: "markdown",
        proposedValue: "Product teams",
        existingValue: "Operations teams",
        proposedContent: "Product teams",
        existingContent: "Operations teams",
      },
      {
        definition: definition.sections[1],
        key: "description",
        label: "Summary",
        kind: "markdown",
        proposedValue: "New summary",
        existingValue: "Old summary",
        proposedContent: "New summary",
        existingContent: "Old summary",
      },
    ]);
  });

  it("keeps declared empty and structured proposed content reviewable", () => {
    const sections = resolveProposalWorkItemSections({
      definition,
      proposedSections: [
        { key: "audience", content: null },
        { key: "description", content: { outcome: "Ship" } },
      ],
    });

    expect(sections.map(({ proposedContent }) => proposedContent)).toEqual([
      "",
      '{\n  "outcome": "Ship"\n}',
    ]);
  });

  it("retains structured html/css content and selects by section kind", () => {
    const htmlCssDefinition = {
      ...definition,
      key: "SECOND_ARBITRARY_TYPE",
      sections: [
        { key: "preview", label: "Preview", kind: "html/css" as const },
      ],
    };
    const payload = { html: "<button>Ship</button>", css: "button{color:red}" };
    const [section] = resolveProposalWorkItemSections({
      definition: htmlCssDefinition,
      proposedSections: [{ key: "preview", content: payload }],
    });

    expect(section).toMatchObject({
      kind: "html/css",
      proposedValue: payload,
    });
  });

  it("retains a structured mockup document and selects by section kind", () => {
    const mockupDefinition = {
      ...definition,
      key: "STRUCTURED_MOCKUP_TYPE",
      sections: [
        {
          key: "mockup",
          label: "Mockup",
          kind: "structured-mockup" as const,
        },
      ],
    };
    const document = {
      schemaVersion: "work-item-structured-mockup.v5",
      sizeKey: "panel",
      content: [
        {
          type: "caret",
          props: {
            id: "expand",
            width: { mode: "fit" },
            height: { mode: "content" },
            direction: "down",
          },
        },
      ],
    };
    const [section] = resolveProposalWorkItemSections({
      definition: mockupDefinition,
      proposedSections: [{ key: "mockup", content: document }],
    });

    expect(section).toMatchObject({
      kind: "structured-mockup",
      proposedValue: document,
      proposedContent: JSON.stringify(document, null, 2),
    });
  });
});
