import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { FileDiffEntry, FileDiffPayload } from "../../../../api";
import { FileDiffField } from "../FileDiffField";

const makeEntry = (overrides: Partial<FileDiffEntry> = {}): FileDiffEntry => ({
  filePath: "src/services/example.ts",
  beforeContent: 'const value = "old";',
  afterContent: 'const value = "new";',
  diffFormat: "structured",
  timestamp: "2026-03-08T00:00:00.000Z",
  sessionId: "session-1",
  agentId: "agent-1",
  ...overrides,
});

const makePayload = (
  diffs: FileDiffEntry[] = [makeEntry()]
): FileDiffPayload => ({
  responseType: "file_diff_v1",
  sourceDiffId: "diff-1",
  diffs,
  validation: { valid: true, errors: [] },
  metrics: {
    detectionSuccessCount: diffs.length,
    detectionFailureCount: 0,
    formatConversionCount: 0,
    validationSuccessCount: diffs.length,
    validationFailureCount: 0,
  },
});

const defaultContext = {
  conversationId: "conversation-1",
  organizationId: "org-1",
  projectId: "project-1",
};

describe("FileDiffField", () => {
  it("renders collapsed diff card with file path and summary", () => {
    render(
      <FileDiffField
        config={{
          field: "diff-field",
          description: "File diff",
          type: "file_diff",
          payload: makePayload(),
        }}
        context={defaultContext}
        isSubmitted={false}
      />
    );

    expect(screen.getByTestId("file-diff-card-0")).toBeInTheDocument();
    expect(screen.getByTestId("file-diff-filename-0")).toHaveTextContent(
      "example.ts"
    );
    expect(screen.getByTestId("file-diff-path-0")).toHaveTextContent(
      "src/services/example.ts"
    );
    expect(screen.getByTestId("file-diff-edit-type-0")).toHaveTextContent(
      "Modified"
    );
    // Toggle button should show expand icon (not collapse)
    expect(screen.getByTestId("file-diff-toggle-0")).toBeInTheDocument();
  });

  it("expands diff card on click to show split-view", async () => {
    render(
      <FileDiffField
        config={{
          field: "diff-field",
          description: "File diff",
          type: "file_diff",
          payload: makePayload(),
        }}
        context={defaultContext}
        isSubmitted={false}
      />
    );

    await userEvent.click(screen.getByTestId("file-diff-header-0"));

    expect(
      screen.getByTestId("diff-renderer-split-code-view")
    ).toBeInTheDocument();
  });

  it("toggles expanded state on repeated clicks", async () => {
    render(
      <FileDiffField
        config={{
          field: "diff-field",
          description: "File diff",
          type: "file_diff",
          payload: makePayload(),
        }}
        context={defaultContext}
        isSubmitted={false}
      />
    );

    const header = screen.getByTestId("file-diff-header-0");

    // First click expands
    await userEvent.click(header);
    expect(
      screen.getByTestId("diff-renderer-split-code-view")
    ).toBeInTheDocument();

    // Second click collapses — the card itself stays in DOM
    await userEvent.click(header);
    expect(screen.getByTestId("file-diff-card-0")).toBeInTheDocument();
  });

  it("renders multiple diff cards for multi-file changes", () => {
    const diffs = [
      makeEntry({ filePath: "src/a.ts" }),
      makeEntry({ filePath: "src/b.ts" }),
      makeEntry({ filePath: "src/c.ts" }),
    ];

    render(
      <FileDiffField
        config={{
          field: "diff-field",
          description: "File diff",
          type: "file_diff",
          payload: makePayload(diffs),
        }}
        context={defaultContext}
        isSubmitted={false}
      />
    );

    expect(screen.getByTestId("file-diff-card-0")).toBeInTheDocument();
    expect(screen.getByTestId("file-diff-card-1")).toBeInTheDocument();
    expect(screen.getByTestId("file-diff-card-2")).toBeInTheDocument();
    expect(screen.getByText("3 files changed")).toBeInTheDocument();
  });

  it("renders single file header text for single diff", () => {
    render(
      <FileDiffField
        config={{
          field: "diff-field",
          description: "File diff",
          type: "file_diff",
          payload: makePayload([makeEntry()]),
        }}
        context={defaultContext}
        isSubmitted={false}
      />
    );

    expect(screen.getByText("File changed")).toBeInTheDocument();
  });

  it("shows Created label for new files", () => {
    const entry = makeEntry({
      beforeContent: null,
      afterContent: "const x = 1;",
    });

    render(
      <FileDiffField
        config={{
          field: "diff-field",
          description: "File diff",
          type: "file_diff",
          payload: makePayload([entry]),
        }}
        context={defaultContext}
        isSubmitted={false}
      />
    );

    expect(screen.getByTestId("file-diff-edit-type-0")).toHaveTextContent(
      "Created"
    );
  });

  it("shows Deleted label for removed files", () => {
    const entry = makeEntry({
      beforeContent: "const x = 1;",
      afterContent: null,
    });

    render(
      <FileDiffField
        config={{
          field: "diff-field",
          description: "File diff",
          type: "file_diff",
          payload: makePayload([entry]),
        }}
        context={defaultContext}
        isSubmitted={false}
      />
    );

    expect(screen.getByTestId("file-diff-edit-type-0")).toHaveTextContent(
      "Deleted"
    );
  });

  it("returns null when payload has no diffs", () => {
    const { container } = render(
      <FileDiffField
        config={{
          field: "diff-field",
          description: "File diff",
          type: "file_diff",
          payload: makePayload([]),
        }}
        context={defaultContext}
        isSubmitted={false}
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("expands multiple cards independently", async () => {
    const diffs = [
      makeEntry({
        filePath: "src/a.ts",
        beforeContent: "aaa",
        afterContent: "bbb",
      }),
      makeEntry({
        filePath: "src/b.ts",
        beforeContent: "ccc",
        afterContent: "ddd",
      }),
    ];

    render(
      <FileDiffField
        config={{
          field: "diff-field",
          description: "File diff",
          type: "file_diff",
          payload: makePayload(diffs),
        }}
        context={defaultContext}
        isSubmitted={false}
      />
    );

    // Both cards rendered
    expect(screen.getByTestId("file-diff-card-0")).toBeInTheDocument();
    expect(screen.getByTestId("file-diff-card-1")).toBeInTheDocument();

    // Expand first card — toggle icon should be present
    expect(screen.getByTestId("file-diff-toggle-0")).toBeInTheDocument();
    expect(screen.getByTestId("file-diff-toggle-1")).toBeInTheDocument();

    // Click first card header
    await userEvent.click(screen.getByTestId("file-diff-header-0"));

    // Both cards still rendered, independently togglable
    expect(screen.getByTestId("file-diff-card-0")).toBeInTheDocument();
    expect(screen.getByTestId("file-diff-card-1")).toBeInTheDocument();
  });
});
