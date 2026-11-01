import { fireEvent, render, screen } from "@testing-library/react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ModeFilesSectionRenderer } from "../ModeFilesSectionRenderer";
import { MarkdownRenderer } from "../MarkdownRenderer";

vi.mock(
  "react-markdown",
  () => import("../../../../node_modules/react-markdown/index.js"),
);

const hookMocks = vi.hoisted(() => ({
  useWorkItem: vi.fn(),
  useWorkItemTypeByKey: vi.fn(),
}));

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: hookMocks.useWorkItem,
}));

vi.mock("../../../data/hooks/useWorkItemTypes", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../data/hooks/useWorkItemTypes")
  >()),
  useWorkItemTypeByKey: hookMocks.useWorkItemTypeByKey,
}));

vi.mock("../../SmarterTextAreaCard/MentionBadge", async () => {
  const { useContext } = await import("react");
  const { MentionEditorContext } =
    await import("../../SmarterTextAreaCard/EditorContext");

  return {
    MentionBadgeInner: ({
      mention,
    }: {
      mention: { entityId: string; entityType: string; entityName: string };
    }) => {
      const context = useContext(MentionEditorContext);
      return (
        <button
          type="button"
          data-testid="mention-node"
          data-entity-id={mention.entityId}
          data-entity-type={mention.entityType}
          data-organization-id={context?.organizationId}
          data-project-id={context?.projectId}
          onClick={() =>
            context?.navigate(`/${mention.entityType}/${mention.entityId}`)
          }
        >
          {mention.entityName}
        </button>
      );
    },
  };
});

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeProvider theme={createTheme()}>{children}</ThemeProvider>
);

describe("ModeFilesSectionRenderer", () => {
  beforeEach(() => {
    hookMocks.useWorkItem.mockReturnValue({
      workItem: undefined,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
    hookMocks.useWorkItemTypeByKey.mockImplementation(
      (_organizationId: string, _projectId: string, typeKey: string) => ({
        workItemTypeSummary: undefined,
        workItemTypeDefinition: {
          key: typeKey,
          name: typeKey,
          capabilities: { rendersInline: false },
          allowedStatuses: [],
          sections: [],
        },
        isLoading: false,
        isFetching: false,
        isFetched: true,
        isReady: true,
        error: null,
        isStale: false,
        refetch: vi.fn(),
        markStale: vi.fn(),
      }),
    );
  });

  it("reviews modified, added and removed files in the selected pane and retains unchanged files", () => {
    const content = {
      schemaVersion: "project-mode-files.v1",
      files: {
        "MODE.md": "# Guide\n\nRead the new guidance, then finish.",
        "references/added.md": "Added guidance",
        "same.md": "Unchanged guidance",
      },
    };
    render(
      <ModeFilesSectionRenderer
        content={content}
        comparison={{
          defaultViewMode: "inline",
          currentContent: {
            schemaVersion: "project-mode-files.v1",
            files: {
              "MODE.md": "# Guide\n\nRead the old guidance, then stop.",
              "references/removed.md": "Removed guidance",
              "same.md": "Unchanged guidance",
            },
          },
        }}
      />,
      { wrapper },
    );
    expect(
      screen.getByRole("button", { name: "MODE.md (modified)" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(screen.getAllByTestId("mode-file-diff")).toHaveLength(1);
    expect(screen.getByTestId("diff-renderer-inline-view")).toHaveTextContent(
      "guidance",
    );
    const flowingParagraphs = screen
      .getByTestId("diff-renderer-inline-view")
      .querySelectorAll("p");
    expect(flowingParagraphs.length).toBeGreaterThan(1);
    flowingParagraphs.forEach((paragraph) =>
      expect(paragraph).toHaveStyle({ display: "inline" }),
    );
    expect(screen.getByTestId("mode-files-selected-content")).toHaveTextContent(
      "Read the oldnew guidance, then stopfinish.",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "references/removed.md (removed)" }),
    );
    expect(screen.getByTestId("mode-files-selected-content")).toHaveTextContent(
      "Removed guidance",
    );
    fireEvent.click(screen.getByTestId("diff-renderer-view-mode-split"));
    expect(
      screen.getByTestId("diff-renderer-split-pane-old"),
    ).toHaveTextContent("Removed guidance");
    expect(
      screen.getByTestId("diff-renderer-split-pane-new"),
    ).not.toHaveTextContent("Removed guidance");
    fireEvent.click(
      screen.getByRole("button", { name: "references/added.md (added)" }),
    );
    expect(screen.getByTestId("mode-files-selected-content")).toHaveTextContent(
      "Added guidance",
    );
    fireEvent.click(screen.getByTestId("mode-files-toggle-unchanged"));
    fireEvent.click(
      screen.getByRole("button", { name: "same.md (unchanged)" }),
    );
    expect(screen.getByTestId("mode-files-selected-content")).toHaveTextContent(
      "Unchanged guidance",
    );
    expect(screen.queryByTestId("mode-file-diff")).not.toBeInTheDocument();
  });

  it("keeps mentions interactive inside selected file comparisons in Inline and Split", () => {
    const navigate = vi.fn();
    const beforeMention =
      "@[task:68895eb9-5d92-4643-8e8a-6692ebc13e0b|Earlier guidance]";
    const afterMention =
      "@[task:9849a854-fc1f-4d76-8830-78d537390ef6|Updated guidance]";
    const bundle = (text: string) => ({
      schemaVersion: "project-mode-files.v1",
      files: { "MODE.md": text },
    });
    render(
      <ModeFilesSectionRenderer
        content={bundle(`Read ${afterMention}.`)}
        comparison={{
          currentContent: bundle(`Read ${beforeMention}.`),
          defaultViewMode: "inline",
        }}
        mentionConfig={{
          organizationId: "org-1",
          projectId: "project-1",
          navigate,
        }}
      />,
      { wrapper },
    );
    fireEvent.click(screen.getByRole("button", { name: "Updated guidance" }));
    expect(navigate).toHaveBeenCalledWith(
      "/task/9849a854-fc1f-4d76-8830-78d537390ef6",
    );
    fireEvent.click(screen.getByTestId("diff-renderer-view-mode-split"));
    fireEvent.click(screen.getByRole("button", { name: "Earlier guidance" }));
    expect(navigate).toHaveBeenCalledWith(
      "/task/68895eb9-5d92-4643-8e8a-6692ebc13e0b",
    );
  });

  it("uses readable monospace for file content, headings, and paths only", () => {
    const fontFamily =
      "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace";
    render(
      <>
        <ModeFilesSectionRenderer
          content={{
            schemaVersion: "project-mode-files.v1",
            files: {
              "MODE.md":
                "# First\n\n## Second\n\n### Third\n\n#### Fourth\n\n##### Fifth\n\n###### Sixth\n\nBody text.",
            },
          }}
        />
        <MarkdownRenderer>{"# Ordinary heading"}</MarkdownRenderer>
      </>,
      { wrapper },
    );
    expect(
      screen.getByRole("heading", { name: "First" }).parentElement,
    ).toHaveStyle({ fontFamily, fontSize: "1rem", lineHeight: "1.6" });
    for (const name of [
      "First",
      "Second",
      "Third",
      "Fourth",
      "Fifth",
      "Sixth",
    ]) {
      expect(screen.getByRole("heading", { name })).toHaveStyle({ fontFamily });
    }
    expect(screen.getByRole("button", { name: "MODE.md" })).toHaveStyle({
      fontFamily,
    });
    expect(screen.getByTestId("mode-files-selected-path")).toHaveStyle({
      fontFamily,
    });
    expect(
      screen.getByRole("heading", { name: "Ordinary heading" }),
    ).not.toHaveStyle({ fontFamily });
  });

  it("keeps the entry file flush and gives every supporting path one indent", () => {
    render(
      <ModeFilesSectionRenderer
        content={{
          schemaVersion: "project-mode-files.v1",
          files: {
            "MODE.md": "Start here.",
            "references/checklist.md": "Check this list.",
            "examples/review.md": "Review this example.",
          },
        }}
      />,
      { wrapper },
    );

    expect(screen.getByTestId("mode-files-selected-path")).toHaveTextContent(
      "MODE.md",
    );
    expect(screen.getByTestId("mode-files-selected-content")).toHaveTextContent(
      "Start here.",
    );

    const rootFile = screen.getByRole("button", { name: "MODE.md" });
    const supportingFiles = [
      screen.getByRole("button", { name: "examples/review.md" }),
      screen.getByRole("button", { name: "references/checklist.md" }),
    ];
    expect(rootFile).toHaveAttribute("data-file-level", "root");
    expect(rootFile).toHaveStyle({ marginLeft: "0px" });
    for (const supportingFile of supportingFiles) {
      expect(supportingFile).toHaveAttribute("data-file-level", "supporting");
      expect(supportingFile).toHaveStyle({ marginLeft: "16px" });
    }

    fireEvent.click(
      screen.getByRole("button", { name: "references/checklist.md" }),
    );

    expect(screen.getByTestId("mode-files-selected-path")).toHaveTextContent(
      "references/checklist.md",
    );
    expect(screen.getByTestId("mode-files-selected-content")).toHaveTextContent(
      "Check this list.",
    );
  });

  it("renders the selected file as Markdown with interactive canonical mentions", () => {
    const navigate = vi.fn();
    render(
      <ModeFilesSectionRenderer
        content={{
          schemaVersion: "project-mode-files.v1",
          files: {
            "MODE.md":
              "Open the [review guide](https://example.com/review) with @[feature:8be2f12f-4313-427a-a279-70f94136f0c6|@ Mention Nodes].",
            "references/checklist.md":
              "Use the [first item](https://example.com/checklist) with @[contract:7913ee36-65ef-4549-85f1-d38dadd34b29|Registry-defined work-item rendering boundary].",
          },
        }}
        mentionConfig={{
          organizationId: "organization-1",
          projectId: "project-1",
          navigate,
        }}
      />,
      { wrapper },
    );

    expect(screen.getByRole("link", { name: "review guide" })).toHaveAttribute(
      "href",
      "https://example.com/review",
    );
    expect(screen.getByTestId("mention-node")).toHaveAttribute(
      "data-entity-id",
      "8be2f12f-4313-427a-a279-70f94136f0c6",
    );
    expect(screen.getByTestId("mention-node")).toHaveAttribute(
      "data-entity-type",
      "feature",
    );
    expect(screen.getByTestId("mention-node")).toHaveAttribute(
      "data-organization-id",
      "organization-1",
    );
    expect(screen.getByTestId("mention-node")).toHaveAttribute(
      "data-project-id",
      "project-1",
    );
    fireEvent.click(screen.getByTestId("mention-node"));
    expect(navigate).toHaveBeenCalledWith(
      "/feature/8be2f12f-4313-427a-a279-70f94136f0c6",
    );
    expect(
      hookMocks.useWorkItem.mock.calls.some(
        (call) => call[3]?.enabled === true,
      ),
    ).toBe(false);

    fireEvent.click(
      screen.getByRole("button", { name: "references/checklist.md" }),
    );

    expect(screen.getByRole("link", { name: "first item" })).toHaveAttribute(
      "href",
      "https://example.com/checklist",
    );
    expect(screen.getByTestId("mention-node")).toHaveAttribute(
      "data-entity-type",
      "contract",
    );
    expect(screen.getByTestId("mention-node")).toHaveAttribute(
      "data-entity-id",
      "7913ee36-65ef-4549-85f1-d38dadd34b29",
    );
    fireEvent.click(screen.getByTestId("mention-node"));
    expect(navigate).toHaveBeenLastCalledWith(
      "/contract/7913ee36-65ef-4549-85f1-d38dadd34b29",
    );
    expect(
      screen.queryByRole("link", { name: "review guide" }),
    ).not.toBeInTheDocument();
  });

  it("withholds raw content when the canonical bundle is unavailable", () => {
    render(
      <ModeFilesSectionRenderer
        content={{
          files: { "MODE.md": "This must not be shown as generic JSON." },
        }}
      />,
      { wrapper },
    );

    expect(
      screen.getByTestId("mode-files-section-unavailable"),
    ).toHaveTextContent("files are unavailable");
    expect(
      screen.queryByTestId("mode-files-selected-content"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("This must not be shown as generic JSON."),
    ).not.toBeInTheDocument();
  });
});
