import { describe, expect, it } from "vitest";
import type { WorkItemTypeDefinitionDto } from "../../api";
import {
  applyTaskSectionInputsToMaterialized,
  getSelectedSectionKeys,
  getTaskContentFromSections,
  selectWorkItemSections,
  selectInlineWorkItemSections,
  taskContentToSectionInputs,
  decodeHtmlCssSectionContent,
  serializeHtmlCssSectionContent,
  decodeStructuredMockupSectionContent,
  serializeStructuredMockupSectionContent,
} from "../workItemSections";
import { createProgressiveTemplate } from "../../components/WorkItem/progressiveTemplate";

const buildDefinition = (
  key: string,
  sections: WorkItemTypeDefinitionDto["sections"]
): WorkItemTypeDefinitionDto => ({
  key,
  name: key,
  sections,
  allowedStatuses: [],
});

const STANDARD_DEFINITION = buildDefinition("STANDARD", [
  { key: "description", label: "Description" },
  { key: "acceptanceCriteria", label: "Acceptance Criteria" },
]);

const resolvedSelection = (definition: WorkItemTypeDefinitionDto) =>
  selectWorkItemSections({
    typeKey: definition.key,
    definition,
    isFetched: true,
  });

describe("workItemSections registry selection", () => {
  it("preserves custom keys, labels, and declared order", () => {
    const selection = resolvedSelection(
      buildDefinition("RESEARCH", [
        { key: "findings", label: "Findings" },
        { key: "sources", label: "Evidence sources" },
      ])
    );

    expect(getSelectedSectionKeys(selection)).toEqual(["findings", "sources"]);
    expect(selection).toMatchObject({
      status: "resolved",
      sections: [
        { key: "findings", label: "Findings" },
        { key: "sources", label: "Evidence sources" },
      ],
    });
  });

  it("fails closed while loading or after an unresolved lookup", () => {
    expect(
      getSelectedSectionKeys(
        selectWorkItemSections({
          typeKey: "CONTRACT",
          definition: undefined,
          isFetched: false,
        })
      )
    ).toEqual([]);
    expect(
      selectWorkItemSections({
        typeKey: "CONTRACT",
        definition: undefined,
        isFetched: true,
      })
    ).toEqual({ status: "unavailable", reason: "unresolved" });
  });
});

describe("selectInlineWorkItemSections", () => {
  it("selects every visual section in registry order", () => {
    const selection = resolvedSelection(
      buildDefinition("MOCKUP", [
        { key: "description", label: "Description" },
        { key: "desktop", label: "Desktop", kind: "structured-mockup" },
        { key: "notes", label: "Notes" },
        { key: "mobile", label: "Mobile", kind: "html/css" },
      ])
    );

    expect(
      getSelectedSectionKeys(selectInlineWorkItemSections(selection))
    ).toEqual(["desktop", "mobile"]);
  });

  it("selects no sections when no visual section exists", () => {
    const selection = resolvedSelection(STANDARD_DEFINITION);

    expect(
      getSelectedSectionKeys(selectInlineWorkItemSections(selection))
    ).toEqual([]);
  });

  it("propagates unavailable selections", () => {
    const selection = {
      status: "unavailable",
      reason: "unresolved",
    } as const;

    expect(selectInlineWorkItemSections(selection)).toBe(selection);
  });
});

describe("getTaskContentFromSections", () => {
  it("reads a requirements materialized section", () => {
    const result = getTaskContentFromSections([
      {
        id: "s1",
        key: "description",
        order: 0,
        materializedMarkdown: "desc",
        crdtSnapshotSeq: null,
      },
      {
        id: "s2",
        key: "requirements",
        order: 1,
        materializedMarkdown: "- a bullet",
        crdtSnapshotSeq: null,
      },
    ]);

    expect(result.description).toBe("desc");
    expect(result.requirements).toBe("- a bullet");
    expect(result.acceptanceCriteria).toBe("");
  });

  it("returns empty strings when sections are missing", () => {
    expect(getTaskContentFromSections(undefined)).toEqual({
      description: "",
      acceptanceCriteria: "",
      requirements: "",
    });
  });
});

describe("taskContentToSectionInputs", () => {
  it("round-trips strict html/css content and rejects malformed source", () => {
    const selection = resolvedSelection(
      buildDefinition("ANY_CUSTOM_TYPE", [
        { key: "preview", label: "Preview", kind: "html/css" },
      ])
    );
    const serialized = JSON.stringify({ html: "<main>Hi</main>", css: "" });

    expect(
      taskContentToSectionInputs({ preview: serialized }, { selection })
    ).toEqual([
      {
        key: "preview",
        content: { html: "<main>Hi</main>", css: "" },
        order: 0,
      },
    ]);
    expect(
      taskContentToSectionInputs({ preview: "{}" }, { selection })
    ).toEqual([]);
    expect(
      decodeHtmlCssSectionContent({ html: "x", css: "", extra: true })
    ).toBeNull();
  });

  it("round-trips the optional HTML/CSS annotation sidecar", () => {
    const content = {
      html: '<main data-hh-id="hero">Hi</main>',
      css: "",
      sizeKey: "desktop",
      annotations: [
        {
          id: "10000000-0000-4000-8000-000000000001",
          note: "Keep this prominent.",
          author: {
            type: "human" as const,
            userId: "10000000-0000-4000-8000-000000000002",
          },
          category: "suggestion" as const,
          lifecycle: "open" as const,
          authoredProposalId: "20000000-0000-4000-8000-000000000001",
          authoredSizeKey: "desktop",
          target: {
            type: "position" as const,
            x: 0.25,
            y: 0.75,
            sizeKey: "desktop",
          },
        },
      ],
    };

    expect(
      JSON.parse(serializeHtmlCssSectionContent(content))
    ).toEqual(content);
    expect(
      decodeHtmlCssSectionContent({
        ...content,
        annotations: [content.annotations[0], content.annotations[0]],
      })
    ).toBeNull();
  });
  it("writes description and requirements — not acceptanceCriteria", () => {
    const featureSelection = resolvedSelection(
      buildDefinition("FEATURE", [
        { key: "description", label: "Description" },
        { key: "requirements", label: "Requirements" },
      ])
    );
    const inputs = taskContentToSectionInputs(
      {
        description: "desc",
        requirements: "- req 1\n- req 2",
        acceptanceCriteria: "should be ignored for features",
      },
      { selection: featureSelection }
    );

    expect(inputs).toEqual([
      { key: "description", content: "desc", order: 0 },
      { key: "requirements", content: "- req 1\n- req 2", order: 1 },
    ]);
  });

  it("writes description + acceptanceCriteria for Standard tasks", () => {
    const inputs = taskContentToSectionInputs(
      {
        description: "desc",
        requirements: "should be ignored for standards",
        acceptanceCriteria: "AC",
      },
      { selection: resolvedSelection(STANDARD_DEFINITION) }
    );

    expect(inputs).toEqual([
      { key: "description", content: "desc", order: 0 },
      { key: "acceptanceCriteria", content: "AC", order: 1 },
    ]);
  });

  it("emits empty requirements input when field is empty (includeEmpty default)", () => {
    const inputs = taskContentToSectionInputs(
      {
        description: "desc",
        requirements: "",
        acceptanceCriteria: "",
      },
      {
        selection: resolvedSelection(
          buildDefinition("FEATURE", [
            { key: "description", label: "Description" },
            { key: "requirements", label: "Requirements" },
          ])
        ),
      }
    );

    expect(inputs).toEqual([
      { key: "description", content: "desc", order: 0 },
      { key: "requirements", content: "", order: 1 },
    ]);
  });

  it("returns no inputs when the definition is unavailable", () => {
    expect(
      taskContentToSectionInputs(
        {
          description: "must not leak",
          acceptanceCriteria: "must not leak",
          requirements: "",
        },
        {
          selection: {
            status: "unavailable",
            reason: "loading",
          },
        }
      )
    ).toEqual([]);
  });
});

describe("createProgressiveTemplate", () => {
  it("initializes a new html/css section with editable empty source", () => {
    const definition = buildDefinition("ANY_CUSTOM_TYPE", [
      { key: "preview", label: "Preview", kind: "html/css" },
    ]);

    const template = createProgressiveTemplate({
      entityType: "task",
      definition,
      content: {
        description: "",
        acceptanceCriteria: "",
        requirements: "",
      },
    });

    expect(template.sections[0]?.content.initialText).toBe(
      JSON.stringify({ html: "", css: "" })
    );
  });

  it("initializes a new structured mockup section with a versioned document", () => {
    const definition = buildDefinition("STRUCTURED_MOCKUP_TYPE", [
      {
        key: "mockup",
        label: "Mockup",
        kind: "structured-mockup",
        defaultSizeKey: "panel",
      },
    ]);

    const template = createProgressiveTemplate({
      entityType: "task",
      definition,
      content: {
        description: "",
        acceptanceCriteria: "",
        requirements: "",
      },
    });

    expect(template.sections[0]?.content.initialText).toBe(
      JSON.stringify({
        schemaVersion: "work-item-structured-mockup.v3",
        revision: 1,
        content: [],
        annotations: [],
        sizeKey: "panel",
      })
    );
  });
});

describe("applyTaskSectionInputsToMaterialized", () => {
  it("serializes new structured sections while leaving Markdown text unchanged", () => {
    const content = { schemaVersion: "example.v1", nodes: ["one", "two"] };
    const result = applyTaskSectionInputsToMaterialized(
      [],
      [
        { key: "configuration", content },
        { key: "description", content: "# Plain Markdown" },
      ]
    );
    expect(result?.map((section) => section.materializedMarkdown)).toEqual([
      JSON.stringify(content),
      "# Plain Markdown",
    ]);
  });

  it("materializes custom keys in declared order and removes undeclared sections", () => {
    const selection = resolvedSelection(
      buildDefinition("RESEARCH", [
        { key: "sources", label: "Sources" },
        { key: "findings", label: "Findings" },
      ])
    );

    expect(
      applyTaskSectionInputsToMaterialized(
        [
          {
            id: "legacy-description",
            key: "description",
            order: 0,
            materializedMarkdown: "must be removed",
            crdtSnapshotSeq: null,
          },
        ],
        [
          { key: "findings", content: "Result", order: 99 },
          { key: "sources", content: "Evidence", order: 98 },
        ],
        selection
      )
    ).toEqual([
      {
        id: "temp-sources",
        key: "sources",
        order: 0,
        materializedMarkdown: "Evidence",
        materializedProposalId: "",
        crdtSnapshotSeq: null,
      },
      {
        id: "temp-findings",
        key: "findings",
        order: 1,
        materializedMarkdown: "Result",
        materializedProposalId: "",
        crdtSnapshotSeq: null,
      },
    ]);
  });
});

describe("structured mockup decoding", () => {
  it.each([
    "work-item-structured-mockup.v3",
    "work-item-structured-mockup.v4",
    "work-item-structured-mockup.v5",
  ] as const)("serializes the selected profile for %s without downgrading", (schemaVersion) => {
    const document = {
      schemaVersion,
      revision: 2,
      sizeKey: "panel",
      annotations: [],
      content: [
        {
          type: "text" as const,
          props: {
            id: "title",
            width: { mode: "fit" as const },
            height: { mode: "content" as const },
            text: "Review",
            ...(schemaVersion === "work-item-structured-mockup.v5"
              ? { role: "heading" as const }
              : {}),
          },
        },
      ],
    };

    const decoded = decodeStructuredMockupSectionContent(document);
    expect(decoded).not.toBeNull();
    expect(
      JSON.parse(serializeStructuredMockupSectionContent(decoded))
    ).toEqual(document);
  });

  it("keeps modern container layout valid when a document advances to v4", () => {
    const value = {
      schemaVersion: "work-item-structured-mockup.v4",
      revision: 2,
      annotations: [],
      content: [
        {
          type: "row",
          props: {
            id: "existing-row",
            width: { mode: "fit" },
            height: { mode: "content" },
            gap: 8,
            padding: 8,
            justify: "spread",
            align: "stretch",
            surface: "plain",
          },
          children: [],
        },
        {
          type: "icon",
          props: {
            id: "new-icon",
            width: { mode: "fit" },
            height: { mode: "content" },
            iconKey: "star",
            accessibleLabel: "Icon",
          },
        },
      ],
    };

    expect(decodeStructuredMockupSectionContent(value)).toEqual(value);
  });

  it("preserves v4 reusable occurrences and ordered nested slot children", () => {
    const value = {
      schemaVersion: "work-item-structured-mockup.v4",
      revision: 3,
      annotations: [],
      content: [
        {
          type: "mockup-occurrence",
          props: {
            id: "occurrence-1",
            width: { mode: "fit" },
            height: { mode: "content" },
            sourceMockupId: "10000000-0000-4000-8000-000000000001",
            slotAssignments: [
              {
                slotName: "body",
                children: [
                  {
                    type: "text",
                    props: {
                      id: "child-1",
                      width: { mode: "fit" },
                      height: { mode: "content" },
                      text: "First",
                    },
                  },
                  {
                    type: "icon",
                    props: {
                      id: "child-2",
                      width: { mode: "fit" },
                      height: { mode: "content" },
                      iconKey: "star",
                      accessibleLabel: "Star",
                    },
                  },
                ],
              },
            ],
          },
        },
      ],
    };
    expect(decodeStructuredMockupSectionContent(value)).toEqual(value);
  });
  const layout = {
    width: { mode: "fit" },
    height: { mode: "content" },
  };

  it("accepts the closed primitive vocabulary and stable nested identities", () => {
    expect(
      decodeStructuredMockupSectionContent({
        schemaVersion: "work-item-structured-mockup.v1",
        sizeKey: "panel",
        content: [
          {
            type: "row",
            props: {
              id: "actions",
              ...layout,
              gap: 12,
              padding: 8,
              align: "spread",
            },
            children: [
              {
                type: "button",
                props: { id: "save", ...layout, label: "Save" },
              },
              {
                type: "button",
                props: { id: "cancel", ...layout, label: "Cancel" },
              },
            ],
          },
        ],
      })
    ).toMatchObject({
      content: [
        {
          type: "row",
          props: { id: "actions", justify: "spread", align: "stretch" },
          children: [
            { type: "button", props: { id: "save" } },
            { type: "button", props: { id: "cancel" } },
          ],
        },
      ],
    });
  });

  it("rejects duplicate identities and executable or style-bearing data", () => {
    const unsafeDocuments = [
      {
        schemaVersion: "work-item-structured-mockup.v1",
        content: [
          { type: "text", props: { id: "same", ...layout, text: "One" } },
          { type: "text", props: { id: "same", ...layout, text: "Two" } },
        ],
      },
      {
        schemaVersion: "work-item-structured-mockup.v1",
        content: [
          {
            type: "text",
            props: { id: "unsafe", ...layout, text: "Text", script: "run()" },
          },
        ],
      },
      {
        schemaVersion: "work-item-structured-mockup.v1",
        content: [
          {
            type: "image",
            props: { id: "remote", ...layout, src: "https://example.com/x" },
          },
        ],
      },
    ];

    unsafeDocuments.forEach((document) =>
      expect(decodeStructuredMockupSectionContent(document)).toBeNull()
    );
  });

  it("validates v2 annotation identities, authors, targets, proposal, and size context", () => {
    const document = {
      schemaVersion: "work-item-structured-mockup.v2",
      revision: 3,
      sizeKey: "desktop",
      content: [
        { type: "text", props: { id: "title", ...layout, text: "Title" } },
      ],
      annotations: [
        {
          id: "10000000-0000-4000-8000-000000000001",
          note: "Should this title be shorter?",
          author: {
            type: "human",
            userId: "10000000-0000-4000-8000-000000000002",
          },
          category: "question",
          lifecycle: "open",
          authoredProposalId: "20000000-0000-4000-8000-000000000001",
          authoredSizeKey: "desktop",
          target: { type: "component", componentId: "title" },
        },
        {
          id: "10000000-0000-4000-8000-000000000004",
          note: "Leave room for another action.",
          author: {
            type: "agent",
            agentSessionId: "10000000-0000-4000-8000-000000000005",
          },
          category: "suggestion",
          lifecycle: "resolved",
          authoredProposalId: "20000000-0000-4000-8000-000000000001",
          authoredSizeKey: "desktop",
          target: { type: "position", x: 0.25, y: 0.75 },
        },
      ],
    };

    expect(decodeStructuredMockupSectionContent(document)).toEqual({
      ...document,
      schemaVersion: "work-item-structured-mockup.v3",
    });
    expect(
      decodeStructuredMockupSectionContent({
        ...document,
        annotations: [document.annotations[0], { ...document.annotations[0] }],
      })
    ).toBeNull();
    const { authoredProposalId: _authoredProposalId, ...legacyAnnotation } =
      document.annotations[0];
    expect(
      decodeStructuredMockupSectionContent({
        ...document,
        annotations: [{ ...legacyAnnotation, authoredRevision: 3 }],
      })?.annotations
    ).toEqual([]);
    expect(
      decodeStructuredMockupSectionContent({
        ...document,
        annotations: [
          {
            ...document.annotations[0],
            target: { type: "position", x: 1.1, y: 0 },
          },
        ],
      })
    ).toBeNull();
    expect(
      decodeStructuredMockupSectionContent({
        ...document,
        annotations: [
          {
            ...document.annotations[0],
            target: { type: "component", componentId: "missing" },
          },
        ],
      })
    ).not.toBeNull();
    expect(
      decodeStructuredMockupSectionContent({
        ...document,
        annotations: [
          {
            ...document.annotations[0],
            conversationId: "10000000-0000-4000-8000-000000000003",
          },
        ],
      })
    ).toBeNull();
  });

  it("accepts the controlled v5 visual vocabulary and rejects escapes", () => {
    const document = {
      schemaVersion: "work-item-structured-mockup.v5",
      revision: 1,
      content: [
        {
          type: "column",
          props: {
            id: "panel",
            ...layout,
            gap: 8,
            padding: 8,
            justify: "start",
            align: "stretch",
            role: "region",
            description: "Settings panel",
            color: "surface",
            opacity: 1,
            overflow: "hidden",
          },
          children: [
            {
              type: "icon",
              props: {
                id: "settings",
                ...layout,
                iconKey: "settings",
                accessibleLabel: "Settings",
              },
            },
            {
              type: "caret",
              props: {
                id: "expand",
                ...layout,
                direction: "down",
              },
            },
            {
              type: "shape",
              props: {
                id: "status",
                ...layout,
                kind: "circle",
                color: "success",
              },
            },
            {
              type: "divider",
              props: {
                id: "separator",
                ...layout,
                orientation: "horizontal",
                role: "separator",
              },
            },
          ],
        },
      ],
      annotations: [],
    };

    expect(decodeStructuredMockupSectionContent(document)).toEqual(document);
    expect(
      decodeStructuredMockupSectionContent({
        ...document,
        content: [
          {
            ...document.content[0],
            children: [
              {
                type: "icon",
                props: {
                  id: "unsafe-icon",
                  ...layout,
                  iconKey: "custom-svg",
                  accessibleLabel: "Unsafe",
                },
              },
            ],
          },
        ],
      })
    ).toBeNull();
    expect(
      decodeStructuredMockupSectionContent({
        ...document,
        content: [
          {
            type: "shape",
            props: {
              id: "invalid-opacity",
              ...layout,
              kind: "circle",
              opacity: 1.01,
            },
          },
        ],
      })
    ).toBeNull();
    expect(
      decodeStructuredMockupSectionContent({
        ...document,
        content: [
          {
            type: "caret",
            props: {
              id: "unknown-key",
              ...layout,
              direction: "down",
              style: { color: "red" },
            },
          },
        ],
      })
    ).toBeNull();
  });
});
