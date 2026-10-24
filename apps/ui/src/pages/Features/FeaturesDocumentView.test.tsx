import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const visualRenders = vi.hoisted(() => vi.fn());

vi.mock("./FeatureSectionVisuals", () => ({
  FeatureSectionVisuals: ({
    featureId,
    suspended,
  }: {
    featureId: string;
    suspended?: boolean;
  }) => {
    visualRenders(featureId, suspended);
    return <div data-testid={`feature-section-visuals-${featureId}`} />;
  },
}));

const queryState: Record<string, string | null> = {
  feature: null,
  section: null,
};
const setQueryMock = vi.fn();
const queryListeners = new Set<() => void>();
const subscribeToQuery = (listener: () => void) => {
  queryListeners.add(listener);
  return () => {
    queryListeners.delete(listener);
  };
};
const querySetters: Record<string, (next: string | null) => void> = {
  feature: (next) => {
    queryState.feature = next;
    setQueryMock("feature", next);
    queryListeners.forEach((listener) => listener());
  },
  section: (next) => {
    queryState.section = next;
    setQueryMock("section", next);
    queryListeners.forEach((listener) => listener());
  },
};

const setDesktopViewport = (matches: boolean): void => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: matches && query.includes("min-width"),
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
  parseAsString: { __id: "string" },
  useQueryState: (key: string) => {
    const value = React.useSyncExternalStore(
      subscribeToQuery,
      () => queryState[key],
    );
    return [value, querySetters[key]];
  },
}));

interface MockSection {
  key: string;
  materializedMarkdown: string;
  order: number;
  id: string;
  crdtSnapshotSeq: null;
}

interface MockFeatureNode {
  feature: { id: string; name: string; sections?: MockSection[] };
  children: MockFeatureNode[];
}

interface MockInlineAction {
  action: "discuss" | "create_task" | "create_bug";
  label: string;
  onSelect?: () => void;
  testId?: string;
}

const useFeatureTreeMock = vi.fn();
const hydrateContentMock = vi.fn();
const loadingContentIds = new Set<string>();
const createDocumentWorkItemMock = vi.fn();
const useWorkItemTypeByKeyMock = vi.fn(
  (_organizationId: string, _projectId: string, typeKey?: string) => ({
    workItemTypeDefinition: typeKey
      ? {
          key: typeKey,
          name: typeKey === "BUG" ? "Bug" : "Task",
          sections:
            typeKey === "FEATURE"
              ? [
                  {
                    key: "requirements",
                    label: "Requirements",
                    kind: "json",
                    schemaRef:
                      "#/components/schemas/FeatureRequirementsSection",
                  },
                ]
              : [
                  { key: "description", label: "Description" },
                  { key: "acceptanceCriteria", label: "Acceptance Criteria" },
                ],
          allowedStatuses: ["BACKLOG"],
        }
      : undefined,
    isFetched: Boolean(typeKey),
  }),
);

vi.mock("@hey-hey/ui-common/data", () => ({
  useFeatureHierarchy: (...args: unknown[]) => {
    const tree = useFeatureTreeMock(...args);
    const contains = (node: MockFeatureNode, id: string): boolean =>
      node.feature.id === id ||
      node.children.some((child) => contains(child, id));
    return {
      ...tree,
      resolveRoot: (id: string) =>
        tree.roots.find((root: MockFeatureNode) => contains(root, id)) ?? null,
    };
  },
  useFeatureDocumentContent: (
    _org: string,
    _project: string,
    ids: string[],
    root: unknown,
  ) => {
    hydrateContentMock(ids, root);
    const entries = new Map();
    const walk = (node: MockFeatureNode) => {
      entries.set(node.feature.id, {
        status: loadingContentIds.has(node.feature.id) ? "loading" : "ready",
        data: loadingContentIds.has(node.feature.id) ? undefined : node.feature,
      });
      node.children.forEach(walk);
    };
    useFeatureTreeMock().roots.forEach(walk);
    return { entries, retry: vi.fn() };
  },
  useWorkItems: () => ({ createTask: createDocumentWorkItemMock }),
  useWorkItemTypeByKey: (...args: unknown[]) =>
    useWorkItemTypeByKeyMock(...args),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  InteractionComponent: ({
    children,
    inlineActions,
  }: {
    children: React.ReactNode;
    inlineActions?: MockInlineAction[];
  }) => (
    <>
      {children}
      {inlineActions?.map((action) => (
        <button
          key={action.action}
          data-testid={action.testId}
          onClick={action.onSelect}
        >
          {action.label}
        </button>
      ))}
    </>
  ),
  MarkdownRenderer: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="markdown-renderer">{children}</div>
  ),
  StructuredRequirementsView: ({
    requirements,
  }: {
    requirements: Array<{ id: string; statement: string }>;
  }) => (
    <div data-testid="structured-requirements">
      {requirements.map((requirement) => (
        <div key={requirement.id}>{requirement.statement}</div>
      ))}
    </div>
  ),
}));

const canonicalRequirement = (statement: string, id: string) =>
  JSON.stringify({
    records: [
      {
        id,
        statement,
        designedBy: [],
        fulfilledBy: [],
        contracts: [],
      },
    ],
  });

vi.mock("../../components/Tasks", () => ({
  NewTaskModal: ({
    open,
    onClose,
    onSubmit,
    sectionSelection,
  }: {
    open: boolean;
    onClose: () => void;
    onSubmit: (formData: {
      name: string;
      initiativeId: string;
      sectionContent?: Record<string, string>;
    }) => void;
    sectionSelection?: { status: string };
  }) =>
    open ? (
      <div
        data-testid="new-work-item-modal"
        data-section-status={sectionSelection?.status ?? "missing"}
      >
        <button
          type="button"
          data-testid="new-work-item-submit"
          onClick={() =>
            onSubmit({
              name: "Created from document",
              initiativeId: "",
              sectionContent: {
                description: "Created description",
              },
            })
          }
        >
          Create
        </button>
        <button type="button" onClick={onClose}>
          Cancel
        </button>
      </div>
    ) : null,
}));

import { FeaturesDocumentView } from "./FeaturesDocumentView";

const descriptionSection = (content: string): MockSection => ({
  key: "description",
  materializedMarkdown: content,
  order: 0,
  id: "sec-description",
  crdtSnapshotSeq: null,
});

const requirementsSection = (content: string): MockSection => ({
  key: "requirements",
  materializedMarkdown: content,
  order: 1,
  id: "sec-requirements",
  crdtSnapshotSeq: null,
});

const leaf = (
  id: string,
  name: string,
  requirements?: string,
): MockFeatureNode => ({
  feature: {
    id,
    name,
    sections: [
      descriptionSection(`${name} description body`),
      ...(requirements ? [requirementsSection(requirements)] : []),
    ],
  },
  children: [],
});

const makeRoots = (): MockFeatureNode[] => [
  {
    feature: {
      id: "f-alpha",
      name: "Alpha",
      sections: [
        descriptionSection("Alpha description body"),
        requirementsSection(
          canonicalRequirement(
            "Alpha requirements body",
            "55555555-5555-4555-8555-555555555555",
          ),
        ),
      ],
    },
    children: [
      leaf(
        "f-alpha-1",
        "Alpha One",
        canonicalRequirement(
          "Alpha One requirements body",
          "66666666-6666-4666-8666-666666666666",
        ),
      ),
      leaf("f-alpha-2", "Alpha Two"),
    ],
  },
  leaf("f-beta", "Beta"),
  leaf("f-gamma", "Gamma"),
];

const renderView = (
  props: Partial<React.ComponentProps<typeof FeaturesDocumentView>> = {},
): ReturnType<typeof render> =>
  render(
    <MemoryRouter>
      <FeaturesDocumentView
        organizationId="org-1"
        projectId="project-1"
        {...props}
      />
    </MemoryRouter>,
  );

describe("FeaturesDocumentView", () => {
  beforeEach(() => {
    visualRenders.mockClear();
    setDesktopViewport(false);
    queryState.feature = null;
    queryState.section = null;
    setQueryMock.mockClear();
    hydrateContentMock.mockClear();
    loadingContentIds.clear();
    useFeatureTreeMock.mockReset();
    createDocumentWorkItemMock.mockReset();
    createDocumentWorkItemMock.mockResolvedValue({ id: "created-item" });
    useWorkItemTypeByKeyMock.mockClear();
    useFeatureTreeMock.mockReturnValue({
      roots: makeRoots(),
      isLoading: false,
    });
    Element.prototype.scrollIntoView = vi.fn();
    Element.prototype.getBoundingClientRect = vi.fn(() => ({
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      width: 0,
      height: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  const installSectionGeometry = (extraOffset = () => 0) => {
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const panel = document.querySelector(
          '[data-testid="features-wiki-document-panel"]',
        ) as HTMLElement | null;
        const sections = Array.from(
          panel?.querySelectorAll("[data-feature-id]") ?? [],
        );
        const index = sections.indexOf(this);
        const top =
          index < 0
            ? 100
            : 100 + 60 + index * 300 + extraOffset() - (panel?.scrollTop ?? 0);
        return {
          top,
          bottom: top + 300,
          height: 300,
          left: 0,
          right: 500,
          width: 500,
          x: 0,
          y: top,
          toJSON: () => ({}),
        };
      },
    );
  };

  it("activates and positions the sixth nested item on its first TOC click", async () => {
    setDesktopViewport(true);
    const children = Array.from({ length: 10 }, (_, index) =>
      leaf(`child-${index}`, `Child ${index}`),
    );
    useFeatureTreeMock.mockReturnValue({
      roots: [{ ...makeRoots()[0], children }],
      isLoading: false,
    });
    installSectionGeometry();
    renderView();
    await userEvent.click(
      screen.getByTestId("features-wiki-toc-toggle-f-alpha"),
    );
    expect(screen.queryByTestId("feature-document-section-child-5")).toBeNull();
    await userEvent.click(
      screen.getByTestId("features-wiki-toc-entry-child-5"),
    );

    const panel = screen.getByTestId("features-wiki-document-panel");
    const target = screen.getByTestId("feature-document-section-child-5");
    expect(
      visualRenders.mock.calls
        .filter(([id]) => id === "child-5")
        .map(([, suspended]) => suspended),
    ).toEqual([true, false]);
    expect(
      screen.getByTestId("features-wiki-toc-entry-child-5"),
    ).toHaveAttribute("data-active", "true");
    expect(panel.scrollTop).toBe(1544);
    expect(
      target.getBoundingClientRect().top - panel.getBoundingClientRect().top,
    ).toBe(16);
    expect(target).toHaveAttribute("data-active", "true");
    expect(
      screen.getByTestId("feature-document-heading-child-5"),
    ).toHaveAttribute("aria-current", "location");
    expect(setQueryMock).toHaveBeenCalledWith("section", "child-5");

    // Passive scrolling cannot replace an explicit selection; clicking it again
    // returns to that section even though its URL is already selected.
    panel.scrollTop = 100;
    fireEvent.scroll(panel);
    expect(target).toHaveAttribute("data-active", "true");
    await userEvent.click(
      screen.getByTestId("features-wiki-toc-entry-child-5"),
    );
    expect(panel.scrollTop).toBe(1544);
  });

  it("positions a deep link after its content mounts and restores external URL selections", () => {
    queryState.section = "f-alpha-2";
    loadingContentIds.add("f-alpha-2");
    installSectionGeometry();
    const view = renderView();
    expect(
      screen.queryByTestId("feature-document-section-f-alpha-2"),
    ).toBeNull();
    loadingContentIds.clear();
    view.rerender(
      <MemoryRouter>
        <FeaturesDocumentView organizationId="org-1" projectId="project-1" />
      </MemoryRouter>,
    );
    const panel = screen.getByTestId("features-wiki-document-panel");
    expect(panel.scrollTop).toBe(344);
    act(() => querySetters.section("f-alpha-1"));
    expect(panel.scrollTop).toBe(44);
    act(() => querySetters.section("f-alpha-2"));
    expect(panel.scrollTop).toBe(344);
    expect(
      screen.getByTestId("feature-document-section-f-alpha-2"),
    ).toHaveAttribute("data-active", "true");
  });

  it("keeps the target positioned through reflow until the user scrolls", () => {
    let onResize = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal(
      "ResizeObserver",
      class {
        constructor(callback: () => void) {
          onResize = callback;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    queryState.section = "f-alpha-2";
    let extraOffset = 0;
    installSectionGeometry(() => extraOffset);
    renderView();
    const panel = screen.getByTestId("features-wiki-document-panel");
    expect(panel.scrollTop).toBe(344);
    extraOffset = 200;
    act(() => onResize());
    expect(panel.scrollTop).toBe(544);
    expect(
      screen.getByTestId("feature-document-section-f-alpha-2"),
    ).toHaveAttribute("data-active", "true");
    fireEvent.wheel(panel);
    expect(disconnect).toHaveBeenCalled();
  });

  it("renders one TOC entry per root feature", () => {
    renderView();
    expect(
      screen.getByTestId("features-wiki-toc-entry-f-alpha"),
    ).toHaveTextContent("Alpha");
    expect(
      screen.getByTestId("features-wiki-toc-entry-f-beta"),
    ).toHaveTextContent("Beta");
    expect(
      screen.getByTestId("features-wiki-toc-entry-f-gamma"),
    ).toHaveTextContent("Gamma");
  });

  it("renders icon actions for root and nested sections on desktop", () => {
    setDesktopViewport(true);
    queryState.feature = "f-alpha";

    renderView();

    expect(
      screen.getByTestId("feature-document-discuss-f-alpha"),
    ).toHaveTextContent("Discuss");
    expect(
      screen.getByTestId("feature-document-add-task-f-alpha"),
    ).toHaveTextContent("Add Task");
    expect(
      screen.getByTestId("feature-document-add-bug-f-alpha"),
    ).toHaveTextContent("Add Bug");
    expect(
      screen.getByTestId("feature-document-discuss-f-alpha-1"),
    ).toHaveTextContent("Discuss");
    expect(
      screen.getByTestId("feature-document-add-task-f-alpha-1"),
    ).toHaveTextContent("Add Task");
    expect(
      screen.getByTestId("feature-document-add-bug-f-alpha-1"),
    ).toHaveTextContent("Add Bug");
  });

  it("shows requirements inline between the description and section actions", () => {
    setDesktopViewport(true);
    queryState.feature = "f-alpha";

    renderView();

    const description = screen.getByTestId(
      "feature-document-description-f-alpha",
    );
    const requirements = screen.getByTestId(
      "feature-document-requirements-content-f-alpha",
    );
    const addTask = screen.getByTestId("feature-document-add-task-f-alpha");

    expect(
      description.compareDocumentPosition(requirements) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      requirements.compareDocumentPosition(addTask) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(requirements).toHaveTextContent("Alpha requirements body");
  });

  it("keeps document actions hidden on mobile", () => {
    queryState.feature = "f-alpha";

    renderView({ mobileTocVisible: false });

    expect(
      screen.queryByTestId("feature-document-discuss-f-alpha"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("feature-document-add-task-f-alpha-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("feature-document-add-bug-f-alpha"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("feature-document-requirements-content-f-alpha"),
    ).toBeInTheDocument();
  });

  it("starts table-of-contents sections collapsed, hiding sub-feature entries", () => {
    renderView();
    expect(
      screen.queryByTestId("features-wiki-toc-entry-f-alpha-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("features-wiki-toc-entry-f-alpha-2"),
    ).not.toBeInTheDocument();
    // Roots with sub-features carry an expand toggle, collapsed by default;
    // leaf roots have no toggle at all.
    expect(
      screen.getByTestId("features-wiki-toc-toggle-f-alpha"),
    ).toHaveAttribute("aria-expanded", "false");
    expect(
      screen.queryByTestId("features-wiki-toc-toggle-f-beta"),
    ).not.toBeInTheDocument();
  });

  it("reveals a root's sub-feature entries when its toggle is clicked", async () => {
    renderView();

    await userEvent.click(
      screen.getByTestId("features-wiki-toc-toggle-f-alpha"),
    );

    expect(
      screen.getByTestId("features-wiki-toc-entry-f-alpha-1"),
    ).toHaveTextContent("Alpha One");
    expect(
      screen.getByTestId("features-wiki-toc-entry-f-alpha-2"),
    ).toHaveTextContent("Alpha Two");
    expect(
      screen.getByTestId("features-wiki-toc-toggle-f-alpha"),
    ).toHaveAttribute("aria-expanded", "true");
  });

  it("routes keyboard mobile TOC activation through the page selection callback", async () => {
    const onMobileFeatureSelect = vi.fn();
    renderView({
      isMobileSearchActive: true,
      onMobileFeatureSelect,
    });

    const entry = screen.getByTestId("features-wiki-toc-entry-f-beta");
    entry.focus();
    await userEvent.keyboard("{Enter}");

    expect(onMobileFeatureSelect).toHaveBeenCalledWith("f-beta", "f-beta");
  });

  it("applies the searchQuery filter to TOC entries", () => {
    renderView({ searchQuery: "bet" });
    expect(
      screen.queryByTestId("features-wiki-toc-entry-f-alpha"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("features-wiki-toc-entry-f-beta"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("features-wiki-toc-entry-f-gamma"),
    ).not.toBeInTheDocument();
  });

  it("renders a loading spinner while the feature tree is loading", () => {
    useFeatureTreeMock.mockReturnValue({ roots: [], isLoading: true });
    renderView();
    expect(
      screen.queryByTestId("features-wiki-toc-entry-f-alpha"),
    ).not.toBeInTheDocument();
    expect(setQueryMock).not.toHaveBeenCalled();
  });

  it("keeps the document panel as the bounded vertical scroll owner", () => {
    queryState.feature = "f-alpha";
    renderView();

    const view = screen.getByTestId("features-wiki-view");
    const documentPanel = screen.getByTestId("features-wiki-document-panel");
    const tocScroll = screen.getByTestId("features-wiki-toc-scroll");

    const viewStyle = getComputedStyle(view);
    expect(viewStyle.minHeight).toBe("0");
    expect(viewStyle.minWidth).toBe("0");
    expect(viewStyle.overflow).toBe("hidden");

    const documentPanelStyle = getComputedStyle(documentPanel);
    expect(documentPanelStyle.flexDirection).toBe("column");
    expect(documentPanelStyle.minHeight).toBe("0");
    expect(documentPanelStyle.minWidth).toBe("0");
    expect(documentPanelStyle.maxWidth).toBe("100%");
    expect(documentPanelStyle.overflowX).toBe("hidden");
    expect(documentPanelStyle.overflowY).toBe("auto");
    expect(documentPanelStyle.overscrollBehaviorY).toBe("contain");

    const tocScrollStyle = getComputedStyle(tocScroll);
    expect(tocScrollStyle.minHeight).toBe("0");
    expect(tocScrollStyle.overflowY).toBe("auto");
    expect(viewStyle.overflowY).not.toBe("auto");
  });

  it("shows only top-level sections when nothing is selected", () => {
    renderView();

    for (const id of ["f-alpha", "f-beta", "f-gamma"]) {
      expect(
        screen.getByTestId(`feature-document-section-${id}`),
      ).toBeInTheDocument();
    }
    expect(
      screen.queryByTestId("feature-document-section-f-alpha-1"),
    ).toBeNull();
    expect(screen.queryByTestId("features-wiki-breadcrumbs")).toBeNull();
  });

  it("shows a selected feature among its siblings with only its children beneath it", () => {
    queryState.section = "f-alpha";
    useFeatureTreeMock.mockReturnValue({
      roots: [
        {
          ...makeRoots()[0],
          children: [
            {
              ...leaf("f-alpha-1", "Alpha One"),
              children: [leaf("f-alpha-1-a", "Alpha One A")],
            },
            leaf("f-alpha-2", "Alpha Two"),
          ],
        },
        leaf("f-beta", "Beta"),
      ],
      isLoading: false,
    });
    renderView();

    const ids = Array.from(document.querySelectorAll("[data-feature-id]")).map(
      (element) => element.getAttribute("data-feature-id"),
    );
    expect(ids).toEqual(["f-alpha", "f-alpha-1", "f-alpha-2", "f-beta"]);
    expect(
      screen.queryByTestId("feature-document-section-f-alpha-1-a"),
    ).toBeNull();
    expect(
      screen.getByTestId("features-wiki-breadcrumb-f-alpha"),
    ).toHaveTextContent("Alpha");
    // The open section's children are already shown.
    expect(
      screen.queryByTestId("feature-document-show-sub-features-f-alpha"),
    ).toBeNull();
    // A child's own children stay one step away.
    expect(
      screen.getByTestId("feature-document-show-sub-features-f-alpha-1"),
    ).toBeInTheDocument();
  });

  it("shows the parent's children as the level for a nested selection", () => {
    queryState.section = "f-alpha-2";
    renderView();

    const ids = Array.from(document.querySelectorAll("[data-feature-id]")).map(
      (element) => element.getAttribute("data-feature-id"),
    );
    expect(ids).toEqual(["f-alpha-1", "f-alpha-2"]);
    expect(
      screen.getByTestId("features-wiki-breadcrumb-f-alpha"),
    ).toHaveAttribute("href", "?section=f-alpha");
    expect(
      screen.getByTestId("features-wiki-breadcrumb-f-alpha-2"),
    ).not.toHaveAttribute("href");
  });

  it("opens another branch by selecting it from its Show sub-features control", async () => {
    queryState.section = "f-alpha";
    useFeatureTreeMock.mockReturnValue({
      roots: [
        makeRoots()[0],
        { ...leaf("f-beta", "Beta"), children: [leaf("f-beta-1", "Beta One")] },
      ],
      isLoading: false,
    });
    renderView();

    await userEvent.click(
      screen.getByTestId("feature-document-show-sub-features-f-beta"),
    );

    expect(setQueryMock).toHaveBeenCalledWith("section", "f-beta");
    expect(setQueryMock).toHaveBeenCalledWith("feature", null);
  });

  it("selects an ancestor from its breadcrumb and clears selection from the root crumb", async () => {
    queryState.section = "f-alpha-1";
    renderView();

    await userEvent.click(
      screen.getByTestId("features-wiki-breadcrumb-f-alpha"),
    );
    expect(setQueryMock).toHaveBeenCalledWith("section", "f-alpha");

    await userEvent.click(screen.getByTestId("features-wiki-breadcrumb-root"));
    expect(setQueryMock).toHaveBeenCalledWith("section", null);
  });

  it.each([null, "missing-feature"])(
    "falls back to the top level for section value %s",
    (sectionId) => {
      queryState.section = sectionId;
      renderView();

      expect(
        screen.getByTestId("feature-document-section-f-alpha"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("feature-document-section-f-gamma"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("features-wiki-breadcrumbs")).toBeNull();
    },
  );

  it("honors a root-only feature query from an older link", () => {
    queryState.feature = "f-alpha";
    renderView();

    expect(
      screen.getByTestId("feature-document-section-f-alpha-1"),
    ).toBeInTheDocument();
  });

  it.each([
    ["feature-document-add-task-f-alpha-1", "STANDARD"],
    ["feature-document-add-bug-f-alpha-1", "BUG"],
  ])(
    "opens the work-item form for the represented feature when %s is clicked",
    async (testId, type) => {
      setDesktopViewport(true);
      queryState.section = "f-alpha";
      renderView();

      await userEvent.click(screen.getByTestId(testId));
      await userEvent.click(screen.getByTestId("new-work-item-submit"));

      await waitFor(() =>
        expect(createDocumentWorkItemMock).toHaveBeenCalledWith(
          expect.objectContaining({ parentTaskId: "f-alpha-1", type }),
        ),
      );
    },
  );
});
