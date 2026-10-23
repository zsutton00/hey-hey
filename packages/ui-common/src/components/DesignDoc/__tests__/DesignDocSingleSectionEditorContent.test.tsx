import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  MarkdownLexicalEditorEntitySlashConfig,
  MarkdownLexicalEditorMentionConfig,
} from "../../LexicalEditor/MarkdownLexicalEditor";
import { DesignDocSingleSectionEditorContent } from "../DesignDocSingleSectionEditorContent";

vi.mock("../../LexicalEditor/MarkdownLexicalEditor", () => ({
  MarkdownLexicalEditor: ({
    value,
    placeholder,
    entitySlashConfig,
    mentionConfig,
  }: {
    value: string;
    placeholder?: string;
    entitySlashConfig?: MarkdownLexicalEditorEntitySlashConfig;
    mentionConfig?: MarkdownLexicalEditorMentionConfig;
  }) => (
    <div
      data-testid="markdown-lexical-editor"
      data-mention-organization-id={mentionConfig?.organizationId ?? ""}
      data-mention-project-id={mentionConfig?.projectId ?? ""}
      data-slash-organization-id={entitySlashConfig?.organizationId ?? ""}
      data-slash-project-id={entitySlashConfig?.projectId ?? ""}
    >
      <div>{value}</div>
      <div>{placeholder}</div>
    </div>
  ),
}));

describe("DesignDocSingleSectionEditorContent", () => {
  it("renders editor content without a section heading", () => {
    render(
      <DesignDocSingleSectionEditorContent
        content="Plan details"
        onContentChange={vi.fn()}
        placeholder="Enter plan details..."
      />
    );

    expect(screen.getByTestId("markdown-lexical-editor")).toBeInTheDocument();
    expect(screen.queryByRole("heading")).not.toBeInTheDocument();
  });

  it("passes mention and entity slash context to the shared markdown editor", () => {
    render(
      <DesignDocSingleSectionEditorContent
        content="Plan details"
        onContentChange={vi.fn()}
        placeholder="Enter plan details..."
        mentionConfig={{
          organizationId: "org-1",
          projectId: "project-1",
        }}
        entitySlashConfig={{
          organizationId: "org-1",
          projectId: "project-1",
          onSearchEntities: vi.fn(),
        }}
      />
    );

    expect(screen.getByTestId("markdown-lexical-editor")).toHaveAttribute(
      "data-mention-organization-id",
      "org-1"
    );
    expect(screen.getByTestId("markdown-lexical-editor")).toHaveAttribute(
      "data-mention-project-id",
      "project-1"
    );
    expect(screen.getByTestId("markdown-lexical-editor")).toHaveAttribute(
      "data-slash-organization-id",
      "org-1"
    );
    expect(screen.getByTestId("markdown-lexical-editor")).toHaveAttribute(
      "data-slash-project-id",
      "project-1"
    );
  });
});
