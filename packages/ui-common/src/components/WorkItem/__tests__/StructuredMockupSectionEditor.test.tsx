import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { StructuredMockupSectionEditor } from "../StructuredMockupSectionEditor";
import { decodeStructuredMockupSectionContent } from "../../../utils/workItemSections";

const definition = {
  key: "mockup",
  label: "Mockup",
  kind: "structured-mockup" as const,
};
const layout = {
  width: { mode: "fit" as const },
  height: { mode: "content" as const },
};

describe("StructuredMockupSectionEditor", () => {
  const materializedProposalId = "20000000-0000-4000-8000-000000000001";
  it("exposes native Puck drag sources without adding palette controls to the document", async () => {
    const initialValue = JSON.stringify({
      schemaVersion: "work-item-structured-mockup.v3",
      revision: 1,
      content: [
        {
          type: "row",
          props: {
            id: "existing-row",
            ...layout,
            gap: 8,
            padding: 8,
            justify: "spread",
            align: "stretch",
            surface: "plain",
          },
          children: [
            {
              type: "text",
              props: { id: "existing-text", ...layout, text: "Existing" },
            },
          ],
        },
      ],
      annotations: [],
    });
    const onChange = vi.fn();
    render(
      <StructuredMockupSectionEditor
        definition={definition}
        value={initialValue}
        onChange={onChange}
      />
    );

    expect(await screen.findByTestId("drawer-item:icon")).toBeInTheDocument();
    expect(await screen.findByTestId("drawer-item:column")).toBeInTheDocument();
    expect(await screen.findByTestId("drawer-item:shape")).toBeInTheDocument();
    expect(
      await screen.findByTestId("drawer-item:divider")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("drawer-item:caret")).not.toBeInTheDocument();
    expect(screen.getByTestId("drawer-item:button")).toBeInTheDocument();
    expect(screen.getByTestId("drawer-item:text")).toBeInTheDocument();
    expect(
      screen
        .getByTestId("structured-mockup-insertion-palette")
        .closest("[data-puck-drawer]")
    ).toBeTruthy();
    expect(
      screen.getByTestId("structured-mockup-insertion-palette")
    ).not.toHaveTextContent("Existing");
    expect(
      screen.queryByTestId("structured-mockup-placement-preview")
    ).not.toBeInTheDocument();
    expect(
      decodeStructuredMockupSectionContent(initialValue)?.content
    ).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("exposes separate rectangle and named-slot drag sources", async () => {
    const onChange = vi.fn();
    const value = JSON.stringify({
      schemaVersion: "work-item-structured-mockup.v3",
      revision: 1,
      content: [],
      annotations: [],
    });
    render(
      <StructuredMockupSectionEditor
        definition={definition}
        value={value}
        onChange={onChange}
      />
    );
    expect(await screen.findByTestId("drawer-item:text")).toBeInTheDocument();
    expect(screen.getByTestId("drawer-item:rectangle")).toBeInTheDocument();
    expect(await screen.findByTestId("drawer-item:slot")).toBeInTheDocument();
    expect(
      screen.getByTestId("structured-mockup-insert-rectangle")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("structured-mockup-insert-slot")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("structured-mockup-insert-container")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("structured-mockup-insert-caret")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("structured-mockup-insert-shape")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("structured-mockup-insert-divider")
    ).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("disables native palette dragging with the editor", async () => {
    render(
      <StructuredMockupSectionEditor
        definition={definition}
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v3",
          revision: 1,
          content: [],
          annotations: [],
        })}
        onChange={vi.fn()}
        disabled
      />
    );

    expect((await screen.findByTestId("drawer-item:text")).className).toMatch(
      /disabled/
    );
  });

  it("opens mockup-only component search with the shared entity icon", () => {
    render(
      <StructuredMockupSectionEditor
        organizationId="org"
        projectId="project"
        definition={definition}
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v3",
          revision: 1,
          content: [],
          annotations: [],
        })}
        onChange={vi.fn()}
      />
    );
    fireEvent.click(screen.getByTestId("structured-mockup-insert-component"));
    expect(
      screen.getByTestId("structured-mockup-component-search-dialog")
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Search mockups")).toBeInTheDocument();
  });
  it("creates a standalone coordinate note without changing the composition revision", async () => {
    const onChange = vi.fn();
    render(
      <StructuredMockupSectionEditor
        materializedProposalId={materializedProposalId}
        definition={definition}
        authorUserId="10000000-0000-4000-8000-000000000001"
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v2",
          revision: 4,
          content: [],
          annotations: [],
        })}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByTestId("structured-mockup-add-annotation"));
    const location = screen.getByLabelText("Choose annotation location");
    vi.spyOn(location, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 1000,
      bottom: 500,
      width: 1000,
      height: 500,
      toJSON: () => ({}),
    });
    fireEvent.click(location, { clientX: 250, clientY: 375 });
    fireEvent.change(screen.getByLabelText("Note"), {
      target: { value: "Add an empty-state action here." },
    });
    fireEvent.mouseDown(screen.getByLabelText("Category"));
    fireEvent.click(await screen.findByRole("option", { name: "Suggestion" }));
    fireEvent.click(screen.getByRole("button", { name: "Add note" }));

    const saved = JSON.parse(onChange.mock.calls.at(-1)?.[0] ?? "null");
    expect(saved).toMatchObject({
      schemaVersion: "work-item-structured-mockup.v3",
      revision: 4,
      annotations: [
        {
          note: "Add an empty-state action here.",
          author: {
            type: "human",
            userId: "10000000-0000-4000-8000-000000000001",
          },
          category: "suggestion",
          lifecycle: "open",
          authoredProposalId: materializedProposalId,
          authoredSizeKey: "default",
          target: { type: "position", x: 0.25, y: 0.75 },
        },
      ],
    });
  });

  it("resolves a current note without advancing the composition revision", () => {
    const onChange = vi.fn();
    render(
      <StructuredMockupSectionEditor
        materializedProposalId={materializedProposalId}
        definition={definition}
        authorUserId="10000000-0000-4000-8000-000000000001"
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v2",
          revision: 2,
          content: [],
          annotations: [
            {
              id: "10000000-0000-4000-8000-000000000002",
              note: "Clarify this state.",
              author: {
                type: "human",
                userId: "10000000-0000-4000-8000-000000000001",
              },
              category: "question",
              lifecycle: "open",
              authoredProposalId: materializedProposalId,
              authoredSizeKey: "default",
              target: { type: "position", x: 0.5, y: 0.5 },
            },
          ],
        })}
        onChange={onChange}
      />
    );

    fireEvent.click(
      screen.getByTestId("structured-mockup-annotations-expanded")
    );
    fireEvent.click(screen.getByTestId("structured-mockup-resolve-annotation"));

    const saved = JSON.parse(onChange.mock.calls.at(-1)?.[0] ?? "null");
    expect(saved.revision).toBe(2);
    expect(saved.annotations[0].lifecycle).toBe("resolved");
  });

  it("keeps a resolved note current when the persisted document is reloaded", async () => {
    const onChange = vi.fn();
    const document = {
      schemaVersion: "work-item-structured-mockup.v2",
      revision: 2,
      content: [],
      annotations: [
        {
          id: "10000000-0000-4000-8000-000000000002",
          note: "Clarify this state.",
          author: {
            type: "human",
            userId: "10000000-0000-4000-8000-000000000001",
          },
          category: "question",
          lifecycle: "open",
          authoredProposalId: materializedProposalId,
          authoredSizeKey: "default",
          target: { type: "position", x: 0.5, y: 0.5 },
        },
      ],
    } as const;
    const { rerender } = render(
      <StructuredMockupSectionEditor
        materializedProposalId={materializedProposalId}
        definition={definition}
        authorUserId="10000000-0000-4000-8000-000000000001"
        value={JSON.stringify(document)}
        onChange={onChange}
      />
    );

    fireEvent.click(
      screen.getByTestId("structured-mockup-annotations-expanded")
    );
    fireEvent.click(screen.getByTestId("structured-mockup-resolve-annotation"));
    const persistedValue = onChange.mock.calls.at(-1)?.[0] ?? "";
    onChange.mockClear();

    rerender(
      <StructuredMockupSectionEditor
        materializedProposalId={materializedProposalId}
        definition={definition}
        authorUserId="10000000-0000-4000-8000-000000000001"
        value={persistedValue}
        onChange={onChange}
      />
    );

    await waitFor(() => expect(onChange).not.toHaveBeenCalled());
    expect(screen.getByText("resolved")).toBeInTheDocument();
    expect(screen.queryByText("outdated")).not.toBeInTheDocument();
  });

  it("reopens an outdated resolved note without changing its revision or content", () => {
    const onChange = vi.fn();
    const originalContent = [
      { type: "button", props: { id: "save", ...layout, label: "Save" } },
    ];
    render(
      <StructuredMockupSectionEditor
        materializedProposalId={materializedProposalId}
        definition={definition}
        authorUserId="10000000-0000-4000-8000-000000000001"
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v2",
          revision: 3,
          content: originalContent,
          annotations: [
            {
              id: "10000000-0000-4000-8000-000000000002",
              note: "Recheck this action.",
              author: {
                type: "human",
                userId: "10000000-0000-4000-8000-000000000001",
              },
              category: "question",
              lifecycle: "resolved",
              authoredProposalId: "20000000-0000-4000-8000-000000000002",
              authoredSizeKey: "default",
              target: { type: "position", x: 0.5, y: 0.5 },
            },
          ],
        })}
        onChange={onChange}
      />
    );

    fireEvent.click(
      screen.getByTestId("structured-mockup-annotations-expanded")
    );
    expect(screen.getByText("outdated")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("structured-mockup-reopen-annotation"));

    const saved = JSON.parse(onChange.mock.calls.at(-1)?.[0] ?? "null");
    expect(saved).toMatchObject({ revision: 3, content: originalContent });
    expect(saved.annotations[0]).toMatchObject({
      lifecycle: "open",
      authoredProposalId: "20000000-0000-4000-8000-000000000002",
    });
  });

  it("starts the same placement mode from the canvas Add note command", async () => {
    render(
      <StructuredMockupSectionEditor
        materializedProposalId={materializedProposalId}
        definition={definition}
        authorUserId="10000000-0000-4000-8000-000000000001"
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v2",
          revision: 1,
          content: [],
          annotations: [],
        })}
        onChange={vi.fn()}
      />
    );

    fireEvent.contextMenu(screen.getByTestId("structured-mockup-canvas"), {
      clientX: 20,
      clientY: 30,
    });
    fireEvent.click(
      await screen.findByTestId("structured-mockup-context-add-annotation")
    );
    expect(
      screen.getByLabelText("Choose annotation location")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("structured-mockup-add-annotation")
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("keeps the canvas reachable and exposes selection-anchored property actions", async () => {
    render(
      <StructuredMockupSectionEditor
        materializedProposalId={materializedProposalId}
        definition={definition}
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v1",
          content: [
            {
              type: "button",
              props: { id: "save", ...layout, label: "Save" },
            },
          ],
        })}
        onChange={vi.fn()}
      />
    );

    const controls = screen.getByTestId("structured-mockup-controls");
    const scrollport = screen.getByTestId(
      "structured-mockup-canvas-scrollport"
    );
    expect(controls.compareDocumentPosition(scrollport)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(
      screen.queryByTestId("structured-mockup-properties")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Components")).not.toBeInTheDocument();
    expect(screen.getByTestId("structured-mockup-undo")).toBeDisabled();
    expect(screen.getByTestId("structured-mockup-redo")).toBeDisabled();

    fireEvent.click(screen.getByText("Save"));
    expect(
      await screen.findByTestId("structured-mockup-property-action-sizing")
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId("structured-mockup-property-action-sizing")
    );
    const dialog = await screen.findByTestId(
      "structured-mockup-property-dialog-sizing"
    );
    fireEvent.mouseOver(
      screen.getByTestId("structured-mockup-property-action-sizing")
    );
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "Sizing options"
    );
    expect(dialog).toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId("structured-mockup-property-action-sizing")
    );
    expect(
      screen.queryByTestId("structured-mockup-property-dialog-sizing")
    ).not.toBeInTheDocument();
  });

  it("exposes only property groups backed by the selected component fields", async () => {
    render(
      <StructuredMockupSectionEditor
        definition={definition}
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v1",
          content: [
            {
              type: "divider",
              props: { id: "rule", ...layout },
            },
            {
              type: "text",
              props: {
                id: "caption",
                ...layout,
                text: "Caption",
                variant: "body",
              },
            },
          ],
        })}
        onChange={vi.fn()}
      />
    );

    const divider = screen
      .getByTestId("structured-mockup-canvas")
      .querySelector<HTMLElement>('[role="separator"]');
    if (!divider) throw new Error("Expected divider");
    fireEvent.click(divider);
    expect(
      await screen.findByTestId("structured-mockup-property-action-sizing")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("structured-mockup-property-action-content")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("structured-mockup-property-action-layout")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("structured-mockup-property-action-spacing")
    ).not.toBeInTheDocument();
    expect(
      await screen.findByTestId("structured-mockup-property-action-appearance")
    ).toBeInTheDocument();

    fireEvent.click(screen.getByText("Caption"));
    expect(
      await screen.findByTestId("structured-mockup-property-action-text")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("structured-mockup-property-action-appearance")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("structured-mockup-property-action-layout")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("structured-mockup-property-action-content")
    ).not.toBeInTheDocument();
  });

  it("closes the property popover when another canvas element is selected", async () => {
    const onChange = vi.fn();
    render(
      <StructuredMockupSectionEditor
        definition={definition}
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v1",
          content: [
            {
              type: "button",
              props: { id: "primary", ...layout, label: "Primary" },
            },
            {
              type: "text",
              props: {
                id: "secondary",
                ...layout,
                text: "Secondary",
              },
            },
          ],
        })}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByText("Primary"));
    fireEvent.click(
      await screen.findByTestId("structured-mockup-property-action-sizing")
    );
    await screen.findByTestId("structured-mockup-property-dialog-sizing");

    fireEvent.click(screen.getByText("Secondary"));
    await waitFor(() =>
      expect(
        screen.queryByTestId("structured-mockup-property-dialog-sizing")
      ).not.toBeInTheDocument()
    );
    expect(
      await screen.findByTestId("structured-mockup-property-action-text")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("structured-mockup-property-action-content")
    ).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("routes content, appearance, and spacing edits through the structured document", async () => {
    const onChange = vi.fn();
    const document = {
      schemaVersion: "work-item-structured-mockup.v3" as const,
      revision: 1,
      annotations: [],
      content: [
        {
          type: "row" as const,
          props: {
            id: "toolbar",
            ...layout,
            justify: "start" as const,
            align: "start" as const,
            gap: 8,
            padding: 8,
            surface: "plain" as const,
          },
          children: [
            {
              type: "button" as const,
              props: { id: "action", ...layout, label: "Action" },
            },
          ],
        },
      ],
    };
    render(
      <StructuredMockupSectionEditor
        definition={definition}
        value={JSON.stringify(document)}
        onChange={onChange}
      />
    );

    const getContainer = (): HTMLElement => {
      const container = screen
        .getByTestId("structured-mockup-canvas")
        .querySelector<HTMLElement>('[data-puck-component="toolbar"]');
      if (!container) throw new Error("Expected toolbar container");
      return container;
    };
    const getLayoutElement = (): HTMLElement => {
      const layoutElement = getContainer().querySelector<HTMLElement>(
        '[data-puck-dropzone="toolbar:children"]'
      );
      if (!layoutElement) throw new Error("Expected toolbar layout element");
      return layoutElement;
    };
    fireEvent.click(getContainer());
    fireEvent.click(
      await screen.findByTestId("structured-mockup-property-action-spacing")
    );
    let dialog = await screen.findByTestId(
      "structured-mockup-property-dialog-spacing"
    );
    fireEvent.change(within(dialog).getByLabelText("Spacing"), {
      target: { value: "24" },
    });
    await waitFor(() =>
      expect(getLayoutElement()).toHaveStyle({ gap: "24px" })
    );
    fireEvent.change(within(dialog).getByLabelText("Padding"), {
      target: { value: "20" },
    });
    await waitFor(() =>
      expect(getLayoutElement()).toHaveStyle({ padding: "20px" })
    );

    fireEvent.click(getContainer());
    fireEvent.click(
      await screen.findByTestId("structured-mockup-property-action-appearance")
    );
    dialog = await screen.findByTestId(
      "structured-mockup-property-dialog-appearance"
    );
    fireEvent.change(within(dialog).getByLabelText("Surface"), {
      target: { value: JSON.stringify({ value: "dashed" }) },
    });
    await waitFor(() =>
      expect(getLayoutElement()).toHaveStyle({
        borderStyle: "dashed",
        borderWidth: "1px",
      })
    );

    fireEvent.click(screen.getByText("Action"));
    fireEvent.click(
      await screen.findByTestId("structured-mockup-property-action-content")
    );
    dialog = await screen.findByTestId(
      "structured-mockup-property-dialog-content"
    );
    fireEvent.change(within(dialog).getByLabelText("Label"), {
      target: { value: "Updated action" },
    });

    await waitFor(() =>
      expect(screen.getByText("Updated action")).toBeInTheDocument()
    );
    const latest = JSON.parse(onChange.mock.calls.at(-1)?.[0] ?? "null");
    expect(latest.content[0]).toMatchObject({
      props: { id: "toolbar", gap: 24, padding: 20, surface: "dashed" },
      children: [{ props: { id: "action", label: "Updated action" } }],
    });
  });

  it("exposes semantic metadata and bounded appearance fields for v5 components", async () => {
    render(
      <StructuredMockupSectionEditor
        definition={definition}
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v5",
          revision: 1,
          annotations: [],
          content: [
            {
              type: "shape",
              props: {
                id: "status",
                ...layout,
                kind: "circle",
                role: "status",
                description: "Current status indicator",
                color: "success",
                opacity: 0.75,
                overflow: "hidden",
              },
            },
          ],
        })}
        onChange={vi.fn()}
      />
    );

    fireEvent.click(
      screen.getByTestId("structured-mockup-semantic-metadata-indicator")
    );
    const descriptionAction = await screen.findByTestId(
      "structured-mockup-property-action-metadata"
    );
    expect(
      within(descriptionAction).getByTestId("DescriptionOutlinedIcon")
    ).toBeInTheDocument();
    fireEvent.click(descriptionAction);
    const metadataDialog = await screen.findByTestId(
      "structured-mockup-property-dialog-metadata"
    );
    expect(
      within(metadataDialog).getByTestId("structured-mockup-metadata-fields")
    ).toBeInTheDocument();
    expect(
      within(metadataDialog).getByLabelText("Agent description")
    ).toBeInTheDocument();
    expect(
      within(metadataDialog).queryByLabelText("Semantic role")
    ).not.toBeInTheDocument();

    fireEvent.click(
      screen.getByTestId("structured-mockup-semantic-metadata-indicator")
    );
    fireEvent.click(
      screen.getByTestId("structured-mockup-property-action-appearance")
    );
    const appearanceDialog = await screen.findByTestId(
      "structured-mockup-property-dialog-appearance"
    );
    expect(
      within(appearanceDialog).getByLabelText("Color")
    ).toBeInTheDocument();
    expect(
      within(appearanceDialog).getByLabelText("Opacity")
    ).toBeInTheDocument();
    expect(
      within(appearanceDialog).getByLabelText("Overflow")
    ).toBeInTheDocument();
  });

  it("uses Puck history for property edits without persisting editor chrome", async () => {
    const onChange = vi.fn();
    render(
      <StructuredMockupSectionEditor
        definition={definition}
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v1",
          content: [
            {
              type: "button",
              props: { id: "action", ...layout, label: "Before" },
            },
          ],
        })}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByText("Before"));
    fireEvent.click(
      await screen.findByTestId("structured-mockup-property-action-content")
    );
    const dialog = await screen.findByTestId(
      "structured-mockup-property-dialog-content"
    );
    fireEvent.change(within(dialog).getByLabelText("Label"), {
      target: { value: "After" },
    });
    await waitFor(() => expect(screen.getByText("After")).toBeInTheDocument());
    await waitFor(() =>
      expect(screen.getByTestId("structured-mockup-undo")).toBeEnabled()
    );

    fireEvent.click(screen.getByTestId("structured-mockup-undo"));
    await waitFor(() => expect(screen.getByText("Before")).toBeInTheDocument());
    expect(screen.getByTestId("structured-mockup-redo")).toBeEnabled();

    fireEvent.click(screen.getByTestId("structured-mockup-redo"));
    await waitFor(() => expect(screen.getByText("After")).toBeInTheDocument());
    const latest = JSON.parse(onChange.mock.calls.at(-1)?.[0] ?? "null");
    expect(latest.content[0]).toMatchObject({
      props: { id: "action", label: "After" },
    });
    expect(JSON.stringify(latest)).not.toContain(
      "structured-mockup-selection-actions"
    );
  });

  it("selects existing text and edits it through visible Puck fields", async () => {
    const onChange = vi.fn();
    render(
      <StructuredMockupSectionEditor
        definition={definition}
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v1",
          content: [
            {
              type: "text",
              props: {
                id: "title",
                ...layout,
                text: "Original title",
                variant: "heading",
              },
            },
          ],
        })}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByText("Original title"));
    fireEvent.click(
      await screen.findByTestId("structured-mockup-property-action-text")
    );
    const properties = await screen.findByTestId(
      "structured-mockup-property-dialog-text"
    );
    const textField = await within(properties).findByLabelText(
      "Text",
      {},
      { timeout: 1000 }
    );
    expect(
      within(properties).getByTestId("structured-mockup-fields-grid")
    ).toHaveStyle({ display: "flex", flexWrap: "wrap" });
    expect(
      within(properties).getByTestId("structured-mockup-text-fields")
    ).toBeInTheDocument();
    fireEvent.change(textField, { target: { value: "Saved title" } });

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const latest = JSON.parse(onChange.mock.calls.at(-1)?.[0] ?? "null");
    expect(latest.content[0]).toMatchObject({
      props: { id: "title", text: "Saved title" },
    });
  });

  it("resizes the rendered element when fixed dimensions are edited", async () => {
    const onChange = vi.fn();
    render(
      <StructuredMockupSectionEditor
        definition={definition}
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v1",
          content: [
            {
              type: "rectangle",
              props: {
                id: "hero",
                width: { mode: "fixed", value: 120 },
                height: { mode: "fixed", value: 80 },
                label: "Hero",
              },
            },
          ],
        })}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByText("Hero"));
    fireEvent.click(
      await screen.findByTestId("structured-mockup-property-action-sizing")
    );
    const properties = await screen.findByTestId(
      "structured-mockup-property-dialog-sizing"
    );
    fireEvent.change(await within(properties).findByLabelText("Width"), {
      target: { value: "640" },
    });
    await waitFor(() =>
      expect(screen.getByText("Hero")).toHaveStyle({ width: "640px" })
    );
    fireEvent.change(within(properties).getByLabelText("Height"), {
      target: { value: "240" },
    });

    await waitFor(() =>
      expect(screen.getByText("Hero")).toHaveStyle({
        width: "640px",
        height: "240px",
      })
    );
    expect(screen.getByText("Hero")).toHaveStyle({ maxWidth: "none" });
    const latest = JSON.parse(onChange.mock.calls.at(-1)?.[0] ?? "null");
    expect(latest.content[0]).toMatchObject({
      props: {
        id: "hero",
        width: { mode: "fixed", value: 640 },
        height: { mode: "fixed", value: 240 },
        label: "Hero",
      },
    });
  });

  it("fills the canvas and padded nested containers through visible controls and reload", async () => {
    const onChange = vi.fn();
    const document = {
      schemaVersion: "work-item-structured-mockup.v2" as const,
      revision: 7,
      annotations: [],
      content: [
        {
          type: "rectangle" as const,
          props: {
            id: "root-fill",
            width: { mode: "fit" as const },
            height: { mode: "content" as const },
            label: "Root fill target",
          },
        },
        {
          type: "column" as const,
          props: {
            id: "outer-container",
            width: { mode: "fixed" as const, value: 500 },
            height: { mode: "content" as const },
            gap: 0,
            padding: 16,
            align: "center" as const,
          },
          children: [
            {
              type: "column" as const,
              props: {
                id: "inner-container",
                width: { mode: "fill" as const },
                height: { mode: "content" as const },
                gap: 0,
                padding: 8,
                align: "end" as const,
              },
              children: [
                {
                  type: "rectangle" as const,
                  props: {
                    id: "nested-fill",
                    width: { mode: "fit" as const },
                    height: { mode: "content" as const },
                    label: "Nested fill target",
                  },
                },
              ],
            },
          ],
        },
      ],
    };
    const bounds = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const componentId =
          this.dataset.structuredMockupComponentId ??
          this.dataset.puckComponent;
        const width =
          componentId === "outer-container"
            ? 500
            : componentId === "inner-container"
            ? 468
            : componentId === "nested-fill"
            ? 452
            : componentId === "root-fill"
            ? 968
            : 1000;
        return {
          x: 0,
          y: 0,
          top: 0,
          left: 0,
          right: width,
          bottom: 80,
          width,
          height: 80,
          toJSON: () => ({}),
        };
      });
    const { rerender } = render(
      <StructuredMockupSectionEditor
        definition={definition}
        value={JSON.stringify(document)}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByText("Root fill target"));
    fireEvent.click(
      await screen.findByTestId("structured-mockup-property-action-sizing")
    );
    let properties = await screen.findByTestId(
      "structured-mockup-property-dialog-sizing"
    );
    fireEvent.change(await within(properties).findByLabelText("Width mode"), {
      target: { value: JSON.stringify({ value: "fill" }) },
    });
    await waitFor(() =>
      expect(screen.getByText("Root fill target")).toHaveStyle({
        width: "100%",
        flexGrow: "1",
        alignSelf: "stretch",
        boxSizing: "border-box",
      })
    );
    expect(
      screen.getByText("Root fill target").closest("[data-puck-component]")
    ).toHaveStyle({ width: "100%", flexGrow: "1", alignSelf: "stretch" });

    fireEvent.click(screen.getByText("Nested fill target"));
    fireEvent.click(
      await screen.findByTestId("structured-mockup-property-action-sizing")
    );
    properties = await screen.findByTestId(
      "structured-mockup-property-dialog-sizing"
    );
    fireEvent.change(await within(properties).findByLabelText("Width mode"), {
      target: { value: JSON.stringify({ value: "fill" }) },
    });
    await waitFor(() =>
      expect(screen.getByText("Nested fill target")).toHaveStyle({
        width: "100%",
        flexGrow: "1",
        alignSelf: "stretch",
        boxSizing: "border-box",
      })
    );
    expect(
      screen.getByText("Nested fill target").closest("[data-puck-component]")
    ).toHaveStyle({ width: "100%", flexGrow: "1", alignSelf: "stretch" });
    expect(
      screen
        .getByTestId("structured-mockup-canvas")
        .querySelector('[data-puck-component="inner-container"]')
    ).toHaveStyle({ width: "100%", flexGrow: "1", alignSelf: "stretch" });
    expect(screen.getByText("Nested fill target")).toHaveStyle({
      width: "100%",
    });
    expect(await screen.findByText(/468 × 80/)).toBeInTheDocument();
    expect(screen.getByText("(fill, content)")).toBeInTheDocument();

    const persistedValue = onChange.mock.calls.at(-1)?.[0] ?? "";
    const persisted = JSON.parse(persistedValue);
    expect(persisted.revision).toBe(8);
    expect(persisted.content).toMatchObject([
      { props: { id: "root-fill", width: { mode: "fill" } } },
      {
        props: { id: "outer-container", width: { mode: "fixed", value: 500 } },
        children: [
          {
            props: {
              id: "inner-container",
              width: { mode: "fill" },
              padding: 8,
            },
            children: [
              { props: { id: "nested-fill", width: { mode: "fill" } } },
            ],
          },
        ],
      },
    ]);

    onChange.mockClear();
    rerender(
      <StructuredMockupSectionEditor
        definition={definition}
        value={persistedValue}
        onChange={onChange}
      />
    );
    await waitFor(() => expect(onChange).not.toHaveBeenCalled());
    expect(screen.getByText("Root fill target")).toHaveStyle({ width: "100%" });
    expect(screen.getByText("Nested fill target")).toHaveStyle({
      width: "100%",
    });
    bounds.mockRestore();
  });

  it("shows renderer-grounded diagnostics for a selected nested element without saving chrome", async () => {
    const onChange = vi.fn();
    const bounds = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const componentId =
          this.dataset.structuredMockupComponentId ??
          this.dataset.puckComponent;
        const values =
          componentId === "layout"
            ? { left: 20, top: 30, width: 600, height: 240 }
            : componentId === "hero"
            ? { left: 400, top: 120, width: 160, height: 80 }
            : { left: 0, top: 0, width: 1000, height: 500 };
        return {
          ...values,
          x: values.left,
          y: values.top,
          right: values.left + values.width,
          bottom: values.top + values.height,
          toJSON: () => ({}),
        };
      });
    render(
      <StructuredMockupSectionEditor
        materializedProposalId={materializedProposalId}
        definition={definition}
        authorUserId="10000000-0000-4000-8000-000000000001"
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v2",
          revision: 3,
          annotations: [],
          content: [
            {
              type: "row",
              props: {
                id: "layout",
                width: { mode: "fill" },
                height: { mode: "fixed", value: 240 },
                gap: 12,
                padding: 16,
                align: "center",
              },
              children: [
                {
                  type: "rectangle",
                  props: {
                    id: "hero",
                    width: { mode: "fixed", value: 160 },
                    height: { mode: "content" },
                    label: "Diagnostic hero",
                  },
                },
              ],
            },
          ],
        })}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByText("Diagnostic hero"));

    expect(
      await screen.findByTestId("structured-mockup-layout-diagnostics")
    ).toHaveAttribute("data-parent-type", "row");
    expect(screen.getByText(/600 × 240/)).toBeInTheDocument();
    expect(
      screen.getByTestId("structured-mockup-direction-row")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/justify center · align stretch/)
    ).toBeInTheDocument();
    expect(screen.getByText("(fixed 160px, content)")).toBeInTheDocument();
    expect(
      screen.queryByTestId("structured-mockup-alignment-guide")
    ).not.toBeInTheDocument();
    const parentElement = screen
      .getByTestId("structured-mockup-canvas")
      .querySelector('[data-puck-component="layout"]');
    if (!parentElement) throw new Error("Expected rendered parent element");
    fireEvent.mouseMove(parentElement);
    expect(
      screen.getByTestId("structured-mockup-alignment-guide")
    ).toHaveAttribute("data-axis", "horizontal");
    expect(screen.getByTestId("structured-mockup-alignment-guide")).toHaveStyle(
      {
        top: "150px",
        width: "600px",
        opacity: "0.3",
        borderTopWidth: "1px",
        borderTopStyle: "solid",
      }
    );
    const selectedElement = screen
      .getByTestId("structured-mockup-canvas")
      .querySelector('[data-puck-component="hero"]');
    if (!selectedElement) throw new Error("Expected rendered selected element");
    fireEvent.mouseOver(selectedElement);
    fireEvent.mouseMove(selectedElement);
    expect(
      screen.queryByTestId("structured-mockup-alignment-guide")
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("structured-mockup-parent-layout-diagnostic")
    ).toHaveStyle({
      left: "620px",
      top: "30px",
      transform: "translateY(-100%)",
      opacity: "0.65",
    });
    expect(
      screen.queryByTestId("structured-mockup-parent-layout-highlight")
    ).not.toBeInTheDocument();
    const canvas = screen.getByTestId("structured-mockup-canvas");
    const selectedOverlay = canvas.querySelector<HTMLElement>(
      '[data-puck-overlay] [style*="--puck-slot-component-color-overlay"]'
    );
    if (!selectedOverlay) throw new Error("Expected selected Puck overlay");
    expect(
      getComputedStyle(selectedOverlay).getPropertyValue(
        "--puck-slot-component-color-overlay"
      )
    ).toBe("transparent");
    expect(
      getComputedStyle(selectedOverlay).getPropertyValue(
        "--puck-slot-component-color-overlay-border"
      )
    ).toContain("0.42");
    expect(
      getComputedStyle(selectedOverlay).getPropertyValue(
        "--puck-slot-component-color-border-selected"
      )
    ).not.toBe("");
    expect(
      getComputedStyle(selectedOverlay).getPropertyValue(
        "--puck-slot-component-border-width"
      )
    ).toBe("1px");
    const dropzone = canvas.querySelector<HTMLElement>("[data-puck-dropzone]");
    if (!dropzone) throw new Error("Expected Puck dropzone");
    expect(getComputedStyle(dropzone).backgroundColor).toBe("rgba(0, 0, 0, 0)");
    expect(
      screen.getByTestId("structured-mockup-parent-layout-diagnostic")
    ).toHaveAttribute("data-presentation", "inline-text");
    expect(
      screen.getByTestId("structured-mockup-selected-layout-diagnostic")
    ).toHaveStyle({ left: "560px", top: "200px" });
    const selectionActions = screen.getByTestId(
      "structured-mockup-selection-actions"
    );
    const selectedTypeLabel = screen.getByTestId(
      "structured-mockup-selected-type-label"
    );
    expect(selectedTypeLabel).toHaveTextContent("Rectangle");
    expect(
      selectedTypeLabel.compareDocumentPosition(
        screen.getByTestId("structured-mockup-wrapper-action")
      ) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(selectionActions).not.toHaveTextContent("(fixed 160px, content)");
    expect(selectedTypeLabel.querySelector("button")).toBeNull();
    fireEvent.click(
      screen.getByTestId("structured-mockup-property-action-sizing")
    );
    const sizingDialog = await screen.findByTestId(
      "structured-mockup-property-dialog-sizing"
    );
    fireEvent.change(within(sizingDialog).getByLabelText("Width"), {
      target: { value: "180" },
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(JSON.parse(onChange.mock.calls.at(-1)?.[0] ?? "null")).toMatchObject(
      {
        content: [
          {
            children: [
              { props: { id: "hero", width: { mode: "fixed", value: 180 } } },
            ],
          },
        ],
      }
    );
    expect(
      screen.getByTestId("structured-mockup-add-annotation")
    ).toBeEnabled();
    bounds.mockRestore();
  });

  it("edits and reopens independent Justify and Align controls", async () => {
    const onChange = vi.fn();
    const document = {
      schemaVersion: "work-item-structured-mockup.v2" as const,
      revision: 3,
      annotations: [],
      content: [
        {
          type: "row" as const,
          props: {
            id: "actions",
            width: { mode: "fill" as const },
            height: { mode: "fixed" as const, value: 80 },
            gap: 8,
            padding: 8,
            align: "start" as const,
          },
          children: [
            {
              type: "button" as const,
              props: { id: "cancel", ...layout, label: "Cancel" },
            },
            {
              type: "button" as const,
              props: { id: "save", ...layout, label: "Save changes" },
            },
          ],
        },
      ],
    };
    const { rerender } = render(
      <StructuredMockupSectionEditor
        definition={definition}
        value={JSON.stringify(document)}
        onChange={onChange}
      />
    );
    const getCanvas = (): HTMLElement =>
      screen.getByTestId("structured-mockup-canvas");
    const getContainer = (): HTMLElement => {
      const container = getCanvas().querySelector<HTMLElement>(
        '[data-puck-component="actions"]'
      );
      if (!container) throw new Error("Expected actions container");
      return container;
    };
    const getLayoutElement = (): HTMLElement => {
      const layoutElement = getContainer().querySelector<HTMLElement>(
        '[data-puck-dropzone="actions:children"]'
      );
      if (!layoutElement) throw new Error("Expected actions layout element");
      return layoutElement;
    };
    const selectContainer = (): void => {
      fireEvent.click(getContainer());
    };

    selectContainer();
    fireEvent.click(
      await screen.findByTestId("structured-mockup-property-action-layout")
    );
    let properties = await screen.findByTestId(
      "structured-mockup-property-dialog-layout"
    );
    expect(
      within(properties).getByTestId("structured-mockup-layout-fields")
    ).toHaveTextContent("Layout");
    expect(getLayoutElement()).toHaveStyle({ justifyContent: "flex-start" });
    for (const [value, cssValue] of [
      ["center", "center"],
      ["end", "flex-end"],
      ["spread", "space-between"],
    ] as const) {
      fireEvent.change(within(properties).getByLabelText("Justify"), {
        target: { value: JSON.stringify({ value }) },
      });
      await waitFor(() =>
        expect(getLayoutElement()).toHaveStyle({ justifyContent: cssValue })
      );
    }

    const persistedValue = onChange.mock.calls.at(-1)?.[0] ?? "";
    fireEvent.change(within(properties).getByLabelText("Align"), {
      target: { value: JSON.stringify({ value: "end" }) },
    });
    await waitFor(() =>
      expect(getLayoutElement()).toHaveStyle({ alignItems: "flex-end" })
    );
    const alignedValue = onChange.mock.calls.at(-1)?.[0] ?? "";
    expect(JSON.parse(alignedValue).content[0].props).toMatchObject({
      justify: "spread",
      align: "end",
    });
    fireEvent.click(
      screen.getByTestId("structured-mockup-property-action-layout")
    );
    onChange.mockClear();
    rerender(
      <StructuredMockupSectionEditor
        definition={definition}
        value={alignedValue}
        onChange={onChange}
      />
    );
    selectContainer();
    fireEvent.click(
      await screen.findByTestId("structured-mockup-property-action-layout")
    );
    properties = await screen.findByTestId(
      "structured-mockup-property-dialog-layout"
    );
    await waitFor(() =>
      expect(within(properties).getByLabelText("Justify")).toHaveValue(
        JSON.stringify({ value: "spread" })
      )
    );
    expect(getLayoutElement()).toHaveStyle({ justifyContent: "space-between" });
    expect(getLayoutElement()).toHaveStyle({ alignItems: "flex-end" });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("hides dimension values unless the corresponding mode is fixed", async () => {
    render(
      <StructuredMockupSectionEditor
        definition={definition}
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v1",
          content: [
            {
              type: "rectangle",
              props: { id: "hero", ...layout, label: "Hero" },
            },
          ],
        })}
        onChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Hero"));
    fireEvent.click(
      await screen.findByTestId("structured-mockup-property-action-sizing")
    );
    const properties = await screen.findByTestId(
      "structured-mockup-property-dialog-sizing"
    );
    await within(properties).findByLabelText("Width mode");
    expect(
      within(properties).queryByLabelText("Width")
    ).not.toBeInTheDocument();
    expect(
      within(properties).queryByLabelText("Height")
    ).not.toBeInTheDocument();
    expect(
      within(properties).getByTestId("structured-mockup-sizing-fields")
    ).toHaveTextContent("Sizing");
    expect(
      screen.queryByTestId("structured-mockup-properties")
    ).not.toBeInTheDocument();

    fireEvent.change(within(properties).getByLabelText("Width mode"), {
      target: { value: JSON.stringify({ value: "fixed" }) },
    });
    await waitFor(() =>
      expect(within(properties).getByLabelText("Width")).toBeEnabled()
    );
    expect(
      within(properties).queryByLabelText("Height")
    ).not.toBeInTheDocument();

    fireEvent.change(within(properties).getByLabelText("Height mode"), {
      target: { value: JSON.stringify({ value: "fixed" }) },
    });
    await waitFor(() =>
      expect(within(properties).getByLabelText("Height")).toBeEnabled()
    );
  });

  it("keeps an authored oversized canvas reachable and selects off-screen content", async () => {
    const sizedDefinition = {
      ...definition,
      defaultSizeKey: "desktop",
      sizeProfiles: [
        {
          key: "desktop",
          label: "Desktop",
          breakpoints: [
            {
              minContainerWidth: 0,
              inline: { width: 600, height: 400 },
              page: { width: 1200, height: 900 },
            },
          ],
        },
      ],
    };
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(500);
    render(
      <StructuredMockupSectionEditor
        definition={sizedDefinition}
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v1",
          sizeKey: "desktop",
          content: [
            {
              type: "text",
              props: { id: "footer", ...layout, text: "Off-screen footer" },
            },
          ],
        })}
        onChange={vi.fn()}
      />
    );

    const scrollport = screen.getByTestId(
      "structured-mockup-canvas-scrollport"
    );
    const canvas = screen.getByTestId("structured-mockup-canvas");
    await waitFor(() =>
      expect(canvas).toHaveStyle({ width: "1200px", height: "900px" })
    );
    fireEvent.scroll(scrollport, {
      target: { scrollTop: 700, scrollLeft: 700 },
    });
    fireEvent.click(screen.getByText("Off-screen footer"));
    fireEvent.click(
      await screen.findByTestId("structured-mockup-property-action-text")
    );
    expect(
      await screen.findByTestId("structured-mockup-property-dialog-text")
    ).toBeInTheDocument();
    clientWidth.mockRestore();
  });

  it("persists a changed presentation profile when the document is reopened", () => {
    const onChange = vi.fn();
    const sizedDefinition = {
      ...definition,
      defaultSizeKey: "desktop",
      sizeProfiles: [
        {
          key: "desktop",
          label: "Desktop",
          breakpoints: [
            {
              minContainerWidth: 0,
              inline: { width: 480, height: 320 },
              page: { width: 1200, height: 800 },
            },
          ],
        },
        {
          key: "mobile",
          label: "Mobile",
          breakpoints: [
            {
              minContainerWidth: 0,
              inline: { width: 320, height: 480 },
              page: { width: 390, height: 844 },
            },
          ],
        },
      ],
    };
    const initialValue = JSON.stringify({
      schemaVersion: "work-item-structured-mockup.v5",
      revision: 1,
      sizeKey: "desktop",
      annotations: [],
      content: [
        {
          type: "row",
          props: {
            id: "content",
            width: { mode: "fit" },
            height: { mode: "content" },
            gap: 8,
            padding: 8,
            justify: "start",
            align: "stretch",
          },
          children: [
            {
              type: "text",
              props: {
                id: "title",
                width: { mode: "fit" },
                height: { mode: "content" },
                text: "Preserve this composition",
              },
            },
          ],
        },
      ],
    });

    const { rerender } = render(
      <StructuredMockupSectionEditor
        definition={sizedDefinition}
        value={initialValue}
        onChange={onChange}
      />
    );

    fireEvent.change(
      screen.getByTestId("structured-mockup-size-profile-selector"),
      {
        target: { value: "mobile" },
      }
    );

    const saved = onChange.mock.calls.at(-1)?.[0];
    expect(typeof saved).toBe("string");
    if (typeof saved !== "string") throw new Error("Expected saved document");
    const savedDocument = JSON.parse(saved);
    expect(savedDocument).toMatchObject({
      schemaVersion: "work-item-structured-mockup.v5",
      sizeKey: "mobile",
      content: [
        {
          props: { id: "content" },
          children: [{ props: { id: "title" } }],
        },
      ],
    });

    rerender(
      <StructuredMockupSectionEditor
        definition={sizedDefinition}
        value={JSON.stringify(savedDocument)}
        onChange={onChange}
      />
    );
    expect(
      screen.getByTestId("structured-mockup-size-profile-selector")
    ).toHaveValue("mobile");
    expect(screen.getByText("Preserve this composition")).toBeInTheDocument();
  });

  it("opens one non-blocking submenu with exactly the two wrapper directions", async () => {
    render(
      <StructuredMockupSectionEditor
        definition={definition}
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v3",
          revision: 1,
          annotations: [],
          content: [
            {
              type: "text",
              props: { id: "selected", ...layout, text: "Selected" },
            },
            {
              type: "text",
              props: { id: "canvas-target", ...layout, text: "Canvas target" },
            },
          ],
        })}
        onChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Selected"));
    fireEvent.click(
      await screen.findByTestId("structured-mockup-property-action-sizing")
    );
    expect(
      await screen.findByTestId("structured-mockup-property-dialog-sizing")
    ).toBeInTheDocument();

    const wrapperAction = screen.getByTestId(
      "structured-mockup-wrapper-action"
    );
    vi.spyOn(wrapperAction, "getBoundingClientRect").mockReturnValue({
      x: 200,
      y: 100,
      top: 100,
      left: 200,
      right: 224,
      bottom: 124,
      width: 24,
      height: 24,
      toJSON: () => ({}),
    });
    fireEvent.click(wrapperAction);
    expect(
      screen.queryByTestId("structured-mockup-property-dialog-sizing")
    ).not.toBeInTheDocument();
    const menu = await screen.findByTestId("structured-mockup-wrapper-menu");
    expect(within(menu).getAllByRole("button")).toHaveLength(2);
    expect(within(menu).getByLabelText("Wrap vertically")).toBeInTheDocument();
    expect(
      within(menu).getByLabelText("Wrap horizontally")
    ).toBeInTheDocument();
    expect(menu).not.toHaveTextContent(/options|container|wrap/i);
    expect(menu).toHaveStyle({ pointerEvents: "none" });
    expect(menu.querySelector(".MuiPopover-paper")).toHaveStyle({
      top: "128px",
      left: "212px",
    });
    const selectionActions = screen.getByTestId(
      "structured-mockup-selection-actions"
    );
    expect(selectionActions).toHaveClass(
      "MuiPaper-root",
      "MuiPaper-elevation8"
    );
    expect(selectionActions).toHaveStyle({ backgroundColor: "#fff" });

    const canvas = screen.getByTestId("structured-mockup-canvas");
    const canvasClick = vi.fn();
    canvas.addEventListener("click", canvasClick);
    fireEvent.click(canvas);
    expect(canvasClick).toHaveBeenCalledOnce();
  });

  it("keeps the selected action bar inside the viewport near the right and bottom edges", async () => {
    const innerWidth = vi
      .spyOn(window, "innerWidth", "get")
      .mockReturnValue(360);
    const innerHeight = vi
      .spyOn(window, "innerHeight", "get")
      .mockReturnValue(640);
    render(
      <StructuredMockupSectionEditor
        definition={definition}
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v3",
          revision: 1,
          annotations: [],
          content: [
            {
              type: "text",
              props: { id: "edge-selected", ...layout, text: "Edge selected" },
            },
          ],
        })}
        onChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Edge selected"));
    const selectionActions = await screen.findByTestId(
      "structured-mockup-selection-actions"
    );
    const actionWrapper = selectionActions.parentElement;
    if (!actionWrapper) throw new Error("Expected a Puck action wrapper");

    vi.spyOn(actionWrapper, "getBoundingClientRect").mockReturnValue({
      x: 320,
      y: 620,
      top: 620,
      left: 320,
      right: 440,
      bottom: 680,
      width: 120,
      height: 60,
      toJSON: () => ({}),
    });
    fireEvent(window, new Event("resize"));

    await waitFor(() =>
      expect(actionWrapper.style.transform).toContain("translate(-88px, -48px)")
    );

    innerWidth.mockRestore();
    innerHeight.mockRestore();
  });

  it("keeps the selected action bar inside the nested canvas scrollport", async () => {
    render(
      <StructuredMockupSectionEditor
        definition={definition}
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v3",
          revision: 1,
          annotations: [],
          content: [
            {
              type: "text",
              props: {
                id: "nested-edge-selected",
                ...layout,
                text: "Nested edge",
              },
            },
          ],
        })}
        onChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Nested edge"));
    const selectionActions = await screen.findByTestId(
      "structured-mockup-selection-actions"
    );
    const actionWrapper = selectionActions.parentElement;
    const scrollport = screen.getByTestId(
      "structured-mockup-canvas-scrollport"
    );
    if (!actionWrapper) throw new Error("Expected a Puck action wrapper");

    vi.spyOn(scrollport, "getBoundingClientRect").mockReturnValue({
      x: 40,
      y: 80,
      top: 80,
      left: 40,
      right: 320,
      bottom: 430,
      width: 280,
      height: 350,
      toJSON: () => ({}),
    });
    vi.spyOn(actionWrapper, "getBoundingClientRect").mockReturnValue({
      x: 300,
      y: 400,
      top: 400,
      left: 300,
      right: 420,
      bottom: 460,
      width: 120,
      height: 60,
      toJSON: () => ({}),
    });
    fireEvent.scroll(scrollport);

    await waitFor(() =>
      expect(actionWrapper.style.transform).toContain(
        "translate(-108px, -38px)"
      )
    );
  });

  it("wraps the active element vertically as one undoable persisted edit", async () => {
    const onChange = vi.fn();
    const initialValue = JSON.stringify({
      schemaVersion: "work-item-structured-mockup.v3",
      revision: 2,
      annotations: [],
      content: [
        {
          type: "text",
          props: { id: "first", ...layout, text: "First" },
        },
        {
          type: "button",
          props: { id: "second", ...layout, label: "Second" },
        },
      ],
    });
    const { rerender } = render(
      <StructuredMockupSectionEditor
        definition={definition}
        value={initialValue}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByText("First"));
    fireEvent.click(
      await screen.findByTestId("structured-mockup-wrapper-action")
    );
    fireEvent.click(
      await screen.findByTestId("structured-mockup-wrap-vertical")
    );

    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const wrappedValue = onChange.mock.calls.at(-1)?.[0];
    if (typeof wrappedValue !== "string") {
      throw new Error("Expected a serialized wrapped mockup");
    }
    const wrapped = JSON.parse(wrappedValue);
    expect(wrapped).toMatchObject({
      revision: 3,
      content: [
        {
          type: "column",
          children: [{ type: "text", props: { id: "first", text: "First" } }],
        },
        { type: "button", props: { id: "second", label: "Second" } },
      ],
    });
    expect(JSON.stringify(wrapped)).not.toContain("activeSubmenu");
    expect(JSON.stringify(wrapped)).not.toContain(
      "structured-mockup-wrapper-menu"
    );
    await waitFor(() =>
      expect(screen.getByTestId("structured-mockup-undo")).toBeEnabled()
    );

    fireEvent.click(screen.getByTestId("structured-mockup-undo"));
    await waitFor(() => {
      const latest = JSON.parse(onChange.mock.calls.at(-1)?.[0] ?? "null");
      expect(latest.content[0]).toMatchObject({
        type: "text",
        props: { id: "first" },
      });
    });
    expect(screen.getByTestId("structured-mockup-redo")).toBeEnabled();

    fireEvent.click(screen.getByTestId("structured-mockup-redo"));
    await waitFor(() => {
      const latest = JSON.parse(onChange.mock.calls.at(-1)?.[0] ?? "null");
      expect(latest.content[0]).toMatchObject({
        type: "column",
        children: [{ props: { id: "first" } }],
      });
    });

    rerender(
      <StructuredMockupSectionEditor
        definition={definition}
        value={wrappedValue}
        onChange={onChange}
      />
    );
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(
      screen
        .getByText("First")
        .closest("[data-puck-component]")
        ?.parentElement?.closest("[data-puck-component]")
    ).toBeTruthy();
  });

  it("offers the same horizontal wrapper action at a mobile editor width", async () => {
    const onChange = vi.fn();
    const clientWidth = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(390);
    render(
      <StructuredMockupSectionEditor
        definition={definition}
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v3",
          revision: 1,
          annotations: [],
          content: [
            {
              type: "button",
              props: { id: "mobile-action", ...layout, label: "Mobile action" },
            },
          ],
        })}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByText("Mobile action"));
    fireEvent.click(
      await screen.findByTestId("structured-mockup-wrapper-action")
    );
    fireEvent.click(
      await screen.findByTestId("structured-mockup-wrap-horizontal")
    );
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const saved = JSON.parse(onChange.mock.calls.at(-1)?.[0] ?? "null");
    expect(saved.content[0]).toMatchObject({
      type: "row",
      children: [{ props: { id: "mobile-action" } }],
    });
    clientWidth.mockRestore();
  });

  it("does not expose wrapper actions when structured editing is disabled", () => {
    render(
      <StructuredMockupSectionEditor
        disabled
        definition={definition}
        value={JSON.stringify({
          schemaVersion: "work-item-structured-mockup.v3",
          revision: 1,
          annotations: [],
          content: [
            {
              type: "text",
              props: { id: "read-only", ...layout, text: "Read only" },
            },
          ],
        })}
        onChange={vi.fn()}
      />
    );

    fireEvent.click(screen.getByText("Read only"));
    const wrapperAction = screen.getByTestId(
      "structured-mockup-wrapper-action"
    );
    expect(wrapperAction).toBeDisabled();
    fireEvent.click(wrapperAction);
    expect(
      screen.queryByTestId("structured-mockup-wrapper-menu")
    ).not.toBeInTheDocument();
  });
});
