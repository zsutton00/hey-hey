import type {
  WorkItemStructuredMockupComponent,
  WorkItemStructuredMockupSectionContent,
} from "../../api";

const contentHeight = { mode: "content" } as const;
const fill = { mode: "fill" } as const;
const text = (
  id: string,
  value: string,
  variant: "body" | "heading" | "caption" | "label" | "badge" = "body"
): WorkItemStructuredMockupComponent => ({
  type: "text",
  props: {
    id,
    text: value,
    variant,
    width: { mode: "fit" },
    height: contentHeight,
  },
});

const column = (
  id: string,
  width: number,
  children: WorkItemStructuredMockupComponent[],
  surface: "panel" | "muted"
): WorkItemStructuredMockupComponent => ({
  type: "column",
  props: {
    id,
    width: { mode: "fixed", value: width },
    height: contentHeight,
    gap: 24,
    padding: 32,
    justify: "start",
    align: "stretch",
    surface,
  },
  children,
});

// Visual acceptance case based on target.png: preserve composition, not decoration.
export const structuredMockupAcceptanceFixture: WorkItemStructuredMockupSectionContent =
  {
    schemaVersion: "work-item-structured-mockup.v3",
    revision: 1,
    annotations: [],
    content: [
      {
        type: "row",
        props: {
          id: "workspace",
          width: { mode: "fixed", value: 1120 },
          height: contentHeight,
          gap: 0,
          padding: 0,
          justify: "spread",
          align: "stretch",
          surface: "panel",
        },
        children: [
          column(
            "notes-panel",
            750,
            [
              {
                type: "row",
                props: {
                  id: "notes-header",
                  width: fill,
                  height: contentHeight,
                  gap: 16,
                  padding: 0,
                  justify: "spread",
                  align: "stretch",
                },
                children: [
                  {
                    type: "column",
                    props: {
                      id: "notes-title",
                      width: { mode: "fit" },
                      height: contentHeight,
                      gap: 8,
                      padding: 0,
                      justify: "start",
                      align: "stretch",
                    },
                    children: [
                      text("draft", "Draft", "label"),
                      text("notes-heading", "Write your notes", "heading"),
                    ],
                  },
                  text("editable", "Editable", "badge"),
                ],
              },
              {
                type: "input",
                props: {
                  id: "notes",
                  width: fill,
                  height: { mode: "fixed", value: 460 },
                  label: "Document notes",
                  placeholder: "Start writing here…",
                  value:
                    "Start writing here…\n\nUse this space to capture notes, draft content, or describe what you need from the documents you open.",
                  multiline: true,
                },
              },
              {
                type: "row",
                props: {
                  id: "notes-footer",
                  width: fill,
                  height: contentHeight,
                  gap: 16,
                  padding: 0,
                  justify: "spread",
                  align: "stretch",
                },
                children: [
                  text("plain-text", "Plain text", "caption"),
                  text("saved", "Auto-saved", "caption"),
                ],
              },
            ],
            "panel"
          ),
          column(
            "documents-panel",
            370,
            [
              {
                type: "column",
                props: {
                  id: "documents-title",
                  width: fill,
                  height: contentHeight,
                  gap: 8,
                  padding: 0,
                  justify: "start",
                  align: "stretch",
                },
                children: [
                  text("documents", "Documents", "label"),
                  text("file-heading", "Open a file", "heading"),
                ],
              },
              {
                type: "column",
                props: {
                  id: "upload-area",
                  width: fill,
                  height: { mode: "fixed", value: 420 },
                  gap: 24,
                  padding: 24,
                  justify: "center",
                  align: "stretch",
                  surface: "dashed",
                },
                children: [
                  {
                    type: "image-placeholder",
                    props: {
                      id: "document-icon",
                      width: { mode: "fixed", value: 64 },
                      height: { mode: "fixed", value: 64 },
                      altText: "File",
                    },
                  },
                  text("choose-document", "Choose a document"),
                  text(
                    "select-file",
                    "Select a file from your computer",
                    "caption"
                  ),
                  {
                    type: "button",
                    props: {
                      id: "browse",
                      width: { mode: "fit" },
                      height: contentHeight,
                      label: "Browse files",
                    },
                  },
                ],
              },
              text("formats", "PDF, Word, text, Markdown, or RTF", "caption"),
            ],
            "muted"
          ),
        ],
      },
    ],
  };
