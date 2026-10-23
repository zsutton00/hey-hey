import React from "react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { structuredMockupAcceptanceFixture } from "../structuredMockupAcceptanceFixture";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StructuredMockupSectionRenderer } from "../StructuredMockupSectionRenderer";

const definition = {
  key: "mockup",
  label: "Mockup",
  kind: "structured-mockup" as const,
  defaultSizeKey: "panel",
  sizeProfiles: [
    {
      key: "panel",
      label: "Panel",
      breakpoints: [
        {
          minContainerWidth: 0,
          inline: { width: 420, height: 260 },
          page: { width: 800, height: 600 },
        },
      ],
    },
  ],
};

const layout = {
  width: { mode: "fit" as const },
  height: { mode: "content" as const },
};

describe("StructuredMockupSectionRenderer", () => {
  it.each([
    ["inline", 420, 260, "100%", "420px"],
    ["page", 800, 600, "800px", "none"],
  ] as const)(
    "uses the resolved %s presentation dimensions",
    async (context, width, height, expectedWidth, expectedMaxWidth) => {
      render(
        <StructuredMockupSectionRenderer
          definition={definition}
          context={context}
          content={{
            schemaVersion: "work-item-structured-mockup.v1",
            content: [],
          }}
        />
      );

      const renderer = screen.getByTestId(
        "structured-mockup-section-renderer"
      );
      const preview = screen.getByTestId("structured-mockup-static-preview");
      await waitFor(() => {
        expect(renderer).toHaveAttribute("data-rendering-context", context);
        expect(preview).toHaveStyle({
          width: expectedWidth,
          height: `${height}px`,
          maxWidth: expectedMaxWidth,
        });
      });

      if (context === "page") {
        expect(renderer).toHaveStyle({ overflowX: "auto" });
        expect(preview).toHaveStyle({ minWidth: `${width}px` });
      }
    }
  );

  it("fails closed when structured content selects an unknown profile", async () => {
    render(
      <StructuredMockupSectionRenderer
        definition={definition}
        context="inline"
        content={{
          schemaVersion: "work-item-structured-mockup.v1",
          sizeKey: "missing",
          content: [],
        }}
      />
    );

    await waitFor(() =>
      expect(
        screen.getByText("This structured mockup section cannot be rendered.")
      ).toBeInTheDocument()
    );
    expect(
      screen.queryByTestId("structured-mockup-static-preview")
    ).not.toBeInTheDocument();
  });

  it.each([undefined, true, false])(
    "honors multiline=%s and infers it only when omitted",
    (multiline) => {
      render(
        <StructuredMockupSectionRenderer
          definition={definition}
          context="page"
          content={{
            schemaVersion: "work-item-structured-mockup.v1",
            content: [
              {
                type: "input",
                props: {
                  id: "notes",
                  ...layout,
                  label: "Notes",
                  placeholder: "",
                  value: "First\nSecond",
                  ...(multiline === undefined ? {} : { multiline }),
                },
              },
            ],
          }}
        />
      );
      expect(screen.getByRole("textbox", { name: "Notes" }).tagName).toBe(
        multiline === false ? "INPUT" : "TEXTAREA"
      );
    }
  );
  it.each(["light", "dark"] as const)(
    "renders headings, multiline notes and all reference copy in a %s host",
    (mode) => {
      render(
        <ThemeProvider theme={createTheme({ palette: { mode } })}>
          <StructuredMockupSectionRenderer
            definition={definition}
            context="page"
            content={structuredMockupAcceptanceFixture}
          />
        </ThemeProvider>
      );
      expect(
        screen.getByRole("heading", { name: "Write your notes" })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Open a file" })
      ).toBeInTheDocument();
      const notes = screen.getByRole("textbox", { name: "Document notes" });
      expect(notes.tagName).toBe("TEXTAREA");
      expect(notes).toHaveTextContent("Start writing here…");
      expect(notes).toHaveAttribute("readonly");
      expect(getComputedStyle(notes).color).toBe("rgb(48, 46, 42)");
      expect(screen.getByText("Editable")).toBeInTheDocument();
      expect(screen.getByText("Plain text")).toBeInTheDocument();
      expect(screen.getByText("Auto-saved")).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: "Browse files" })
      ).toBeInTheDocument();
    }
  );

  it("renders nested host components while keeping authored text inert", () => {
    render(
      <StructuredMockupSectionRenderer
        definition={definition}
        context="inline"
        content={{
          schemaVersion: "work-item-structured-mockup.v1",
          content: [
            {
              type: "column",
              props: {
                id: "root-column",
                ...layout,
                gap: 8,
                padding: 8,
                align: "start",
              },
              children: [
                {
                  type: "text",
                  props: {
                    id: "message",
                    ...layout,
                    text: '<script src="https://example.com/run.js">run()</script><style>body{display:none}</style>',
                  },
                },
                {
                  type: "button",
                  props: { id: "confirm", ...layout, label: "Confirm" },
                },
              ],
            },
          ],
        }}
      />
    );

    const preview = screen.getByTestId("structured-mockup-static-preview");
    expect(preview).toHaveStyle({ isolation: "isolate" });
    expect(screen.getByRole("button", { name: "Confirm" })).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
    expect(preview.querySelector("style")).toBeNull();
    expect(preview.querySelector("img")).toBeNull();
    expect(preview.querySelector("link")).toBeNull();
    expect(document.body).toHaveTextContent("<script");
  });

  it("renders v5 primitives with appearance tokens and metadata presence only", () => {
    render(
      <StructuredMockupSectionRenderer
        definition={definition}
        context="inline"
        content={{
          schemaVersion: "work-item-structured-mockup.v5",
          revision: 1,
          annotations: [],
          content: [
            {
              type: "icon",
              props: {
                id: "settings",
                ...layout,
                iconKey: "settings",
                accessibleLabel: "Settings",
                role: "button",
                description: "Opens the settings panel",
                color: "primary",
                opacity: 0.5,
                overflow: "hidden",
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
                id: "badge",
                ...layout,
                kind: "pill",
                color: "success",
              },
            },
            {
              type: "divider",
              props: {
                id: "rule",
                ...layout,
                orientation: "vertical",
              },
            },
          ],
        }}
      />
    );

    const preview = screen.getByTestId("structured-mockup-static-preview");
    const icon = preview.querySelector(
      '[data-structured-mockup-component-id="settings"]'
    );
    expect(icon).toHaveAttribute(
      "data-structured-mockup-semantic-metadata",
      "present"
    );
    expect(icon).toHaveAttribute(
      "data-testid",
      "structured-mockup-semantic-metadata-indicator"
    );
    expect(icon).not.toHaveTextContent("Opens the settings panel");
    expect(icon).toHaveStyle({ opacity: "0.5", overflow: "hidden" });
    expect(
      preview.querySelector("[aria-label='Caret down']")
    ).toBeInTheDocument();
    expect(
      preview.querySelector("[data-structured-mockup-component-id='badge']")
    ).toHaveStyle({
      backgroundColor: "rgb(46, 125, 50)",
      minWidth: "48px",
      minHeight: "48px",
    });
    expect(
      preview.querySelector("[data-structured-mockup-component-id='rule']")
    ).toHaveStyle({ minHeight: "24px" });
  });

  it("uses the same fill sizing at the static preview root and through padded nesting", () => {
    render(
      <StructuredMockupSectionRenderer
        definition={definition}
        context="page"
        content={{
          schemaVersion: "work-item-structured-mockup.v1",
          content: [
            {
              type: "rectangle",
              props: {
                id: "root-fill",
                width: { mode: "fill" },
                height: { mode: "content" },
                label: "Root fill",
              },
            },
            {
              type: "column",
              props: {
                id: "outer",
                width: { mode: "fixed", value: 500 },
                height: { mode: "content" },
                gap: 0,
                padding: 16,
                align: "center",
              },
              children: [
                {
                  type: "column",
                  props: {
                    id: "inner",
                    width: { mode: "fill" },
                    height: { mode: "content" },
                    gap: 0,
                    padding: 8,
                    align: "end",
                  },
                  children: [
                    {
                      type: "rectangle",
                      props: {
                        id: "nested-fill",
                        width: { mode: "fill" },
                        height: { mode: "content" },
                        label: "Nested fill",
                      },
                    },
                  ],
                },
              ],
            },
          ],
        }}
      />
    );

    const preview = screen.getByTestId("structured-mockup-static-preview");
    const root = preview.querySelector(
      '[data-structured-mockup-component-id="root-fill"]'
    );
    const nested = preview.querySelector(
      '[data-structured-mockup-component-id="nested-fill"]'
    );
    const inner = nested?.parentElement ?? null;
    const outer = inner?.parentElement ?? null;
    expect(root).toHaveStyle({
      width: "100%",
      flexGrow: "1",
      alignSelf: "stretch",
      boxSizing: "border-box",
    });
    expect(outer).toHaveStyle({ width: "500px", padding: "16px" });
    expect(inner).toHaveStyle({
      width: "100%",
      padding: "8px",
      alignSelf: "stretch",
      boxSizing: "border-box",
    });
    expect(nested).toHaveStyle({
      width: "100%",
      alignSelf: "stretch",
      boxSizing: "border-box",
    });
    expect(inner?.parentElement).toBe(outer);
    expect(nested?.parentElement).toBe(inner);
  });

  it("fails closed for an unknown component instead of rendering it", () => {
    render(
      <StructuredMockupSectionRenderer
        definition={definition}
        context="inline"
        content={{
          schemaVersion: "work-item-structured-mockup.v1",
          content: [
            {
              type: "iframe",
              props: { id: "escape", ...layout, src: "https://example.com" },
            },
          ],
        }}
      />
    );

    expect(
      screen.getByText("This structured mockup section cannot be rendered.")
    ).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("switches annotation modes and derives outdated state from revision and size", () => {
    render(
      <StructuredMockupSectionRenderer
        definition={definition}
        context="page"
        materializedProposalId="20000000-0000-4000-8000-000000000002"
        content={{
          schemaVersion: "work-item-structured-mockup.v2",
          revision: 2,
          sizeKey: "panel",
          content: [
            { type: "button", props: { id: "save", ...layout, label: "Save" } },
          ],
          annotations: [
            {
              id: "10000000-0000-4000-8000-000000000001",
              note: "The save action needs stronger contrast.",
              author: {
                type: "human",
                userId: "10000000-0000-4000-8000-000000000002",
              },
              category: "issue",
              lifecycle: "open",
              authoredProposalId: "20000000-0000-4000-8000-000000000001",
              authoredSizeKey: "panel",
              target: { type: "position", x: 0.5, y: 0.5 },
            },
          ],
        }}
      />
    );

    expect(
      screen.getByTestId("structured-mockup-annotation-pin")
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("structured-mockup-annotations-hidden"));
    expect(
      screen.queryByTestId("structured-mockup-annotation-pin")
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByTestId("structured-mockup-annotations-expanded")
    );
    expect(screen.getByText("outdated")).toBeInTheDocument();
    expect(screen.getByText("Human reviewer")).toBeInTheDocument();
    expect(screen.getByText("issue")).toBeInTheDocument();
    expect(
      screen.getByText("The save action needs stronger contrast.")
    ).toBeInTheDocument();
  });

  it("separates the disabled note tool from mutually exclusive display controls", () => {
    render(
      <StructuredMockupSectionRenderer
        definition={definition}
        context="page"
        materializedProposalId="20000000-0000-4000-8000-000000000001"
        content={{
          schemaVersion: "work-item-structured-mockup.v2",
          revision: 1,
          content: [],
          annotations: [],
        }}
      />
    );

    const tool = screen.getByTestId("structured-mockup-add-annotation");
    const toolbar = screen.getByTestId("structured-mockup-annotation-toolbar");
    const displayControls = screen.getByTestId(
      "structured-mockup-annotation-display-controls"
    );
    expect(tool).toBeDisabled();
    expect(toolbar).toHaveClass("MuiPaper-root");
    expect(getComputedStyle(toolbar).backgroundColor).not.toBe("transparent");
    expect(tool).toHaveStyle({ padding: "4px" });
    expect(tool.compareDocumentPosition(displayControls)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING
    );
    expect(screen.getByRole("button", { name: "Pins" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    fireEvent.click(screen.getByRole("button", { name: "Expanded" }));
    expect(screen.getByRole("button", { name: "Pins" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(screen.getByRole("button", { name: "Expanded" })).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});
