import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  HelpNode,
  HelpNodeWithBody,
  HelpSearchResult,
  HelpTreeResponse,
} from "../../../api";
import type {
  UseHelpNodeReturn,
  UseHelpSearchReturn,
  UseHelpTreeReturn,
} from "../../../data/hooks";
import { useHelpNode, useHelpSearch, useHelpTree } from "../../../data/hooks";
import { DeepHelpView } from "../DeepHelpView";
import { HELP_DEMO_FALLBACK } from "../helpCapabilities";
import type { HelpCapabilities } from "../helpCapabilities";
import { HelpProvider } from "../HelpContext";

const helpFlags = vi.hoisted(() => ({ showMeHow: true }));
vi.mock("../helpFeatureFlags", () => ({
  get SHOW_ME_HOW_ENABLED() {
    return helpFlags.showMeHow;
  },
}));

vi.mock("../../../data/hooks", () => ({
  useHelpNode: vi.fn(),
  useHelpSearch: vi.fn(),
  useHelpTree: vi.fn(),
}));

const mockedUseHelpNode = vi.mocked(useHelpNode);
const mockedUseHelpSearch = vi.mocked(useHelpSearch);
const mockedUseHelpTree = vi.mocked(useHelpTree);

const FALLBACK_DEMOS = {
  "read-first-project": HELP_DEMO_FALLBACK,
  "install-agent-bridge": HELP_DEMO_FALLBACK,
  "features-ready": HELP_DEMO_FALLBACK,
  "create-a-service": HELP_DEMO_FALLBACK,
  "create-a-task": HELP_DEMO_FALLBACK,
  "first-agent-session": HELP_DEMO_FALLBACK,
} as const;

const node = (input: {
  id: string;
  parentId: string | null;
  slug: string;
  title: string;
  ordering: number;
}): HelpNode => input;

const fetchedTree: HelpTreeResponse = {
  items: [
    node({
      id: "install-agent-bridge",
      parentId: null,
      slug: "install-agent-bridge",
      title: "Install Agent Bridge",
      ordering: 2,
    }),
    node({
      id: "create-a-task",
      parentId: null,
      slug: "create-a-task",
      title: "Create a task",
      ordering: 3,
    }),
    node({
      id: "features-ready",
      parentId: null,
      slug: "features-ready",
      title: "Your features are ready",
      ordering: 1,
    }),
  ],
};

const searchResults: HelpSearchResult[] = [
  {
    id: "recovery-node",
    slug: "recovery",
    title: "Recovery",
    snippet: "Recover access after passkey synchronization.",
    rank: 0.99,
  },
];

const buildCapabilities = (
  overrides: Partial<HelpCapabilities> = {},
): HelpCapabilities => ({
  data: { features: [] },
  actions: {
    "import-repository": {
      status: "ready",
      error: null,
      execute: vi.fn(),
      retry: vi.fn(),
    },
  },
  routing: { buildHref: (intent: string) => `/${intent}` },
  demos: { ...FALLBACK_DEMOS },
  ...overrides,
});

const helpTreeReturn = (
  overrides: Partial<UseHelpTreeReturn> = {},
): UseHelpTreeReturn => ({
  tree: fetchedTree,
  isLoading: false,
  error: null,
  ...overrides,
});

const helpSearchReturn = (
  overrides: Partial<UseHelpSearchReturn> = {},
): UseHelpSearchReturn => ({
  results: [],
  isLoading: false,
  error: null,
  ...overrides,
});

const helpNodeReturn = (
  readKey: string,
  overrides: Partial<UseHelpNodeReturn> = {},
): UseHelpNodeReturn => {
  const titles: Record<string, string> = {
    "features-ready": "Your features are ready",
    "install-agent-bridge": "Install Agent Bridge",
    "create-a-task": "Create a task",
    "my-first-project": "My First Project",
    "my-first-project/choose-a-feature": "Choose a feature",
  };
  const node: HelpNodeWithBody = {
    id: readKey === "recovery-node" ? "recovery-node" : readKey,
    parentId: null,
    slug: readKey.split("/").at(-1) ?? readKey,
    title:
      readKey === "recovery-node" ? "Recovery" : (titles[readKey] ?? readKey),
    ordering: 1,
    body: `# Persisted ${readKey}\n\nRecovery data-boundary guidance for ${readKey}.`,
    demos: [],
  };

  return {
    data: node,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: vi.fn(async () => node),
    markStale: vi.fn(),
    ...overrides,
  };
};

const renderDeepHelp = (
  capabilities: HelpCapabilities = buildCapabilities(),
  excludedTopicIds?: readonly string[],
) =>
  render(
    <MemoryRouter>
      <HelpProvider capabilities={capabilities}>
        <DeepHelpView excludedTopicIds={excludedTopicIds} />
      </HelpProvider>
    </MemoryRouter>,
  );

const getRenderedTitles = (): string[] => {
  const view = screen.getByTestId("deep-help-view");
  return Array.from(view.querySelectorAll("h3")).map(
    (el) => el.textContent ?? "",
  );
};

describe("DeepHelpView", () => {
  beforeEach(() => {
    mockedUseHelpTree.mockReturnValue(helpTreeReturn());
    mockedUseHelpSearch.mockImplementation((query) =>
      query.trim().includes("passkey")
        ? helpSearchReturn({ results: searchResults })
        : helpSearchReturn(),
    );
    mockedUseHelpNode.mockImplementation((readKey) =>
      helpNodeReturn(readKey ?? "missing"),
    );
  });

  it("renders fetched help tree topics in adapted ordering", () => {
    renderDeepHelp();

    expect(getRenderedTitles()).toEqual([
      "Your features are ready",
      "Install Agent Bridge",
      "Create a task",
    ]);
  });

  it("renders only the selected root collection while retaining descendants and article lookup", () => {
    mockedUseHelpTree.mockReturnValue(
      helpTreeReturn({
        tree: {
          items: [
            node({
              id: "welcome-root-id",
              parentId: null,
              slug: "create-a-task",
              title: "Create a task",
              ordering: 1,
            }),
            node({
              id: "first-project-child-id",
              parentId: "first-project-root-id",
              slug: "choose-a-feature",
              title: "Choose a feature",
              ordering: 1,
            }),
            node({
              id: "first-project-root-id",
              parentId: null,
              slug: "my-first-project",
              title: "My First Project",
              ordering: 2,
            }),
            node({
              id: "reference-root-id",
              parentId: null,
              slug: "reference",
              title: "Reference",
              ordering: 3,
            }),
          ],
        },
      }),
    );

    render(
      <MemoryRouter>
        <HelpProvider capabilities={buildCapabilities()}>
          <DeepHelpView rootSection="first-project" />
        </HelpProvider>
      </MemoryRouter>,
    );

    expect(getRenderedTitles()).toEqual([
      "My First Project",
      "Choose a feature",
    ]);
    expect(mockedUseHelpNode).toHaveBeenCalledWith("my-first-project");
    expect(mockedUseHelpNode).toHaveBeenCalledWith(
      "my-first-project/choose-a-feature",
    );
  });

  it("excludes configured topics from the fetched help tree", () => {
    renderDeepHelp(buildCapabilities(), ["features-ready"]);

    expect(getRenderedTitles()).toEqual([
      "Install Agent Bridge",
      "Create a task",
    ]);
    const view = screen.getByTestId("deep-help-view");
    expect(within(view).getByText("1")).toBeInTheDocument();
    expect(within(view).getByText("2")).toBeInTheDocument();
    expect(within(view).queryByText("3")).not.toBeInTheDocument();
  });

  it("renders a numbered badge for each fetched topic", () => {
    renderDeepHelp();

    const view = screen.getByTestId("deep-help-view");
    [1, 2, 3].forEach((number) => {
      expect(within(view).getByText(String(number))).toBeInTheDocument();
    });
  });

  it("mounts only the platform demo opened from its own topic", async () => {
    const user = userEvent.setup();
    const demoMarker = (
      <div data-testid="install-agent-bridge-demo">demo content</div>
    );
    const otherDemoMarker = (
      <div data-testid="features-demo">features demo</div>
    );
    renderDeepHelp(
      buildCapabilities({
        demos: {
          ...FALLBACK_DEMOS,
          "install-agent-bridge": demoMarker,
          "features-ready": otherDemoMarker,
        },
      }),
    );

    expect(screen.queryByTestId("install-agent-bridge-demo")).toBeNull();
    expect(screen.queryByTestId("features-demo")).toBeNull();

    const installTopic = screen
      .getAllByTestId("help-topic-card")
      .find((card) => card.dataset.topicId === "install-agent-bridge");
    expect(installTopic).toBeTruthy();
    await user.click(
      within(installTopic!).getByRole("button", { name: "Show me how" }),
    );

    expect(screen.getByTestId("install-agent-bridge-demo")).toBeInTheDocument();
    expect(screen.queryByTestId("features-demo")).toBeNull();
  });

  it("renders ranked server search results and their snippets", () => {
    renderDeepHelp();

    const input = screen.getByTestId("deep-help-search-input");
    fireEvent.change(input, { target: { value: "passkey synchronization" } });

    expect(getRenderedTitles()).toEqual(["Recovery"]);
    expect(
      screen.getByText("Recover access after passkey synchronization."),
    ).toBeInTheDocument();
    expect(mockedUseHelpNode).toHaveBeenLastCalledWith("recovery-node");
  });

  it("excludes configured topics from server search results by slug", () => {
    mockedUseHelpSearch.mockReturnValue(
      helpSearchReturn({
        results: [
          {
            id: "fetched-features-ready-id",
            slug: "features-ready",
            title: "Your features are ready",
            snippet: "Review drafted features.",
            rank: 0.99,
          },
          ...searchResults,
        ],
      }),
    );
    renderDeepHelp(buildCapabilities(), ["features-ready"]);

    fireEvent.change(screen.getByTestId("deep-help-search-input"), {
      target: { value: "features" },
    });

    expect(getRenderedTitles()).toEqual(["Recovery"]);
    expect(
      screen.queryByText("Your features are ready"),
    ).not.toBeInTheDocument();
  });

  it("shows a loading state while the help tree is fetching", () => {
    mockedUseHelpTree.mockReturnValue(
      helpTreeReturn({
        tree: null,
        isLoading: true,
      }),
    );

    renderDeepHelp();

    expect(screen.getByTestId("deep-help-loading-state")).toBeInTheDocument();
    expect(
      screen.queryByTestId("deep-help-empty-state"),
    ).not.toBeInTheDocument();
  });

  it("shows authored getting-started guidance when the fetched tree has no topics", () => {
    mockedUseHelpTree.mockReturnValue(
      helpTreeReturn({
        tree: { items: [] },
      }),
    );

    renderDeepHelp();

    expect(screen.getByTestId("deep-help-fallback-state")).toBeInTheDocument();
    expect(getRenderedTitles()).toEqual([
      "Install Agent Bridge",
      "Your features are ready",
      "Read Your First Project",
    ]);
    expect(
      screen.getByText(/Learn how to shape your feature tree/),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("deep-help-empty-state"),
    ).not.toBeInTheDocument();
  });

  it("excludes configured topics from the authored catalog fallback", () => {
    mockedUseHelpTree.mockReturnValue(
      helpTreeReturn({
        tree: { items: [] },
      }),
    );

    renderDeepHelp(buildCapabilities(), ["features-ready"]);

    expect(getRenderedTitles()).toEqual([
      "Install Agent Bridge",
      "Read Your First Project",
    ]);
    expect(
      screen.queryByText("Your features are ready"),
    ).not.toBeInTheDocument();
  });

  it("shows an empty state when no fetched topics match the query", () => {
    mockedUseHelpSearch.mockReturnValue(helpSearchReturn());
    renderDeepHelp();

    const input = screen.getByTestId("deep-help-search-input");
    fireEvent.change(input, { target: { value: "zzzzznomatchzzzzz" } });

    expect(screen.getByTestId("deep-help-empty-state")).toBeInTheDocument();
  });

  it("restores every fetched topic when the query is cleared", () => {
    renderDeepHelp();

    const input = screen.getByTestId("deep-help-search-input");
    fireEvent.change(input, { target: { value: "zzzzznomatchzzzzz" } });
    expect(screen.getByTestId("deep-help-empty-state")).toBeInTheDocument();

    fireEvent.change(input, { target: { value: "" } });

    expect(
      screen.queryByTestId("deep-help-empty-state"),
    ).not.toBeInTheDocument();
    expect(getRenderedTitles()).toEqual([
      "Your features are ready",
      "Install Agent Bridge",
      "Create a task",
    ]);
  });

  it("renders persisted Markdown body structure for a browsed topic", () => {
    renderDeepHelp();

    expect(screen.getByText(/# Persisted features-ready/)).toBeInTheDocument();
    expect(
      screen.getByText(/Recovery data-boundary guidance for features-ready\./),
    ).toBeInTheDocument();
    expect(mockedUseHelpNode).toHaveBeenCalledWith("features-ready");
  });

  it("shows an explicit read error and retries without static body fallback", () => {
    const refetch = vi.fn(async () => null);
    mockedUseHelpNode.mockImplementation((readKey) =>
      helpNodeReturn(readKey ?? "missing", {
        data: null,
        isFetched: true,
        isReady: false,
        error: new Error("read failed"),
        refetch,
      }),
    );

    renderDeepHelp();

    expect(screen.getAllByTestId("help-topic-error-state")).toHaveLength(3);
    expect(screen.queryByText(/Persisted features-ready/)).toBeNull();

    fireEvent.click(screen.getAllByTestId("help-topic-retry-button")[0]);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
  describe("table of contents", () => {
    const nestedTree: HelpTreeResponse = {
      items: [
        node({
          id: "first-project-child-b",
          parentId: "first-project-root-id",
          slug: "run-a-session",
          title: "Run a session",
          ordering: 2,
        }),
        node({
          id: "first-project-child-a",
          parentId: "first-project-root-id",
          slug: "choose-a-feature",
          title: "Choose a feature",
          ordering: 1,
        }),
        node({
          id: "first-project-root-id",
          parentId: null,
          slug: "my-first-project",
          title: "My First Project",
          ordering: 2,
        }),
        node({
          id: "reference-root-id",
          parentId: null,
          slug: "reference",
          title: "Reference",
          ordering: 3,
        }),
        node({
          id: "reference-child-id",
          parentId: "reference-root-id",
          slug: "glossary",
          title: "Glossary",
          ordering: 1,
        }),
        node({
          id: "faq-root-id",
          parentId: null,
          slug: "faq",
          title: "Frequently asked questions",
          ordering: 1,
        }),
      ],
    };

    const renderSection = (
      rootSection: "first-project" | "help",
      excludedTopicIds?: readonly string[],
    ) =>
      render(
        <MemoryRouter>
          <HelpProvider capabilities={buildCapabilities()}>
            <DeepHelpView
              rootSection={rootSection}
              excludedTopicIds={excludedTopicIds}
            />
          </HelpProvider>
        </MemoryRouter>,
      );

    const getTocEntries = (): Array<[string, string | null]> =>
      screen
        .getAllByTestId("help-table-of-contents-entry")
        .map((entry) => [
          entry.textContent ?? "",
          entry.getAttribute("data-depth"),
        ]);

    beforeEach(() => {
      mockedUseHelpTree.mockReturnValue(helpTreeReturn({ tree: nestedTree }));
    });

    it("lists the Your First Project guide in sibling order with nested children", () => {
      renderSection("first-project");

      expect(getTocEntries()).toEqual([
        ["My First Project", "0"],
        ["Choose a feature", "1"],
        ["Run a session", "1"],
      ]);
    });

    it("lists the Help library roots and their children", () => {
      renderSection("help");

      expect(getTocEntries()).toEqual([
        ["Frequently asked questions", "0"],
        ["Reference", "0"],
        ["Glossary", "1"],
      ]);
    });

    it("omits excluded topics", () => {
      renderSection("help", ["faq"]);

      expect(getTocEntries()).toEqual([
        ["Reference", "0"],
        ["Glossary", "1"],
      ]);
    });

    it("hides the table of contents while a search query is active", async () => {
      renderSection("help");
      expect(screen.getByTestId("help-table-of-contents")).toBeInTheDocument();

      await userEvent.type(
        screen.getByTestId("deep-help-search-input"),
        "passkey",
      );

      expect(screen.queryByTestId("help-table-of-contents")).toBeNull();
      expect(getRenderedTitles()).toEqual(["Recovery"]);
    });

    it("scrolls to the matching article when an entry is selected", () => {
      const scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = scrollIntoView;
      renderSection("first-project");

      const toc = screen.getByTestId("help-table-of-contents");
      fireEvent.click(within(toc).getByText("Choose a feature"));

      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      const target = scrollIntoView.mock.contexts[0] as HTMLElement;
      expect(target.getAttribute("data-topic-id")).toBe(
        "first-project-child-a",
      );
      expect(target.id).toBe("help-topic-my-first-project--choose-a-feature");
    });
  });
});
