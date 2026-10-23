import { describe, expect, it } from "vitest";
import { structuredMockupAcceptanceFixture } from "../structuredMockupAcceptanceFixture";
import { decodeStructuredMockupSectionContent } from "../../../utils/workItemSections";
import type { WorkItemStructuredMockupSectionContent } from "../../../api";
import {
  puckDataToStructuredMockupDocument,
  resolveStructuredMockupContainerLayout,
  structuredMockupDocumentToPuckData,
  structuredMockupPuckConfig,
} from "../structuredMockupPuck";

const layout = {
  width: { mode: "fit" as const },
  height: { mode: "content" as const },
};

describe("structured mockup Puck adapter", () => {
  it("round-trips slots, icons, and per-occurrence ordered children", () => {
    const document = decodeStructuredMockupSectionContent({
      schemaVersion: "work-item-structured-mockup.v4",
      revision: 1,
      sizeKey: "panel",
      annotations: [],
      content: [
        {
          type: "mockup-occurrence",
          props: {
            id: "occurrence",
            width: { mode: "fit" },
            height: { mode: "content" },
            sourceMockupId: "10000000-0000-4000-8000-000000000001",
            slotAssignments: [
              {
                slotName: "body",
                children: [
                  {
                    type: "icon",
                    props: {
                      id: "icon",
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
    });
    if (!document) throw new Error("Expected v4 document");
    expect(
      puckDataToStructuredMockupDocument(
        structuredMockupDocumentToPuckData(document),
        document
      ).content
    ).toEqual(document.content);
  });
  it("round-trips v5 primitives, semantic metadata, and bounded appearance", () => {
    const source = {
      schemaVersion: "work-item-structured-mockup.v5" as const,
      revision: 3,
      sizeKey: "panel",
      annotations: [],
      content: [
        {
          type: "row" as const,
          props: {
            id: "controls",
            width: { mode: "fill" as const },
            height: { mode: "content" as const },
            gap: 8,
            padding: 4,
            justify: "spread" as const,
            align: "center" as const,
            role: "navigation" as const,
            description: "Primary navigation controls",
            color: "primary" as const,
            opacity: 0.8,
            overflow: "hidden" as const,
          },
          children: [
            {
              type: "icon" as const,
              props: {
                id: "settings",
                width: { mode: "fit" as const },
                height: { mode: "content" as const },
                iconKey: "settings" as const,
                accessibleLabel: "Settings",
              },
            },
            {
              type: "caret" as const,
              props: {
                id: "next",
                width: { mode: "fit" as const },
                height: { mode: "content" as const },
                direction: "right" as const,
                color: "muted" as const,
              },
            },
            {
              type: "shape" as const,
              props: {
                id: "marker",
                width: { mode: "fixed" as const, value: 24 },
                height: { mode: "fixed" as const, value: 24 },
                kind: "diamond" as const,
                color: "warning" as const,
              },
            },
            {
              type: "divider" as const,
              props: {
                id: "rule",
                width: { mode: "fit" as const },
                height: { mode: "content" as const },
                orientation: "vertical" as const,
              },
            },
          ],
        },
      ],
    };
    const document = decodeStructuredMockupSectionContent(source);
    expect(document).toEqual(source);
    if (!document) throw new Error("Expected v5 document");
    const puck = structuredMockupDocumentToPuckData(document);
    expect(puck.content.map((component) => component.type)).toEqual(["row"]);
    expect(
      puck.content[0]?.props.children.map((component) => component.type)
    ).toEqual(["icon", "caret", "shape", "divider"]);
    expect(puckDataToStructuredMockupDocument(puck, document)).toEqual(source);
  });

  it("keeps the selected presentation profile in v3 Puck data", () => {
    const document = decodeStructuredMockupSectionContent({
      schemaVersion: "work-item-structured-mockup.v3",
      revision: 2,
      sizeKey: "panel",
      annotations: [],
      content: [
        {
          type: "text",
          props: {
            id: "title",
            width: { mode: "fit" },
            height: { mode: "content" },
            text: "Review",
          },
        },
      ],
    });
    if (!document) throw new Error("Expected v3 document");

    const puckData = structuredMockupDocumentToPuckData(document);
    expect(puckData.root).toEqual({ props: { sizeKey: "panel" } });
    expect(puckDataToStructuredMockupDocument(puckData)).toMatchObject({
      schemaVersion: "work-item-structured-mockup.v3",
      sizeKey: "panel",
      revision: 1,
    });
  });
  it("exposes independent Justify and Align controls", () => {
    expect(
      structuredMockupPuckConfig.components.row.fields?.justify
    ).toMatchObject({
      label: "Justify",
      options: [
        { label: "Start", value: "start" },
        { label: "Center", value: "center" },
        { label: "End", value: "end" },
        { label: "Spread", value: "spread" },
      ],
    });
    expect(
      structuredMockupPuckConfig.components.row.fields?.align
    ).toMatchObject({
      label: "Align",
      options: [
        { label: "Start", value: "start" },
        { label: "Center", value: "center" },
        { label: "End", value: "end" },
        { label: "Stretch", value: "stretch" },
      ],
    });
  });

  it("keeps semantic role creation-time metadata out of editable fields", () => {
    expect(structuredMockupPuckConfig.components.text.fields).not.toHaveProperty(
      "role"
    );
    expect(
      structuredMockupPuckConfig.components["mockup-occurrence"].fields
    ).not.toHaveProperty("role");
  });

  it("keeps insertion defaults and resolves reusable sources only for inserts", () => {
    expect(structuredMockupPuckConfig.components.text.defaultProps).toEqual(
      expect.objectContaining({ text: "Text" })
    );
    expect(structuredMockupPuckConfig.components.button.defaultProps).toEqual(
      expect.objectContaining({ label: "Button" })
    );
    expect(
      structuredMockupPuckConfig.components.rectangle.defaultProps
    ).toEqual(expect.objectContaining({ label: "" }));
    expect(structuredMockupPuckConfig.components.icon.defaultProps).toEqual(
      expect.objectContaining({ iconKey: "star", accessibleLabel: "Icon" })
    );
    expect(structuredMockupPuckConfig.components.slot.defaultProps).toEqual(
      expect.objectContaining({ name: "slot", children: [] })
    );
    expect(
      structuredMockupPuckConfig.components["mockup-occurrence"].defaultProps
    ).toEqual(expect.objectContaining({ slotAssignmentsJson: "[]" }));

    const resolveData =
      structuredMockupPuckConfig.components["mockup-occurrence"].resolveData;
    if (!resolveData) throw new Error("Expected occurrence data resolver");

    expect(
      resolveData(
        {
          props: {
            id: "generated-by-puck",
            widthMode: "fit",
            widthValue: 240,
            heightMode: "content",
            heightValue: 80,
            sourceMockupId: "old-source",
            slotAssignmentsJson: '[{"stale":true}]',
          },
        },
        {
          changed: {},
          lastData: null,
          metadata: { sourceMockupId: "selected-source" },
          trigger: "insert",
          parent: null,
          root: { props: {} },
        }
      )
    ).toEqual({
      props: {
        sourceMockupId: "selected-source",
        slotAssignmentsJson: "[]",
      },
    });
    expect(
      resolveData(
        {
          props: {
            id: "existing-occurrence",
            widthMode: "fit",
            widthValue: 240,
            heightMode: "content",
            heightValue: 80,
            sourceMockupId: "existing-source",
            slotAssignmentsJson: "[]",
          },
        },
        {
          changed: {},
          lastData: null,
          metadata: { sourceMockupId: "selected-source" },
          trigger: "move",
          parent: null,
          root: { props: {} },
        }
      )
    ).toEqual({ props: {} });
  });

  it.each([
    ["start", "flex-start"],
    ["center", "center"],
    ["end", "flex-end"],
    ["spread", "space-between"],
  ] as const)("maps %s justification to %s", (justify, justifyContent) => {
    expect(
      resolveStructuredMockupContainerLayout({
        direction: "row",
        justify,
        align: "stretch",
        padding: 0,
        gap: 0,
      }).justifyContent
    ).toBe(justifyContent);
  });

  it("resolves cross-axis alignment independently", () => {
    const resolved = resolveStructuredMockupContainerLayout({
      direction: "row",
      justify: "end",
      align: "center",
      padding: 0,
      gap: 0,
    });
    expect(resolved.justifyContent).toBe("flex-end");
    expect(resolved.alignItems).toBe("center");
  });

  it.each([
    ["start", "flex-start"],
    ["center", "center"],
    ["end", "flex-end"],
    ["stretch", "stretch"],
  ] as const)("maps %s alignment to %s", (align, alignItems) => {
    expect(
      resolveStructuredMockupContainerLayout({
        direction: "column",
        justify: "spread",
        align,
        padding: 0,
        gap: 0,
      })
    ).toMatchObject({ justifyContent: "space-between", alignItems });
  });

  it("persists edits to text role and multiline mode rather than dropping the new fields", () => {
    const source: WorkItemStructuredMockupSectionContent = {
      schemaVersion: "work-item-structured-mockup.v1",
      content: [
        {
          type: "text",
          props: { id: "title", ...layout, text: "Notes", variant: "body" },
        },
        {
          type: "input",
          props: {
            id: "notes",
            ...layout,
            label: "Notes",
            placeholder: "",
            multiline: false,
          },
        },
      ],
    };
    const data = structuredMockupDocumentToPuckData(
      decodeStructuredMockupSectionContent(source)!
    );
    const changed: typeof data = {
      ...data,
      content: data.content.map((component) => {
        if (component.type === "text")
          return {
            ...component,
            props: { ...component.props, variant: "heading" },
          };
        if (component.type === "input")
          return {
            ...component,
            props: {
              ...component.props,
              multiline: true,
              value: "First\nSecond",
            },
          };
        return component;
      }),
    };
    const saved = puckDataToStructuredMockupDocument(changed);
    expect(saved.content[0]).toMatchObject({ props: { variant: "heading" } });
    expect(saved.content[1]).toMatchObject({
      props: { multiline: true, value: "First\nSecond" },
    });
    expect(structuredMockupDocumentToPuckData(saved)).toEqual(changed);
  });

  it.each([{ variant: ["heading"] }, { variant: "unknown" }])(
    "rejects invalid text roles: %s",
    (extra) => {
      expect(
        decodeStructuredMockupSectionContent({
          schemaVersion: "work-item-structured-mockup.v1",
          content: [
            {
              type: "text",
              props: { id: "text", ...layout, text: "Notes", ...extra },
            },
          ],
        })
      ).toBeNull();
    }
  );
  it("preserves the two-panel composition and expressive fields through edit/save/reopen", () => {
    const decoded = decodeStructuredMockupSectionContent(
      structuredMockupAcceptanceFixture
    );
    expect(decoded).toEqual(structuredMockupAcceptanceFixture);
    if (!decoded) throw new Error("Expected acceptance document");
    const data = structuredMockupDocumentToPuckData(decoded);
    const saved = puckDataToStructuredMockupDocument(data, decoded);
    expect(saved).toEqual(structuredMockupAcceptanceFixture);
    expect(
      structuredMockupDocumentToPuckData(
        decodeStructuredMockupSectionContent(JSON.stringify(saved))!
      )
    ).toEqual(data);
  });

  it("round trips nested structure, order, identities, and size selection", () => {
    const document: WorkItemStructuredMockupSectionContent = {
      schemaVersion: "work-item-structured-mockup.v1",
      sizeKey: "panel",
      content: [
        {
          type: "column",
          props: {
            id: "actions",
            ...layout,
            gap: 12,
            padding: 8,
            align: "start",
          },
          children: [
            {
              type: "button",
              props: { id: "primary", ...layout, label: "Primary" },
            },
            {
              type: "button",
              props: { id: "secondary", ...layout, label: "Secondary" },
            },
          ],
        },
      ],
    };

    const decoded = decodeStructuredMockupSectionContent(document);
    expect(decoded).not.toBeNull();
    const puckData = structuredMockupDocumentToPuckData(decoded!);
    expect(puckData.content[0]?.props.id).toBe("actions");
    expect(puckData.content[0]?.props.children).toHaveLength(2);
    expect(puckDataToStructuredMockupDocument(puckData, decoded!)).toEqual({
      ...decoded,
      revision: 1,
    });
  });

  it("does not advance the revision when a resolved annotation is rehydrated", () => {
    const document = decodeStructuredMockupSectionContent({
      schemaVersion: "work-item-structured-mockup.v2",
      revision: 4,
      content: [],
      annotations: [
        {
          id: "10000000-0000-4000-8000-000000000001",
          note: "Keep this current after reload.",
          author: {
            type: "human",
            userId: "10000000-0000-4000-8000-000000000002",
          },
          category: "context",
          lifecycle: "resolved",
          authoredProposalId: "20000000-0000-4000-8000-000000000001",
          authoredSizeKey: "default",
          target: { type: "position", x: 0.5, y: 0.5 },
        },
      ],
    });
    if (!document) throw new Error("Expected resolved annotation document");

    const rehydrated = puckDataToStructuredMockupDocument(
      structuredMockupDocumentToPuckData(document),
      document
    );

    expect(rehydrated.revision).toBe(4);
    expect(rehydrated.annotations[0]).toMatchObject({
      lifecycle: "resolved",
      authoredProposalId: "20000000-0000-4000-8000-000000000001",
    });
  });

  it("preserves annotations while composition edits advance the document revision", () => {
    const document = decodeStructuredMockupSectionContent({
      schemaVersion: "work-item-structured-mockup.v2",
      revision: 4,
      sizeKey: "panel",
      content: [
        { type: "button", props: { id: "save", ...layout, label: "Save" } },
      ],
      annotations: [
        {
          id: "10000000-0000-4000-8000-000000000001",
          note: "Keep the primary action visible.",
          author: {
            type: "agent",
            agentSessionId: "10000000-0000-4000-8000-000000000002",
          },
          category: "context",
          lifecycle: "open",
          authoredProposalId: "20000000-0000-4000-8000-000000000001",
          authoredSizeKey: "panel",
          target: { type: "component", componentId: "save" },
        },
      ],
    });
    if (!document) throw new Error("Expected annotation document");
    const data = structuredMockupDocumentToPuckData(document);
    const changed = {
      ...data,
      content: data.content.map((component) =>
        component.type === "button"
          ? { ...component, props: { ...component.props, label: "Publish" } }
          : component
      ),
    };

    const saved = puckDataToStructuredMockupDocument(changed, document);
    expect(saved.revision).toBe(5);
    expect(saved.annotations).toEqual(document.annotations);
    expect(saved.content[0]).toMatchObject({ props: { label: "Publish" } });
  });

  it("persists a vertical container changed to a spread row", () => {
    const source: WorkItemStructuredMockupSectionContent = {
      schemaVersion: "work-item-structured-mockup.v1",
      content: [
        {
          type: "column",
          props: {
            id: "actions",
            ...layout,
            gap: 8,
            padding: 0,
            align: "start",
          },
          children: [],
        },
      ],
    };
    const puckData = structuredMockupDocumentToPuckData(
      decodeStructuredMockupSectionContent(source)!
    );
    const [container] = puckData.content;
    if (!container) throw new Error("Expected container");

    const changedData = {
      ...puckData,
      content: [
        {
          ...container,
          props: {
            ...container.props,
            direction: "row" as const,
            justify: "spread" as const,
            align: "end" as const,
          },
        },
      ],
    };

    expect(
      puckDataToStructuredMockupDocument(changedData).content[0]
    ).toMatchObject({
      type: "row",
      props: { id: "actions", justify: "spread", align: "end" },
    });
  });
});
