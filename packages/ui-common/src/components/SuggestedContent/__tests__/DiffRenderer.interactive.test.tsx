import { fireEvent, render, screen, within } from "@testing-library/react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectContext } from "../../../contexts";
import { EagerIntersectionObserver } from "../../../test/eagerIntersectionObserver";
import { DiffRenderer, WordDiffText } from "../DiffRenderer";

const hookMocks = vi.hoisted(() => ({
  useWorkItemGraph: vi.fn(),
  useWorkItemTypeByKey: vi.fn(),
}));

vi.mock("../../../data/hooks/useWorkItemGraph", () => ({
  useWorkItemGraph: hookMocks.useWorkItemGraph,
}));

vi.mock("../../../data/hooks/useWorkItemTypes", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../../data/hooks/useWorkItemTypes")
  >()),
  useWorkItemTypeByKey: hookMocks.useWorkItemTypeByKey,
}));

const theme = createTheme();
const mentionTokens = {
  equal: "@[task:4a5bdbbe-68df-4ebf-af55-b157ff6d960c|Stable mention]",
  delete: "@[task:68895eb9-5d92-4643-8e8a-6692ebc13e0b|Removed mention]",
  insert: "@[task:9849a854-fc1f-4d76-8830-78d537390ef6|Added mention]",
} as const;
const workflowMentionTokens = {
  equal: "@[workflow:workflow-stable|Stable workflow]",
  delete: "@[workflow:workflow-removed|Removed workflow]",
  insert: "@[workflow:workflow-added|Added workflow]",
} as const;

const renderWithTheme = (component: React.ReactElement) =>
  render(
    <MemoryRouter>
      <ThemeProvider theme={theme}>
        <ProjectContext.Provider
          value={{
            organizationId: "org-1",
            projectId: "project-1",
            navigate: vi.fn(),
          }}
        >
          {component}
        </ProjectContext.Provider>
      </ThemeProvider>
    </MemoryRouter>
  );

const expectMentionTone = (
  mention: HTMLElement,
  tone: "equal" | "insert" | "delete"
) => {
  expect(mention).toHaveAttribute("data-diff-tone", tone);

  if (tone === "equal") {
    expect(mention).not.toHaveStyle({
      backgroundColor: theme.palette.success.main,
    });
    expect(mention).not.toHaveStyle({
      backgroundColor: theme.palette.error.light,
    });
    return;
  }

  const badge = within(mention).getByTestId("mention-badge");
  expect(badge).toHaveAttribute("data-mention-token", mentionTokens[tone]);
  expect(badge).toHaveStyle({
    backgroundColor:
      tone === "insert" ? theme.palette.success.main : theme.palette.error.light,
  });
};

describe("DiffRenderer interactive review", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", EagerIntersectionObserver);
    hookMocks.useWorkItemGraph.mockReturnValue({
      data: null,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
    hookMocks.useWorkItemTypeByKey.mockReturnValue({
      workItemTypeDefinition: {
        key: "workflow",
        name: "Workflow",
        sections: [],
        allowedStatuses: [],
        iconKey: "workflow",
      },
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    });
  });

  it.each(["inline", "split"] as const)(
    "styles added and removed mentions and leaves unchanged mentions unstyled in %s mode",
    (viewMode) => {
      renderWithTheme(
        <DiffRenderer
          oldContent={`${mentionTokens.equal}\n${mentionTokens.delete}`}
          newContent={`${mentionTokens.equal}\n${mentionTokens.insert}`}
          viewMode={viewMode}
          enableInteractiveReview
        />
      );

      const view = screen.getByTestId(
        viewMode === "inline"
          ? "diff-renderer-inline-view"
          : "diff-renderer-split-view"
      );
      const mentions = within(view).getAllByTestId("diff-renderer-mention");
      const getMentionsByTone = (
        tone: "equal" | "insert" | "delete"
      ): HTMLElement[] => {
        const matchingMentions = mentions.filter(
          (mention) => mention.getAttribute("data-diff-tone") === tone
        );
        expect(matchingMentions.length).toBeGreaterThan(0);
        return matchingMentions;
      };

      getMentionsByTone("equal").forEach((mention) =>
        expectMentionTone(mention, "equal")
      );
      getMentionsByTone("delete").forEach((mention) =>
        expectMentionTone(mention, "delete")
      );
      getMentionsByTone("insert").forEach((mention) =>
        expectMentionTone(mention, "insert")
      );
    }
  );

  it("reuses per-word and mention-aware rendering for structured text fragments", () => {
    const oldContent = `Keep old ${mentionTokens.delete}`;
    const newContent = `Keep new ${mentionTokens.insert}`;
    const { container } = renderWithTheme(
      <>
        <WordDiffText
          oldContent={oldContent}
          newContent={newContent}
          pane="old"
        />
        <WordDiffText
          oldContent={oldContent}
          newContent={newContent}
          pane="new"
        />
      </>
    );

    expect(container.querySelector("del")).toHaveTextContent("old");
    expect(container.querySelector("ins")).toHaveTextContent("new");
    expect(
      screen
        .getAllByTestId("diff-renderer-mention")
        .map((mention) => mention.getAttribute("data-diff-tone"))
    ).toEqual(expect.arrayContaining(["delete", "insert"]));
  });

  it.each(["inline", "split"] as const)(
    "applies mention-only change backgrounds in the non-interactive %s view",
    (viewMode) => {
      renderWithTheme(
        <DiffRenderer
          oldContent={`${mentionTokens.equal}\n${mentionTokens.delete}`}
          newContent={`${mentionTokens.equal}\n${mentionTokens.insert}`}
          viewMode={viewMode}
        />
      );

      const getBadges = (token: string): HTMLElement[] =>
        screen
          .getAllByTestId("mention-badge")
          .filter(
            (badge) => badge.getAttribute("data-mention-token") === token
          );

      const removedBadges = getBadges(mentionTokens.delete);
      const addedBadges = getBadges(mentionTokens.insert);
      const equalBadges = getBadges(mentionTokens.equal);

      expect(removedBadges.length).toBeGreaterThan(0);
      expect(addedBadges.length).toBeGreaterThan(0);
      expect(equalBadges.length).toBeGreaterThan(0);
      removedBadges.forEach((badge) =>
        expect(badge).toHaveStyle({ backgroundColor: theme.palette.error.light })
      );
      addedBadges.forEach((badge) =>
        expect(badge).toHaveStyle({ backgroundColor: theme.palette.success.main })
      );
      equalBadges.forEach((badge) => {
        expect(badge).not.toHaveStyle({
          backgroundColor: theme.palette.error.light,
        });
        expect(badge).not.toHaveStyle({
          backgroundColor: theme.palette.success.main,
        });
      });
    }
  );

  it.each(["inline", "split"] as const)(
    "renders retained workflow mentions through the workflow surface in both panes of the interactive %s view",
    (viewMode) => {
      renderWithTheme(
        <DiffRenderer
          oldContent={`${workflowMentionTokens.equal}\n${workflowMentionTokens.delete}`}
          newContent={`${workflowMentionTokens.equal}\n${workflowMentionTokens.insert}`}
          viewMode={viewMode}
          enableInteractiveReview
        />
      );

      const view = screen.getByTestId(
        viewMode === "inline"
          ? "diff-renderer-inline-view"
          : "diff-renderer-split-view"
      );
      const retainedWorkflowSurfaces = within(view).getAllByTestId(
        "workflow-inline-diagram-unavailable"
      );
      expect(retainedWorkflowSurfaces).toHaveLength(
        viewMode === "split" ? 4 : 3
      );

      const mentions = within(view).getAllByTestId("diff-renderer-mention");
      const tones = mentions.map((mention) =>
        mention.getAttribute("data-diff-tone")
      );
      expect(tones).toContain("equal");
      expect(tones).toContain("delete");
      expect(tones).toContain("insert");
    }
  );

  it.each(["inline", "split"] as const)(
    "renders retained workflow mentions through the workflow surface in the non-interactive %s view",
    (viewMode) => {
      renderWithTheme(
        <DiffRenderer
          oldContent={workflowMentionTokens.equal}
          newContent={workflowMentionTokens.equal}
          viewMode={viewMode}
        />
      );

      const view = screen.getByTestId(
        viewMode === "inline"
          ? "diff-renderer-inline-view"
          : "diff-renderer-split-view"
      );
      expect(
        within(view).getAllByTestId("workflow-inline-diagram-unavailable")
      ).toHaveLength(viewMode === "split" ? 2 : 1);
    }
  );

  it("defaults to inline view mode when toggle is enabled", () => {
    render(
      <DiffRenderer
        oldContent="legacy"
        newContent="updated"
        showViewModeToggle
        enableInteractiveReview
        onOperationDecisionChange={vi.fn()}
        operationTestIdPrefix="diff-op"
      />
    );

    expect(
      screen.getByTestId("diff-renderer-view-mode-toggle")
    ).toBeInTheDocument();
    expect(screen.getByTestId("diff-renderer-inline-view")).toBeInTheDocument();
    expect(
      screen.queryByTestId("diff-renderer-split-view")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("diff-op-0-ins")).toBeInTheDocument();
    expect(screen.getByTestId("diff-op-0-del")).toBeInTheDocument();
    expect(screen.queryByTestId("diff-op-1-ins")).not.toBeInTheDocument();
    expect(screen.queryByTestId("diff-op-1-del")).not.toBeInTheDocument();
  });

  it("switches to split mode via internal view toggle", () => {
    render(
      <DiffRenderer
        oldContent="legacy"
        newContent="updated"
        showViewModeToggle
        enableInteractiveReview
        onOperationDecisionChange={vi.fn()}
        operationTestIdPrefix="diff-op"
      />
    );

    fireEvent.click(screen.getByTestId("diff-renderer-view-mode-split"));

    expect(
      screen.queryByTestId("diff-renderer-inline-view")
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("diff-renderer-split-view")).toBeInTheDocument();
    expect(
      screen.getByTestId("diff-renderer-split-pane-old")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("diff-renderer-split-pane-new")
    ).toBeInTheDocument();
  });

  it("does not expose a split-code button in the toggle", () => {
    render(
      <DiffRenderer
        oldContent="legacy"
        newContent="updated"
        showViewModeToggle
        enableInteractiveReview
        onOperationDecisionChange={vi.fn()}
        operationTestIdPrefix="diff-op"
      />
    );

    expect(
      screen.queryByTestId("diff-renderer-view-mode-split-code")
    ).not.toBeInTheDocument();
  });

  it("renders line-based code rows in split-code mode with language metadata", () => {
    render(
      <DiffRenderer
        oldContent={"```ts\nconst value = 1;\n```"}
        newContent={"```ts\nconst value = 2;\n```"}
        viewMode="split-code"
      />
    );

    expect(
      screen.getByTestId("diff-renderer-split-code-view")
    ).toBeInTheDocument();
    expect(screen.getByText("Current (ts)")).toBeInTheDocument();
    expect(screen.getByText("Suggested (ts)")).toBeInTheDocument();

    const oldPane = screen.getByTestId("diff-renderer-split-code-pane-old");
    const newPane = screen.getByTestId("diff-renderer-split-code-pane-new");

    expect(within(oldPane).getByText("const value = 1;")).toBeInTheDocument();
    expect(within(newPane).getByText("const value = 2;")).toBeInTheDocument();
  });

  it("emits operation decision callbacks for accept/reject in split view", () => {
    const onOperationDecisionChange = vi.fn();

    render(
      <DiffRenderer
        oldContent="legacy"
        newContent="updated"
        showViewModeToggle
        enableInteractiveReview
        onOperationDecisionChange={onOperationDecisionChange}
        operationTestIdPrefix="diff-op"
      />
    );

    fireEvent.click(screen.getByTestId("diff-renderer-view-mode-split"));

    const operationElement = screen.getByTestId("diff-op-0-ins");
    fireEvent.mouseEnter(operationElement);
    fireEvent.click(screen.getByTestId("diff-op-0-accept"));
    fireEvent.click(screen.getByTestId("diff-op-0-reject"));

    expect(onOperationDecisionChange).toHaveBeenNthCalledWith(1, 0, "accepted");
    expect(onOperationDecisionChange).toHaveBeenNthCalledWith(2, 0, "rejected");
  });

  it("treats replace as one decision unit in split view (controls only on new segment)", () => {
    const onOperationDecisionChange = vi.fn();

    render(
      <DiffRenderer
        oldContent="legacy"
        newContent="updated"
        showViewModeToggle
        enableInteractiveReview
        onOperationDecisionChange={onOperationDecisionChange}
        operationTestIdPrefix="diff-op"
      />
    );

    fireEvent.click(screen.getByTestId("diff-renderer-view-mode-split"));

    fireEvent.mouseEnter(screen.getByTestId("diff-op-0-del"));
    expect(screen.queryByTestId("diff-op-0-accept")).not.toBeInTheDocument();

    fireEvent.mouseEnter(screen.getByTestId("diff-op-0-ins"));
    fireEvent.click(screen.getByTestId("diff-op-0-accept"));

    expect(onOperationDecisionChange).toHaveBeenCalledTimes(1);
    expect(onOperationDecisionChange).toHaveBeenCalledWith(0, "accepted");
  });
});
