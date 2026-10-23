import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import type {
  EditorSection,
  EditorTemplate,
} from "../../../types/editorTemplate";
import type {
  MarkdownLexicalEditorEntitySlashConfig,
  MarkdownLexicalEditorMentionConfig,
} from "../../LexicalEditor/MarkdownLexicalEditor";
import { readFeatureRequirementsSection } from "../../../utils/featureRequirementsSection";
import { serializeFeatureRequirementsSection } from "../../../utils/featureRequirementsEditing";
import { UnifiedWorkItemEditorSection } from "../UnifiedWorkItemEditorSection";

vi.mock("../StructuredMockupSectionEditor", () => ({
  StructuredMockupSectionEditor: ({
    value,
    onChange,
    definition,
  }: {
    value: string;
    onChange: (value: string) => void;
    definition: { key: string };
  }) => (
    <button
      data-testid="structured-mockup-editor"
      data-definition-key={definition.key}
      onClick={() =>
        onChange(
          '{"schemaVersion":"work-item-structured-mockup.v1","content":[]}',
        )
      }
    >
      {value}
    </button>
  ),
}));

vi.mock("../../LexicalEditor/MarkdownLexicalEditor", () => ({
  MarkdownLexicalEditor: ({
    value,
    mentionConfig,
    entitySlashConfig,
    fileReferenceConfig,
  }: {
    value: string;
    mentionConfig?: MarkdownLexicalEditorMentionConfig;
    entitySlashConfig?: MarkdownLexicalEditorEntitySlashConfig;
    fileReferenceConfig?: { scope: { kind: string } };
  }) => (
    <div
      data-testid="markdown-editor"
      data-mention-organization-id={mentionConfig?.organizationId ?? ""}
      data-entity-slash-organization-id={
        entitySlashConfig?.organizationId ?? ""
      }
      data-has-entity-slash={String(Boolean(entitySlashConfig))}
      data-file-reference-scope={fileReferenceConfig?.scope.kind ?? ""}
    >
      {value}
    </div>
  ),
}));

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeProvider theme={createTheme()}>{children}</ThemeProvider>
);

const makeSection = (
  overrides: Partial<EditorSection> = {},
): EditorSection => ({
  id: "requirements",
  header: { text: "Requirements", level: 2, editable: false },
  content: { initialText: "" },
  editable: true,
  ...overrides,
});

const makeTemplate = (section: EditorSection): EditorTemplate => ({
  id: "t1",
  name: "t",
  sections: [section],
});

describe("UnifiedWorkItemEditorSection helperText", () => {
  it("routes registry-selected structured mockup changes through the shared section callback", () => {
    const handleSectionChange = vi.fn();
    const value =
      '{"schemaVersion":"work-item-structured-mockup.v1","content":[{"type":"button"}]}';
    const section = makeSection({
      id: "mockup",
      kind: "structured-mockup",
      definition: { key: "mockup", label: "Mockup", kind: "structured-mockup" },
    });

    render(
      <UnifiedWorkItemEditorSection
        section={section}
        template={makeTemplate(section)}
        index={0}
        isLoading={false}
        getContentForSection={() => value}
        handleSectionChange={handleSectionChange}
      />,
      { wrapper },
    );

    const editor = screen.getByTestId("structured-mockup-editor");
    expect(editor).toHaveTextContent(value);
    expect(editor).toHaveAttribute("data-definition-key", "mockup");
    editor.click();
    expect(handleSectionChange).toHaveBeenCalledWith(
      "mockup",
      '{"schemaVersion":"work-item-structured-mockup.v1","content":[]}',
    );
  });
  it("renders helperText when provided on the section", () => {
    const section = makeSection({ helperText: "A helpful hint about scope." });
    render(
      <UnifiedWorkItemEditorSection
        section={section}
        template={makeTemplate(section)}
        index={0}
        isLoading={false}
        getContentForSection={() => ""}
        handleSectionChange={() => undefined}
      />,
      { wrapper },
    );

    expect(screen.getByText("A helpful hint about scope.")).toBeInTheDocument();
  });

  it("omits helperText element when not provided", () => {
    const section = makeSection();
    render(
      <UnifiedWorkItemEditorSection
        section={section}
        template={makeTemplate(section)}
        index={0}
        isLoading={false}
        getContentForSection={() => ""}
        handleSectionChange={() => undefined}
      />,
      { wrapper },
    );

    expect(
      screen.queryByText(/A helpful hint about scope\./),
    ).not.toBeInTheDocument();
  });

  it("passes mention config to the shared markdown editor", () => {
    const section = makeSection();
    render(
      <UnifiedWorkItemEditorSection
        section={section}
        template={makeTemplate(section)}
        index={0}
        isLoading={false}
        getContentForSection={() => "Body"}
        handleSectionChange={() => undefined}
        mentionConfig={{
          organizationId: "org-1",
          projectId: "project-1",
        }}
      />,
      { wrapper },
    );

    expect(screen.getByTestId("markdown-editor")).toHaveAttribute(
      "data-mention-organization-id",
      "org-1",
    );
  });

  it("passes entity slash config to the shared markdown editor", () => {
    const section = makeSection();
    render(
      <UnifiedWorkItemEditorSection
        section={section}
        template={makeTemplate(section)}
        index={0}
        isLoading={false}
        getContentForSection={() => "Body"}
        handleSectionChange={() => undefined}
        entitySlashConfig={{
          organizationId: "org-1",
          projectId: "project-1",
          onSearchEntities: vi.fn(),
        }}
      />,
      { wrapper },
    );

    expect(screen.getByTestId("markdown-editor")).toHaveAttribute(
      "data-has-entity-slash",
      "true",
    );
    expect(screen.getByTestId("markdown-editor")).toHaveAttribute(
      "data-entity-slash-organization-id",
      "org-1",
    );
  });

  it("passes file-reference scope to the shared markdown editor", () => {
    const section = makeSection();
    render(
      <UnifiedWorkItemEditorSection
        section={section}
        template={makeTemplate(section)}
        index={0}
        isLoading={false}
        getContentForSection={() => "Body"}
        handleSectionChange={() => undefined}
        fileReferenceConfig={{
          organizationId: "org-1",
          projectId: "project-1",
          scope: { kind: "task", taskId: "task-1" },
        }}
      />,
      { wrapper },
    );

    expect(screen.getByTestId("markdown-editor")).toHaveAttribute(
      "data-file-reference-scope",
      "task",
    );
  });
});

describe("UnifiedWorkItemEditorSection feature requirements", () => {
  const requirementsSection = makeSection({
    id: "requirements",
    kind: "json",
    definition: {
      key: "requirements",
      label: "Requirements",
      kind: "json",
      schemaRef: "#/components/schemas/FeatureRequirementsSection",
    },
  });
  const config = (typeKey: string) => ({
    typeKey,
    organizationId: "org-1",
    projectId: "project-1",
    featureId: "00000000-0000-4000-8000-00000000000a",
    parentId: null,
    onSearchEntities: vi.fn(async () => []),
  });

  it("edits the canonical FEATURE requirements section record by record", () => {
    const handleSectionChange = vi.fn();
    render(
      <UnifiedWorkItemEditorSection
        section={requirementsSection}
        template={makeTemplate(requirementsSection)}
        index={0}
        isLoading={false}
        getContentForSection={() => ""}
        handleSectionChange={handleSectionChange}
        requirementsEditorConfig={config("FEATURE")}
      />,
      { wrapper },
    );

    expect(screen.queryByTestId("markdown-editor")).not.toBeInTheDocument();
    screen.getByTestId("requirements-editor-add").click();
    expect(handleSectionChange).toHaveBeenCalledWith(
      "requirements",
      expect.stringContaining('"statement":""'),
    );
  });

  it("passes an identity-preserving group move to the host section save callback", () => {
    const first = {
      id: "00000000-0000-4000-8000-000000000001",
      statement: "One",
      designedBy: [],
      fulfilledBy: [],
      contracts: [],
    };
    const second = {
      ...first,
      id: "00000000-0000-4000-8000-000000000002",
      statement: "Two",
      group: "Alpha",
    };
    const handleSectionChange = vi.fn();
    render(
      <UnifiedWorkItemEditorSection
        section={requirementsSection}
        template={makeTemplate(requirementsSection)}
        index={0}
        isLoading={false}
        getContentForSection={() =>
          serializeFeatureRequirementsSection([first, second])
        }
        handleSectionChange={handleSectionChange}
        requirementsEditorConfig={config("FEATURE")}
      />,
      { wrapper },
    );
    const area = screen.getByTestId("requirements-editor-ungrouped");
    fireEvent.mouseDown(within(area).getByRole("combobox", { name: "Group" }));
    fireEvent.click(screen.getByRole("option", { name: "Alpha" }));
    expect(handleSectionChange).toHaveBeenCalledTimes(1);
    const [key, content] = handleSectionChange.mock.calls[0];
    expect(key).toBe("requirements");
    expect(readFeatureRequirementsSection(content)).toMatchObject({
      status: "valid",
      records: [second, { ...first, group: "Alpha" }],
    });
  });

  it("keeps other types' JSON sections on their existing editor", () => {
    render(
      <UnifiedWorkItemEditorSection
        section={requirementsSection}
        template={makeTemplate(requirementsSection)}
        index={0}
        isLoading={false}
        getContentForSection={() => ""}
        handleSectionChange={() => undefined}
        requirementsEditorConfig={config("CUSTOM")}
      />,
      { wrapper },
    );

    expect(screen.queryByTestId("requirements-editor")).not.toBeInTheDocument();
    expect(screen.getByTestId("markdown-editor")).toBeInTheDocument();
  });
});
