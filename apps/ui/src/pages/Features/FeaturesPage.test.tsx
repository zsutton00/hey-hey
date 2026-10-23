import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const queryState: Record<string, string> = {
  tab: "features",
  view: "tree",
  contentSearch: "",
  feature: "",
  section: "",
};
const setQueryMock = vi.fn();
const unifiedSearchMock = vi.fn();
const createAgentSessionMock = vi.fn();
const mockUseSuppressLayoutMainBottomSpacing = vi.fn();
const mockFeaturesPageContainerRef = vi.fn();
const mockUseRemainingViewportHeight = vi.fn(() => ({
  containerRef: mockFeaturesPageContainerRef,
  height: 640,
}));

const setMobileViewport = (matches: boolean): void => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: matches && query.includes("max-width"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

vi.mock("nuqs", () => ({
  parseAsString: {
    withDefault: (defaultValue: string) => ({ __default: defaultValue }),
  },
  parseAsStringLiteral: () => ({
    withDefault: (defaultValue: string) => ({ __default: defaultValue }),
  }),
  useQueryState: (key: string) => {
    const value = queryState[key];
    return [
      value,
      (next: string | null) => {
        queryState[key] = next ?? "";
        setQueryMock(key, next);
      },
    ];
  },
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org-1" }),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useProject: () => ({ data: { name: "Demo project" } }),
  useFeatureTree: () => ({
    roots: [
      {
        feature: { id: "feature-alpha", name: "Alpha" },
        children: [
          {
            feature: { id: "feature-alpha-child", name: "Alpha Child" },
            children: [],
          },
        ],
      },
      { feature: { id: "feature-beta", name: "Beta" }, children: [] },
    ],
    isLoading: false,
  }),
  useWorkItems: () => ({ createTask: vi.fn() }),
  useUnifiedSearch: () => ({ unifiedSearch: unifiedSearchMock }),
  useCreateAgentSession: (options: {
    onSuccess?: (session: { id: string; title?: string }) => void;
  } = {}) => ({
    mutate: (variables: unknown) => {
      createAgentSessionMock(variables);
      options.onSuccess?.({ id: "agent-session-1", title: "agent query" });
    },
    isPending: false,
  }),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  buildDefaultSurfaceSelection: () => ({
    provider: "codex",
    model: "gpt-5",
    reasoningEffort: "medium",
  }),
  EntitySearchChat: ({
    initialUserMessage,
  }: {
    initialUserMessage?: string;
  }) => (
    <div data-testid="entity-search-chat">
      agent search {initialUserMessage}
    </div>
  ),
  NewFeatureModal: () => null,
}));

vi.mock("@hey-hey/ui-common/components/AdvancedSearch/SearchInputs", () => ({
  SearchInputs: ({
    titleQuery,
    onTitleQueryChange,
    searchMode,
    onSearchModeChange,
    isLoading,
    onSearch,
  }: {
    titleQuery: string;
    onTitleQueryChange: (query: string) => void;
    searchMode: "title" | "content" | "agent";
    onSearchModeChange: (mode: "title" | "content" | "agent") => void;
    isLoading?: boolean;
    onSearch?: (mode?: "title" | "content" | "agent") => void;
  }) => {
    const label =
      searchMode === "title"
        ? "Title Search"
        : searchMode === "content"
          ? "Content Search"
          : "Agent Search";
    const handleModeClick = (mode: "title" | "content" | "agent"): void => {
      onSearchModeChange(mode);
      onSearch?.(mode);
    };
    return (
      <div data-testid="feature-search-control">
        <input
          aria-label={label}
          value={titleQuery}
          onChange={(event) => onTitleQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onSearch?.();
            }
          }}
        />
        <span
          className="MuiInputAdornment-root"
          data-testid="enter-search-prompt"
        >
          Press enter to search
        </span>
        <button
          type="button"
          data-testid="search-mode-title"
          aria-pressed={searchMode === "title"}
          onClick={() => handleModeClick("title")}
        >
          Title
        </button>
        <button
          type="button"
          data-testid="search-mode-content"
          aria-pressed={searchMode === "content"}
          onClick={() => handleModeClick("content")}
        >
          Content
        </button>
        <button
          type="button"
          data-testid="search-mode-agent"
          aria-pressed={searchMode === "agent"}
          onClick={() => handleModeClick("agent")}
          disabled={isLoading}
        >
          Agent
        </button>
      </div>
    );
  },
}));

vi.mock("../../components/Layout/LayoutMainBottomSpacingContext", () => ({
  useSuppressLayoutMainBottomSpacing: (shouldSuppress: boolean) =>
    mockUseSuppressLayoutMainBottomSpacing(shouldSuppress),
}));

vi.mock("../../hooks/useRemainingViewportHeight", () => ({
  useRemainingViewportHeight: (enabled: boolean, bottomInset: number) =>
    mockUseRemainingViewportHeight(enabled, bottomInset),
}));

interface MockFeaturesTreeViewProps {
  orientation?: "left-to-right" | "top-down";
  organizationId: string;
  projectId: string;
  searchQuery?: string;
  onSearchChange?: (value: string) => void;
  isMobileSearchActive?: boolean;
  onMobileFeatureSelect?: (featureId: string, rootId: string) => void;
}

vi.mock("./FeaturesTreeView", () => ({
  FeaturesTreeView: ({
    orientation,
    organizationId,
    projectId,
    searchQuery,
    isMobileSearchActive,
    onMobileFeatureSelect,
  }: MockFeaturesTreeViewProps) => (
    <div
      data-testid="features-tree-view"
      data-orientation={orientation}
      data-search-query={searchQuery ?? ""}
    >
      tree {organizationId}/{projectId}
      {onMobileFeatureSelect && (
        <button
          data-testid="features-wiki-toc-entry-feature-alpha"
          onClick={() =>
            onMobileFeatureSelect("feature-alpha", "feature-alpha")
          }
        >
          Alpha
        </button>
      )}
      {isMobileSearchActive && onMobileFeatureSelect && (
        <button
          data-testid="features-wiki-toc-entry-feature-alpha-child"
          onClick={() =>
            onMobileFeatureSelect("feature-alpha-child", "feature-alpha")
          }
        >
          Alpha Child
        </button>
      )}
    </div>
  ),
}));

interface MockBreadcrumbItem {
  label: string;
  to?: string;
  type?: string;
  isCurrent?: boolean;
}

interface MockTabDescriptor {
  value: string;
  label: string;
}

interface MockDetailPageTabsProps {
  value: string;
  onChange: (value: string) => void;
  tabs: MockTabDescriptor[];
}

vi.mock("../../components/Layout", () => ({
  DetailPageContainer: React.forwardRef<
    HTMLDivElement,
    {
      children: React.ReactNode;
      rootSx?: unknown;
      paperSx?: unknown;
    }
  >(({ children, rootSx, paperSx }, ref) => (
    <div
      ref={ref}
      data-testid="detail-page-container"
      data-root-sx={JSON.stringify(rootSx)}
    >
      <div
        data-testid="detail-page-container-paper"
        data-paper-sx={JSON.stringify(paperSx)}
      >
        {children}
      </div>
    </div>
  )),
  DetailPageHeader: ({ title }: { title: React.ReactNode }) => <h1>{title}</h1>,
  DetailPageTabs: ({ value, onChange, tabs }: MockDetailPageTabsProps) => (
    <div data-testid="detail-page-tabs">
      {tabs.map((tab) => (
        <button
          type="button"
          key={tab.value}
          data-testid={`tab-${tab.value}`}
          data-active={value === tab.value ? "true" : "false"}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  ),
  PageBreadcrumbs: ({ items }: { items: MockBreadcrumbItem[] }) => (
    <nav>
      {items.map((item, index) => (
        <span key={`${item.label}-${index}`}>{item.label}</span>
      ))}
    </nav>
  ),
}));

interface MockSegment {
  value: string;
  label: string;
}

interface MockSegmentedToggleProps {
  segments: MockSegment[];
  value: string;
  onChange: (value: string) => void;
}

vi.mock("../../components/SegmentedToggle", () => ({
  SegmentedToggle: ({
    segments,
    value,
    onChange,
  }: MockSegmentedToggleProps) => (
    <div
      data-testid={
        segments.some((segment) => segment.value === "tree")
          ? "features-view-toggle"
          : "mock-layout-toggle"
      }
    >
      {segments.map((segment) => (
        <button
          type="button"
          key={segment.value}
          data-testid={`view-${segment.value}`}
          data-active={value === segment.value ? "true" : "false"}
          onClick={() => onChange(segment.value)}
        >
          {segment.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("./DiscussFeatureTreeActionCapsule", () => ({
  DiscussFeatureTreeActionCapsule: ({
    organizationId,
    projectId,
  }: {
    organizationId: string | null;
    projectId: string | null;
  }) => (
    <div
      data-testid="discuss-feature-tree-capsule"
      data-organization-id={organizationId ?? ""}
      data-project-id={projectId ?? ""}
    />
  ),
}));

vi.mock("./FeatureReportsTab", () => ({
  FeatureReportsTab: ({
    organizationId,
    projectId,
  }: {
    organizationId: string;
    projectId: string;
  }) => (
    <div data-testid="feature-reports-tab-mock">
      reports {organizationId}/{projectId}
    </div>
  ),
}));

interface MockFeaturesDocumentViewProps {
  organizationId: string;
  projectId: string;
  searchQuery?: string;
  isMobileSearchActive?: boolean;
  onMobileFeatureSelect?: (featureId: string, rootId: string) => void;
  matchedFeatureIds?: Set<string>;
}

vi.mock("./FeaturesDocumentView", () => ({
  FeaturesDocumentView: ({
    organizationId,
    projectId,
    searchQuery,
    isMobileSearchActive,
    onMobileFeatureSelect,
    matchedFeatureIds,
  }: MockFeaturesDocumentViewProps) => (
    <div
      data-testid="features-document-view"
      data-search-query={searchQuery ?? ""}
      data-matched-feature-ids={
        matchedFeatureIds ? Array.from(matchedFeatureIds).join(",") : ""
      }
    >
      document {organizationId}/{projectId}
      {onMobileFeatureSelect && (
        <button
          data-testid="features-wiki-toc-entry-feature-alpha"
          onClick={() =>
            onMobileFeatureSelect("feature-alpha", "feature-alpha")
          }
        >
          Alpha
        </button>
      )}
      {isMobileSearchActive && onMobileFeatureSelect && (
        <button
          data-testid="features-wiki-toc-entry-feature-alpha-child"
          onClick={() =>
            onMobileFeatureSelect("feature-alpha-child", "feature-alpha")
          }
        >
          Alpha Child
        </button>
      )}
    </div>
  ),
}));

import { FeaturesPage } from "./FeaturesPage";

const renderAt = (path: string): ReturnType<typeof render> =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/projects/:projectId/features"
          element={<FeaturesPage />}
        />
      </Routes>
    </MemoryRouter>,
  );

describe("FeaturesPage tabs", () => {
  beforeEach(() => {
    setMobileViewport(false);
    queryState.tab = "features";
    queryState.view = "tree";
    queryState.contentSearch = "";
    queryState.feature = "";
    queryState.section = "";
    delete queryState.layout;
    localStorage.clear();
    setQueryMock.mockClear();
    unifiedSearchMock.mockReset();
    unifiedSearchMock.mockResolvedValue({
      results: [{ entityId: "feature-match-1" }],
    });
    createAgentSessionMock.mockClear();
    mockUseSuppressLayoutMainBottomSpacing.mockClear();
    mockUseRemainingViewportHeight.mockClear();
  });

  it("defaults to left-to-right and persists a layout selection", async () => {
    const user = userEvent.setup();
    renderAt("/projects/project-1/features");
    expect(screen.getByTestId("features-tree-view")).toHaveAttribute(
      "data-orientation",
      "left-to-right",
    );
    await user.click(screen.getByRole("button", { name: "Top-down" }));
    expect(setQueryMock).toHaveBeenCalledWith("layout", "top-down");
    expect(localStorage.getItem("features-tree-layout")).toBe("top-down");
    expect(screen.getByTestId("features-tree-view")).toHaveAttribute(
      "data-orientation",
      "top-down",
    );
  });

  it("restores storage when the URL has no layout", () => {
    localStorage.setItem("features-tree-layout", "top-down");
    renderAt("/projects/project-1/features");
    expect(screen.getByTestId("features-tree-view")).toHaveAttribute(
      "data-orientation",
      "top-down",
    );
  });

  it("gives URL layout precedence over storage", () => {
    localStorage.setItem("features-tree-layout", "top-down");
    queryState.layout = "left-to-right";
    renderAt("/projects/project-1/features");
    expect(screen.getByTestId("features-tree-view")).toHaveAttribute(
      "data-orientation",
      "left-to-right",
    );
    expect(localStorage.getItem("features-tree-layout")).toBe("left-to-right");
  });

  it("bounds the active features tab to the remaining viewport", () => {
    renderAt("/projects/project-1/features");

    expect(mockUseSuppressLayoutMainBottomSpacing).toHaveBeenCalledWith(true);
    expect(mockUseRemainingViewportHeight).toHaveBeenCalledWith(true, 0);
    expect(mockFeaturesPageContainerRef).toHaveBeenCalled();

    const pageContainer = screen.getByTestId("detail-page-container");
    expect(pageContainer).toHaveAttribute(
      "data-root-sx",
      expect.stringContaining('"height":"640px"'),
    );
    expect(pageContainer).toHaveAttribute(
      "data-root-sx",
      expect.stringContaining('"minWidth":0'),
    );
    expect(screen.getByTestId("detail-page-container-paper")).toHaveAttribute(
      "data-paper-sx",
      expect.stringContaining('"minHeight":0'),
    );
    expect(screen.getByTestId("detail-page-container-paper")).toHaveAttribute(
      "data-paper-sx",
      expect.stringContaining('"minWidth":0'),
    );
    const activeTabStyle = getComputedStyle(
      screen.getByTestId("features-page-active-tab"),
    );
    expect(activeTabStyle.minHeight).toBe("0");
    expect(activeTabStyle.minWidth).toBe("0");
  });

  it("places the compact create action in the Features header", () => {
    renderAt("/projects/project-1/features");

    const createButton = screen.getByTestId("create-feature-button");
    const title = within(screen.getByTestId("features-title-row")).getByRole(
      "heading",
      { level: 1 },
    );

    expect(createButton).toHaveAccessibleName("Create Feature");
    expect(createButton).toHaveTextContent("Add");
    expect(title).toHaveStyle({
      fontFamily:
          '"Work Sans", "Atkinson Hyperlegible", "Roboto", "Helvetica", "Arial", sans-serif',
    });
    expect(screen.getByTestId("features-title-row")).toContainElement(
      createButton,
    );
    expect(screen.getByTestId("feature-search-control")).not.toContainElement(
      createButton,
    );
  });

  it("keeps the title/action and search controls in separate right-aligned rows", () => {
    renderAt("/projects/project-1/features");

    const titleRow = screen.getByTestId("features-title-row");
    const searchRow = screen.getByTestId("features-search-row");

    expect(titleRow).toHaveStyle({
      display: "flex",
      justifyContent: "space-between",
      width: "100%",
    });
    expect(searchRow).toHaveStyle({
      display: "flex",
      justifyContent: "flex-end",
      width: "100%",
    });
    expect(titleRow).toContainElement(
      screen.getByTestId("create-feature-button"),
    );
    expect(searchRow).toContainElement(
      screen.getByTestId("feature-search-control"),
    );
    expect(titleRow).not.toContainElement(
      screen.getByTestId("feature-search-control"),
    );
    expect(searchRow).not.toContainElement(
      screen.getByTestId("create-feature-button"),
    );
    expect(
      titleRow.compareDocumentPosition(searchRow) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  });

  it("renders the features tab with the tree view by default and switches to reports on click", async () => {
    const { rerender } = renderAt("/projects/project-1/features");

    expect(
      await screen.findByTestId("features-tree-view"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("features-view-toggle")).toBeInTheDocument();
    expect(
      screen.queryByTestId("feature-reports-tab-mock"),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByTestId("tab-reports"));
    expect(setQueryMock).toHaveBeenCalledWith("tab", "reports");

    queryState.tab = "reports";
    rerender(
      <MemoryRouter initialEntries={["/projects/project-1/features"]}>
        <Routes>
          <Route
            path="/projects/:projectId/features"
            element={<FeaturesPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("feature-reports-tab-mock")).toHaveTextContent(
      "reports org-1/project-1",
    );
    expect(
      screen.queryByTestId("features-tree-view"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("features-view-toggle"),
    ).not.toBeInTheDocument();
  });

  it("renders the reports tab content when the URL state starts on reports", () => {
    queryState.tab = "reports";

    renderAt("/projects/project-1/features?tab=reports");

    expect(screen.getByTestId("feature-reports-tab-mock")).toBeInTheDocument();
    expect(
      screen.queryByTestId("features-tree-view"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("features-document-view"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("features-view-toggle"),
    ).not.toBeInTheDocument();
  });

  it("renders the document stub when tab=features and view=document", () => {
    queryState.tab = "features";
    queryState.view = "document";

    renderAt("/projects/project-1/features?tab=features&view=document");

    expect(screen.getByTestId("features-document-view")).toBeInTheDocument();
    expect(
      screen.queryByTestId("features-tree-view"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("features-view-toggle")).toBeInTheDocument();
  });

  it("keeps the project-scoped Discuss capsule separate from Document sections", () => {
    queryState.tab = "features";
    queryState.view = "document";

    renderAt("/projects/project-1/features?tab=features&view=document");

    expect(screen.getByTestId("discuss-feature-tree-capsule")).toHaveAttribute(
      "data-organization-id",
      "org-1",
    );
    expect(screen.getByTestId("discuss-feature-tree-capsule")).toHaveAttribute(
      "data-project-id",
      "project-1",
    );
    expect(screen.getByTestId("features-document-view")).toBeInTheDocument();
  });

  it("filters the mobile feature TOC on focus and navigates to the selected document", async () => {
    const { rerender } = renderAt("/projects/project-1/features");
    const input = screen.getByRole("textbox", { name: "Title Search" });

    await userEvent.click(input);
    await userEvent.type(input, "child");
    expect(
      screen.getByTestId("features-wiki-toc-entry-feature-alpha-child"),
    ).toBeInTheDocument();

    await userEvent.click(
      screen.getByTestId("features-wiki-toc-entry-feature-alpha-child"),
    );

    expect(setQueryMock).toHaveBeenCalledWith("feature", "feature-alpha");
    expect(setQueryMock).toHaveBeenCalledWith(
      "section",
      "feature-alpha-child",
    );
    expect(setQueryMock).toHaveBeenCalledWith("view", "document");
    expect(input).not.toHaveFocus();
    expect(input).toHaveValue("child");

    await userEvent.click(input);
    expect(
      screen.getByTestId("features-wiki-toc-entry-feature-alpha-child"),
    ).toBeInTheDocument();

    queryState.view = "document";
    queryState.feature = "feature-alpha";
    queryState.section = "feature-alpha-child";
    rerender(
      <MemoryRouter initialEntries={["/projects/project-1/features"]}>
        <Routes>
          <Route
            path="/projects/:projectId/features"
            element={<FeaturesPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("features-document-view")).toHaveAttribute(
      "data-search-query",
      "child",
    );
  });

  it("uses the page-owned selection path for an idle mobile feature entry", async () => {
    setMobileViewport(true);
    renderAt("/projects/project-1/features");

    await userEvent.click(
      screen.getByTestId("features-wiki-toc-entry-feature-alpha"),
    );

    expect(setQueryMock).toHaveBeenCalledWith("feature", "feature-alpha");
    expect(setQueryMock).toHaveBeenCalledWith("section", "feature-alpha");
    expect(setQueryMock).toHaveBeenCalledWith("view", "document");
    expect(screen.getByTestId("features-document-view")).toBeInTheDocument();
  });

  it("filters the active view through Title mode without a backend search request", async () => {
    renderAt("/projects/project-1/features");

    await userEvent.type(
      screen.getByRole("textbox", { name: "Title Search" }),
      "alpha",
    );

    expect(screen.getByTestId("features-tree-view")).toHaveAttribute(
      "data-search-query",
      "alpha",
    );
    expect(unifiedSearchMock).not.toHaveBeenCalled();
  });

  it("focuses the search field when the enter-to-search prompt is clicked without submitting", async () => {
    renderAt("/projects/project-1/features");

    const input = screen.getByRole("textbox", { name: "Title Search" });

    await userEvent.click(screen.getByTestId("enter-search-prompt"));

    expect(input).toHaveFocus();
    expect(unifiedSearchMock).not.toHaveBeenCalled();
    expect(createAgentSessionMock).not.toHaveBeenCalled();
  });

  it("hides the enter-to-search prompt on mobile while keeping it on desktop", () => {
    setMobileViewport(true);
    const { unmount } = renderAt("/projects/project-1/features");

    expect(screen.getByTestId("enter-search-prompt")).toHaveStyle({
      display: "none",
    });

    unmount();
    setMobileViewport(false);
    renderAt("/projects/project-1/features");

    expect(screen.getByTestId("enter-search-prompt")).toHaveStyle({
      display: "flex",
    });
  });

  it("submits Content mode through semantic unified search and passes matched ids to document view", async () => {
    const { rerender } = renderAt("/projects/project-1/features");

    await userEvent.click(screen.getByTestId("search-mode-content"));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Content Search" }),
      "semantic",
    );
    await userEvent.keyboard("{Enter}");

    expect(setQueryMock).toHaveBeenCalledWith("contentSearch", "semantic");

    queryState.contentSearch = "semantic";
    rerender(
      <MemoryRouter initialEntries={["/projects/project-1/features"]}>
        <Routes>
          <Route
            path="/projects/:projectId/features"
            element={<FeaturesPage />}
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(unifiedSearchMock).toHaveBeenCalledWith({
      intent: "semantic",
      query: "semantic",
      common: {
        types: ["TASK"],
        taskTypes: ["FEATURE"],
      },
    });
    expect(await screen.findByTestId("features-document-view")).toHaveAttribute(
      "data-matched-feature-ids",
      "feature-match-1",
    );
  });

  it("clears Content search when switching back to Title mode", async () => {
    queryState.contentSearch = "semantic";
    renderAt("/projects/project-1/features");

    await userEvent.click(screen.getByTestId("search-mode-title"));

    expect(setQueryMock).toHaveBeenCalledWith("contentSearch", null);
    expect(screen.getByTestId("features-view-toggle")).toBeInTheDocument();
  });

  it("starts Agent mode as an agent-search session with the submitted query", async () => {
    renderAt("/projects/project-1/features");

    await userEvent.click(screen.getByTestId("search-mode-agent"));
    await userEvent.type(
      screen.getByRole("textbox", { name: "Agent Search" }),
      "find roadmap features",
    );
    await userEvent.keyboard("{Enter}");

    expect(createAgentSessionMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      agentSession: {
        projectId: "project-1",
        type: "AGENT_SEARCH",
        sessionDate: expect.any(String),
        title: "find roadmap features",
      },
    });
    expect(screen.getByTestId("entity-search-chat")).toHaveTextContent(
      "Search feature entities only for: find roadmap features",
    );
  });
});
