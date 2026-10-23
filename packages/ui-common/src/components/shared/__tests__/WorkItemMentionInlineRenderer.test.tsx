import React from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TaskSource, WorkStatus, type TaskResponseDto } from "../../../api";
import { ProjectContext } from "../../../contexts";
import { ConversationScrollPolicyContext } from "../../Conversation/hooks/useConversationScrolling";
import { EagerIntersectionObserver } from "../../../test/eagerIntersectionObserver";
import {
  WorkItemMentionInlineRenderer,
  isWorkItemMention,
} from "../WorkItemMentionInlineRenderer";
import {
  MentionExpansionProvider,
  type MentionPresentation,
} from "../MentionExpansionContext";
import { PreviewHostProvider } from "../../../contexts/PreviewHostContext";
import { WorkflowMentionInlineRenderer } from "../WorkflowMentionInlineRenderer";

const hooks = vi.hoisted(() => ({
  useWorkItem: vi.fn(),
  useWorkItemTypeByKey: vi.fn(),
}));

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: hooks.useWorkItem,
}));

vi.mock("../../../data/hooks/useWorkItemTypes", async (importOriginal) => {
  const { resolveMentionWorkItemTypeAlias } =
    await import("../../../utils/mentionWorkItemType");
  return {
    ...(await importOriginal<
      typeof import("../../../data/hooks/useWorkItemTypes")
    >()),
    useWorkItemTypeByKey: hooks.useWorkItemTypeByKey,
    // The fixture registry holds every custom kind mentioned here; the
    // generic `task` kind names no registered type.
    useMentionWorkItemTypeKey: (
      _organizationId: string | undefined,
      _projectId: string | undefined,
      kind: string | undefined,
    ) => ({
      typeKey:
        kind && kind !== "task"
          ? (resolveMentionWorkItemTypeAlias(kind) ?? kind)
          : undefined,
      isResolved: kind !== undefined,
    }),
  };
});

const task: TaskResponseDto = {
  id: "task-1",
  name: "Review layouts",
  type: "mockups_v3",
  organizationId: "org-1",
  projectId: "project-1",
  status: WorkStatus.Active,
  source: TaskSource.System,
  sections: [
    {
      id: "description-section",
      key: "description",
      order: 0,
      materializedMarkdown: "Description text",
      crdtSnapshotSeq: null,
    },
    {
      id: "desktop-section",
      key: "desktop",
      order: 1,
      materializedMarkdown: "invalid structured payload",
      crdtSnapshotSeq: null,
    },
    {
      id: "mobile-section",
      key: "mobile",
      order: 2,
      materializedMarkdown: JSON.stringify({
        html: "<main>Mobile</main>",
        css: "",
      }),
      crdtSnapshotSeq: null,
    },
  ],
};

const readyWorkItem = () => ({
  workItem: task,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn(),
  markStale: vi.fn(),
});

const readyType = () => ({
  workItemTypeSummary: undefined,
  workItemTypeDefinition: {
    key: "mockups_v3",
    name: "Mockups V3",
    capabilities: { rendersInline: true },
    allowedStatuses: [],
    sections: [
      { key: "description", label: "Description" },
      { key: "desktop", label: "Desktop", kind: "structured-mockup" as const },
      { key: "mobile", label: "Mobile", kind: "html/css" as const },
    ],
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

const mention = {
  entityType: "mockups_v3",
  entityId: task.id,
  entityName: task.name,
};

class DeferredIntersectionObserver {
  static instances: DeferredIntersectionObserver[] = [];

  readonly options: IntersectionObserverInit | undefined;
  private readonly callback: IntersectionObserverCallback;
  private target: Element | null = null;
  disconnected = false;

  constructor(
    callback: IntersectionObserverCallback,
    options?: IntersectionObserverInit,
  ) {
    this.callback = callback;
    this.options = options;
    DeferredIntersectionObserver.instances.push(this);
  }

  observe(target: Element): void {
    this.target = target;
  }

  trigger(isIntersecting: boolean): void {
    if (!this.target || this.disconnected) return;
    this.callback(
      [{ target: this.target, isIntersecting } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }

  disconnect(): void {
    this.disconnected = true;
  }

  unobserve(): void {}
}

const wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <MemoryRouter>
    <ThemeProvider theme={createTheme()}>
      <ProjectContext.Provider
        value={{
          organizationId: "org-1",
          projectId: "project-1",
          navigate: vi.fn(),
        }}
      >
        {children}
      </ProjectContext.Provider>
    </ThemeProvider>
  </MemoryRouter>
);

describe("WorkItemMentionInlineRenderer", () => {
  beforeEach(() => {
    hooks.useWorkItem.mockReturnValue(readyWorkItem());
    hooks.useWorkItemTypeByKey.mockReturnValue(readyType());
    vi.stubGlobal("IntersectionObserver", EagerIntersectionObserver);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recognizes registry-backed work-item mentions without a type allowlist", () => {
    expect(isWorkItemMention(mention)).toBe(true);
    expect(
      isWorkItemMention({
        entityType: "service",
        entityId: "s1",
        entityName: "API",
      }),
    ).toBe(false);
  });

  it("keeps work-item mentions as badges when the registry does not enable inline rendering", () => {
    const featureMention = {
      entityType: "feature",
      entityId: "feature-1",
      entityName: "Roadmap",
    };

    hooks.useWorkItem.mockReturnValue({
      ...readyWorkItem(),
      workItem: {
        ...task,
        id: "feature-1",
        name: "Roadmap",
        type: "FEATURE",
      },
    });
    hooks.useWorkItemTypeByKey.mockReturnValue({
      ...readyType(),
      workItemTypeDefinition: {
        ...readyType().workItemTypeDefinition,
        key: "FEATURE",
        name: "Feature",
        capabilities: { rendersInline: false },
      },
    });

    render(<WorkItemMentionInlineRenderer mention={featureMention} />, {
      wrapper,
    });

    expect(screen.getByTestId("mention-badge")).toHaveAttribute(
      "data-mention-token",
      "@[feature:feature-1|Roadmap]",
    );
    expect(
      screen.queryByTestId("work-item-inline-mention"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("work-item-section")).not.toBeInTheDocument();
  });

  it("keeps known non-inline mentions as badges while the work item is loading", () => {
    const featureMention = {
      entityType: "feature",
      entityId: "feature-1",
      entityName: "Roadmap",
    };

    hooks.useWorkItem.mockReturnValue({
      ...readyWorkItem(),
      workItem: null,
      isFetched: false,
    });
    hooks.useWorkItemTypeByKey.mockReturnValue({
      ...readyType(),
      workItemTypeDefinition: {
        ...readyType().workItemTypeDefinition,
        key: "FEATURE",
        name: "Feature",
        capabilities: { rendersInline: false },
      },
    });

    render(<WorkItemMentionInlineRenderer mention={featureMention} />, {
      wrapper,
    });

    expect(hooks.useWorkItemTypeByKey).toHaveBeenLastCalledWith(
      "org-1",
      "project-1",
      "FEATURE",
    );
    expect(screen.getByTestId("mention-badge")).toBeInTheDocument();
    expect(
      screen.queryByTestId("work-item-inline-mention-loading"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("work-item-inline-mention"),
    ).not.toBeInTheDocument();
  });

  it("renders the first visual and switches between registry labels in order", async () => {
    const user = userEvent.setup();
    render(<WorkItemMentionInlineRenderer mention={mention} />, { wrapper });

    const switcher = screen.getByTestId("work-item-inline-section-switcher");
    const renderedSection = screen.getByTestId("work-item-section");
    const visualTitle = within(renderedSection).getByText("Review layouts");
    expect(visualTitle.parentElement).toContainElement(switcher);
    const visualTitleLink = screen.getByRole("link", {
      name: "Review layouts",
    });
    expect(visualTitleLink).toHaveAttribute(
      "href",
      "/projects/project-1/tasks/task-1",
    );
    expect(visualTitleLink).not.toContainElement(switcher);
    visualTitleLink.focus();
    expect(document.activeElement).toBe(visualTitleLink);
    const buttons = Array.from(switcher.querySelectorAll("button"));
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Desktop",
      "Mobile",
    ]);
    expect(screen.getByTestId("work-item-section")).toHaveAttribute(
      "data-section-key",
      "desktop",
    );
    expect(screen.getByRole("button", { name: "Desktop" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByText("Description text")).not.toBeInTheDocument();
    expect(screen.getAllByText("Review layouts")).toHaveLength(2);
    expect(
      screen.queryByText("Review layouts — Mobile"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mobile" }));

    expect(screen.getByTestId("work-item-section")).toHaveAttribute(
      "data-section-key",
      "mobile",
    );
    expect(screen.getByRole("button", { name: "Mobile" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByText("Review layouts — Desktop"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("mention-badge")).toHaveAttribute(
      "data-mention-token",
      "@[mockups_v3:task-1|Review layouts]",
    );
    expect(
      screen.queryByRole("button", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  it("passes inline context to the shared structured mockup renderer", () => {
    hooks.useWorkItem.mockReturnValue({
      ...readyWorkItem(),
      workItem: {
        ...task,
        sections: [
          {
            ...task.sections[0],
            key: "desktop",
            materializedMarkdown: JSON.stringify({
              schemaVersion: "work-item-structured-mockup.v1",
              content: [],
            }),
          },
        ],
      },
    });
    hooks.useWorkItemTypeByKey.mockReturnValue({
      ...readyType(),
      workItemTypeDefinition: {
        ...readyType().workItemTypeDefinition,
        sections: [
          {
            key: "desktop",
            label: "Desktop",
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
          },
        ],
      },
    });

    render(<WorkItemMentionInlineRenderer mention={mention} />, { wrapper });

    expect(
      screen.getByTestId("structured-mockup-section-renderer"),
    ).toHaveAttribute("data-rendering-context", "inline");
  });

  it("renders only the badge when the registry declares no visuals", () => {
    hooks.useWorkItemTypeByKey.mockReturnValue({
      ...readyType(),
      workItemTypeDefinition: {
        key: "mockups_v3",
        name: "Mockups V3",
        capabilities: { rendersInline: true },
        allowedStatuses: [],
        sections: [{ key: "description", label: "Description" }],
      },
    });

    render(<WorkItemMentionInlineRenderer mention={mention} />, { wrapper });
    expect(
      screen.queryByTestId("work-item-inline-section-switcher"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Description text")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("work-item-inline-mention"),
    ).not.toBeInTheDocument();
  });

  it("never reads a generic task token to learn its type", () => {
    hooks.useWorkItem.mockClear();
    render(
      <WorkItemMentionInlineRenderer
        mention={{ entityType: "task", entityId: "t-9", entityName: "Plain" }}
      />,
      { wrapper },
    );
    expect(screen.getByTestId("mention-badge")).toBeInTheDocument();
    expect(
      hooks.useWorkItem.mock.calls.some((call) => call[3]?.enabled === true),
    ).toBe(false);
  });

  describe("Diagram resolved through its token type", () => {
    const inlineWrapper: React.FC<{ children: React.ReactNode }> = ({
      children,
    }) =>
      wrapper({
        children: (
          <MentionExpansionProvider presentation="inline">
            {children}
          </MentionExpansionProvider>
        ),
      });
    const diagramMention = {
      entityType: "DIAGRAM",
      entityId: "diagram-1",
      entityName: "Checkout flow",
    };
    const diagramWorkItem = () => ({
      ...readyWorkItem(),
      workItem: {
        ...task,
        id: "diagram-1",
        name: "Checkout flow",
        type: "DIAGRAM",
        sections: [
          {
            id: "d-description",
            key: "description",
            order: 0,
            materializedMarkdown: "Diagram prose",
            crdtSnapshotSeq: null,
          },
          {
            id: "d-meta",
            key: "diagramMetadata",
            order: 1,
            materializedMarkdown: '{"kind":"PROCESS","level":"OVERVIEW"}',
            crdtSnapshotSeq: null,
          },
        ],
      },
    });
    const diagramType = () => ({
      ...readyType(),
      workItemTypeDefinition: {
        key: "DIAGRAM",
        name: "Diagram",
        capabilities: { rendersInline: true },
        allowedStatuses: [],
        sections: [
          { key: "description", label: "Description" },
          { key: "graphLayout", label: "Graph Layout" },
          { key: "graphLayoutPreference", label: "Graph Layout Preference" },
          { key: "diagramMetadata", label: "Diagram metadata" },
        ],
      },
    });

    it("hands off to the shared Diagram surface without section labels", () => {
      hooks.useWorkItem.mockReturnValue(diagramWorkItem());
      hooks.useWorkItemTypeByKey.mockReturnValue(diagramType());
      const renderDiagram = vi.fn((m: { entityType: string }) => (
        <div data-testid="diagram-surface">{m.entityType}</div>
      ));

      render(
        <WorkItemMentionInlineRenderer
          mention={diagramMention}
          renderDiagram={renderDiagram}
        />,
        { wrapper: inlineWrapper },
      );

      expect(screen.getByTestId("diagram-surface")).toHaveTextContent(
        "diagram",
      );
      for (const label of [
        "Description",
        "Graph Layout",
        "Graph Layout Preference",
        "Diagram metadata",
        "Diagram prose",
      ]) {
        expect(screen.queryByText(label)).not.toBeInTheDocument();
      }
    });

    it("shows only the badge while the type is pending", () => {
      hooks.useWorkItem.mockReturnValue(diagramWorkItem());
      hooks.useWorkItemTypeByKey.mockReturnValue({
        ...diagramType(),
        workItemTypeDefinition: undefined,
        isFetched: false,
        isReady: false,
        isLoading: true,
      });
      const renderDiagram = vi.fn(() => <div data-testid="diagram-surface" />);

      render(
        <WorkItemMentionInlineRenderer
          mention={diagramMention}
          renderDiagram={renderDiagram}
        />,
        { wrapper: inlineWrapper },
      );

      expect(renderDiagram).not.toHaveBeenCalled();
      expect(screen.queryByText("Diagram prose")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("work-item-inline-mention"),
      ).not.toBeInTheDocument();
    });
  });

  it("does not expand mentions inside non-visual sections", () => {
    hooks.useWorkItem.mockReturnValue({
      ...readyWorkItem(),
      workItem: {
        ...task,
        sections: [
          {
            ...task.sections[0],
            materializedMarkdown:
              "See @[mockups_v3:task-1|Review layouts] for context.",
          },
        ],
      },
    });
    hooks.useWorkItemTypeByKey.mockReturnValue({
      ...readyType(),
      workItemTypeDefinition: {
        key: "mockups_v3",
        name: "Mockups V3",
        capabilities: { rendersInline: true },
        allowedStatuses: [],
        sections: [{ key: "description", label: "Description" }],
      },
    });

    render(<WorkItemMentionInlineRenderer mention={mention} />, { wrapper });

    expect(
      screen.queryByTestId("work-item-inline-mention"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByTestId("mention-badge")).toHaveLength(1);
  });

  it("uses the work-item name as the title for a single visual section", () => {
    hooks.useWorkItemTypeByKey.mockReturnValue({
      ...readyType(),
      workItemTypeDefinition: {
        key: "mockups_v3",
        name: "Mockups V3",
        capabilities: { rendersInline: true },
        allowedStatuses: [],
        sections: [{ key: "mobile", label: "Mockup", kind: "html/css" }],
      },
    });

    render(<WorkItemMentionInlineRenderer mention={mention} />, { wrapper });

    expect(
      screen.queryByTestId("work-item-inline-section-switcher"),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Review layouts")).toHaveLength(2);
    expect(
      screen.queryByText("Mockup", { exact: true }),
    ).not.toBeInTheDocument();
  });

  it.each([
    [
      "inline work item loading",
      { isFetched: false },
      "work-item-inline-mention-loading",
    ],
    [
      "missing content",
      { workItem: { ...task, sections: undefined } },
      "work-item-inline-mention-unavailable",
    ],
  ])("shows an explicit %s state", (_label, override, testId) => {
    hooks.useWorkItem.mockReturnValue({ ...readyWorkItem(), ...override });
    render(<WorkItemMentionInlineRenderer mention={mention} />, { wrapper });
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  });

  it("falls back to the resolved badge when inline work-item loading fails", () => {
    hooks.useWorkItem.mockReturnValue({
      ...readyWorkItem(),
      error: new Error("failed"),
    });
    render(<WorkItemMentionInlineRenderer mention={mention} />, { wrapper });
    expect(screen.getByTestId("mention-badge")).toBeInTheDocument();
    expect(
      screen.queryByTestId("work-item-inline-mention-error"),
    ).not.toBeInTheDocument();
  });

  it.each([
    ["registry loading", { isFetched: false }, "mention-badge"],
    [
      "unresolved registry",
      { workItemTypeDefinition: undefined },
      "mention-badge",
    ],
  ])(
    "keeps the canonical mention path during %s",
    (_label, override, testId) => {
      hooks.useWorkItemTypeByKey.mockReturnValue({
        ...readyType(),
        ...override,
      });
      render(<WorkItemMentionInlineRenderer mention={mention} />, { wrapper });
      expect(screen.getByTestId(testId)).toBeInTheDocument();
      expect(
        screen.queryByTestId("work-item-inline-mention-loading"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("work-item-inline-mention-unavailable"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("work-item-inline-mention"),
      ).not.toBeInTheDocument();
    },
  );

  it("falls back to the resolved badge when registry loading fails", () => {
    hooks.useWorkItemTypeByKey.mockReturnValue({
      ...readyType(),
      error: new Error("failed"),
    });
    render(<WorkItemMentionInlineRenderer mention={mention} />, { wrapper });
    expect(screen.getByTestId("mention-badge")).toBeInTheDocument();
    expect(
      screen.queryByTestId("work-item-inline-mention-error"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("work-item-inline-mention-loading"),
    ).not.toBeInTheDocument();
  });

  it("does not expose rich loading when registry resolution fails first", () => {
    hooks.useWorkItem.mockReturnValue({
      ...readyWorkItem(),
      workItem: null,
      isFetched: false,
    });
    hooks.useWorkItemTypeByKey.mockReturnValue({
      ...readyType(),
      workItemTypeDefinition: undefined,
      error: new Error("failed"),
    });

    render(<WorkItemMentionInlineRenderer mention={mention} />, { wrapper });

    expect(screen.getByTestId("mention-badge")).toBeInTheDocument();
    expect(
      screen.queryByTestId("work-item-inline-mention-loading"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("work-item-inline-mention-unavailable"),
    ).not.toBeInTheDocument();
  });

  describe("viewport-deferred loading", () => {
    // The renderer reads before its nested MentionBadgeInner, which keeps its
    // own hover-card read; the latest renderer call is second-to-last.
    const lastWorkItemEnabled = () =>
      hooks.useWorkItem.mock.calls.at(-1)?.[3]?.enabled;

    beforeEach(() => {
      DeferredIntersectionObserver.instances = [];
      vi.stubGlobal("IntersectionObserver", DeferredIntersectionObserver);
      hooks.useWorkItem.mockClear();
      hooks.useWorkItem.mockReturnValue({
        ...readyWorkItem(),
        workItem: null,
        isFetched: false,
      });
    });

    it("keeps offscreen mockups as neutral placeholders without reading content", () => {
      render(<WorkItemMentionInlineRenderer mention={mention} />, { wrapper });

      expect(
        screen.getByTestId("work-item-inline-mention-deferred"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("mention-badge")).toBeInTheDocument();
      expect(
        screen.queryByTestId("work-item-inline-mention-loading"),
      ).not.toBeInTheDocument();
      expect(lastWorkItemEnabled()).toBe(false);
      expect(
        DeferredIntersectionObserver.instances[0]?.options?.rootMargin,
      ).toBe("1500px 0px");
    });

    it("loads on entry and latches through re-exit", () => {
      const { rerender } = render(
        <WorkItemMentionInlineRenderer mention={mention} />,
        { wrapper },
      );
      const observer = DeferredIntersectionObserver.instances[0];

      act(() => observer.trigger(true));
      expect(lastWorkItemEnabled()).toBe(true);
      expect(
        screen.getByTestId("work-item-inline-mention-loading"),
      ).toBeInTheDocument();

      hooks.useWorkItem.mockReturnValue(readyWorkItem());
      rerender(<WorkItemMentionInlineRenderer mention={mention} />);
      expect(screen.getByText("Desktop")).toBeInTheDocument();
      expect(observer.disconnected).toBe(true);

      act(() => observer.trigger(false));
      expect(lastWorkItemEnabled()).toBe(true);
      expect(
        screen.queryByTestId("work-item-inline-mention-deferred"),
      ).not.toBeInTheDocument();
      expect(DeferredIntersectionObserver.instances).toHaveLength(1);
    });

    it("preloads relative to the declared conversation owner and retains loaded content", () => {
      const ownerRef = React.createRef<HTMLElement>();
      const content = (
        <main ref={ownerRef}>
          <ConversationScrollPolicyContext.Provider
            value={{ mode: "owned", ownerRef }}
          >
            <WorkItemMentionInlineRenderer mention={mention} />
          </ConversationScrollPolicyContext.Provider>
        </main>
      );
      const { rerender } = render(content, { wrapper });
      const observer = DeferredIntersectionObserver.instances[0];
      expect(observer.options).toEqual({
        root: ownerRef.current,
        rootMargin: "1500px 0px",
      });
      expect(lastWorkItemEnabled()).toBe(false);

      act(() => observer.trigger(true));
      expect(lastWorkItemEnabled()).toBe(true);
      expect(
        screen.getByTestId("work-item-inline-mention-loading"),
      ).toBeInTheDocument();
      hooks.useWorkItem.mockReturnValue(readyWorkItem());
      rerender(
        <main ref={ownerRef}>
          <ConversationScrollPolicyContext.Provider
            value={{ mode: "owned", ownerRef }}
          >
            <WorkItemMentionInlineRenderer mention={mention} />
          </ConversationScrollPolicyContext.Provider>
        </main>,
      );
      expect(screen.getByText("Desktop")).toBeInTheDocument();
      act(() => observer.trigger(false));
      expect(lastWorkItemEnabled()).toBe(true);
      expect(observer.disconnected).toBe(true);
      expect(DeferredIntersectionObserver.instances).toHaveLength(1);
    });

    it("does not use an unrelated conversation owner as its visibility root", () => {
      const owner = document.createElement("main");
      render(
        <ConversationScrollPolicyContext.Provider
          value={{ mode: "owned", ownerRef: { current: owner } }}
        >
          <WorkItemMentionInlineRenderer mention={mention} />
        </ConversationScrollPolicyContext.Provider>,
        { wrapper },
      );
      expect(
        DeferredIntersectionObserver.instances[0].options?.root,
      ).toBeNull();
    });

    it.each([
      ["html/css", "mobile"],
      ["structured-mockup", "desktop"],
    ])("defers a sole %s section until entry", (_kind, sectionKey) => {
      const base = readyType();
      hooks.useWorkItemTypeByKey.mockReturnValue({
        ...base,
        workItemTypeDefinition: {
          ...base.workItemTypeDefinition,
          sections: base.workItemTypeDefinition.sections.filter(
            (section) =>
              section.key === "description" || section.key === sectionKey,
          ),
        },
      });
      render(<WorkItemMentionInlineRenderer mention={mention} />, { wrapper });
      expect(
        screen.getByTestId("work-item-inline-mention-deferred"),
      ).toBeInTheDocument();

      hooks.useWorkItem.mockReturnValue(readyWorkItem());
      act(() => DeferredIntersectionObserver.instances[0].trigger(true));
      expect(
        screen.queryByTestId("work-item-inline-mention-deferred"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("work-item-inline-mention-loading"),
      ).not.toBeInTheDocument();
    });

    it("loads eagerly when visibility observation is unavailable", () => {
      vi.stubGlobal("IntersectionObserver", undefined);
      render(<WorkItemMentionInlineRenderer mention={mention} />, { wrapper });
      expect(lastWorkItemEnabled()).toBe(true);
      expect(
        screen.queryByTestId("work-item-inline-mention-deferred"),
      ).not.toBeInTheDocument();
    });

    it("keeps ordinary non-inline mentions as immediate badges", () => {
      hooks.useWorkItemTypeByKey.mockReturnValue({
        ...readyType(),
        workItemTypeDefinition: {
          ...readyType().workItemTypeDefinition,
          capabilities: { rendersInline: false },
        },
      });
      render(<WorkItemMentionInlineRenderer mention={mention} />, { wrapper });
      expect(screen.getByTestId("mention-badge")).toBeInTheDocument();
      expect(
        screen.queryByTestId("work-item-inline-mention-deferred"),
      ).not.toBeInTheDocument();
      expect(DeferredIntersectionObserver.instances).toHaveLength(0);
    });
  });

  describe("badge-only hosts", () => {
    const badgeOnly: React.FC<{ children: React.ReactNode }> = ({ children }) =>
      wrapper({
        children: (
          <MentionExpansionProvider presentation="badge">
            {children}
          </MentionExpansionProvider>
        ),
      });

    it("renders a visual mention as a badge without the inline visual, switcher or reads", () => {
      hooks.useWorkItem.mockClear();
      render(<WorkItemMentionInlineRenderer mention={mention} />, {
        wrapper: badgeOnly,
      });

      const badge = screen.getByTestId("mention-badge");
      expect(badge).toHaveAttribute(
        "data-mention-token",
        "@[mockups_v3:task-1|Review layouts]",
      );
      expect(
        screen.queryByTestId("work-item-inline-mention"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("work-item-inline-section-switcher"),
      ).not.toBeInTheDocument();
      expect(hooks.useWorkItem).not.toHaveBeenCalled();
    });

    it("renders a Diagram mention as a badge without the graph surface", () => {
      render(
        <WorkflowMentionInlineRenderer
          mention={{
            entityType: "diagram",
            entityId: "diagram-1",
            entityName: "Checkout",
          }}
        />,
        { wrapper: badgeOnly },
      );

      expect(screen.getByTestId("mention-badge")).toBeInTheDocument();
      expect(
        screen.queryByTestId("workflow-inline-mention"),
      ).not.toBeInTheDocument();
    });

    it("still expands registry inline types the card cannot draw by default", () => {
      render(<WorkItemMentionInlineRenderer mention={mention} />, { wrapper });
      expect(
        screen.getByTestId("work-item-inline-mention"),
      ).toBeInTheDocument();
      expect(
        screen.getByTestId("work-item-inline-section-switcher"),
      ).toBeInTheDocument();
    });
  });

  describe("presentation modes for Mockups and Diagrams", () => {
    const openPreview = vi.fn();
    const mockupMention = {
      entityType: "mockup",
      entityId: "mockup-1",
      entityName: "Checkout mockup",
    };
    const diagramToken = {
      entityType: "diagram",
      entityId: "diagram-1",
      entityName: "Checkout flow",
    };
    const withPresentation =
      (
        presentation?: MentionPresentation,
      ): React.FC<{ children: React.ReactNode }> =>
      ({ children }) =>
        wrapper({
          children: (
            <PreviewHostProvider host={{ openPreview }}>
              {presentation ? (
                <MentionExpansionProvider presentation={presentation}>
                  {children}
                </MentionExpansionProvider>
              ) : (
                children
              )}
            </PreviewHostProvider>
          ),
        });
    const typeFor = (key: string) => ({
      ...readyType(),
      workItemTypeDefinition: {
        ...readyType().workItemTypeDefinition,
        key,
        sections: [
          { key: "screen", label: "Screen", kind: "html/css" as const },
        ],
      },
    });

    beforeEach(() => {
      openPreview.mockClear();
      hooks.useWorkItem.mockClear();
      DeferredIntersectionObserver.instances = [];
      vi.stubGlobal("IntersectionObserver", DeferredIntersectionObserver);
    });

    it("renders a Mockup mention as a card without a badge that opens Preview by default", async () => {
      hooks.useWorkItemTypeByKey.mockReturnValue(typeFor("mockup"));
      render(<WorkItemMentionInlineRenderer mention={mockupMention} />, {
        wrapper: withPresentation(),
      });

      const card = screen.getByTestId("mention-artifact-card");
      expect(card).toHaveAttribute(
        "data-mention-token",
        "@[mockup:mockup-1|Checkout mockup]",
      );
      expect(within(card).queryByTestId("mention-badge")).toBeNull();
      expect(card).toHaveStyle({ maxWidth: "360px" });
      expect(
        screen.queryByTestId("work-item-inline-mention"),
      ).not.toBeInTheDocument();
      // Nothing is read before the card nears the viewport.
      expect(
        hooks.useWorkItem.mock.calls.every(
          ([, , , options]) => options?.enabled === false,
        ),
      ).toBe(true);

      await userEvent.click(
        screen.getByTestId("visual-artifact-card-mockup-1-open"),
      );
      expect(openPreview).toHaveBeenCalledWith(
        expect.objectContaining({ entityId: "mockup-1" }),
      );
    });

    it("renders a registry-resolved Diagram mention as a card", () => {
      hooks.useWorkItemTypeByKey.mockReturnValue(typeFor("DIAGRAM"));
      render(
        <WorkItemMentionInlineRenderer
          mention={{ ...diagramToken, entityType: "DIAGRAM" }}
        />,
        { wrapper: withPresentation() },
      );

      expect(screen.getByTestId("mention-artifact-card")).toBeInTheDocument();
      expect(
        screen.getByTestId("visual-artifact-card-diagram-1"),
      ).toBeInTheDocument();
    });

    it("renders a diagram token as a card without the graph surface", () => {
      render(<WorkflowMentionInlineRenderer mention={diagramToken} />, {
        wrapper: withPresentation(),
      });

      expect(screen.getByTestId("mention-artifact-card")).toBeInTheDocument();
      expect(
        screen.queryByTestId("workflow-inline-mention"),
      ).not.toBeInTheDocument();
    });

    it("keeps the inline mockup preview and its deferral in inline mode", () => {
      hooks.useWorkItemTypeByKey.mockReturnValue(typeFor("mockup"));
      render(<WorkItemMentionInlineRenderer mention={mockupMention} />, {
        wrapper: withPresentation("inline"),
      });

      expect(
        screen.queryByTestId("mention-artifact-card"),
      ).not.toBeInTheDocument();
      expect(
        screen.getByTestId("work-item-inline-mention-deferred"),
      ).toBeInTheDocument();
      expect(
        DeferredIntersectionObserver.instances[0]?.options?.rootMargin,
      ).toBe("1500px 0px");
    });

    it("renders only the badge in badge mode", () => {
      hooks.useWorkItemTypeByKey.mockReturnValue(typeFor("mockup"));
      render(<WorkItemMentionInlineRenderer mention={mockupMention} />, {
        wrapper: withPresentation("badge"),
      });

      expect(screen.getByTestId("mention-badge")).toBeInTheDocument();
      expect(
        screen.queryByTestId("mention-artifact-card"),
      ).not.toBeInTheDocument();
      expect(hooks.useWorkItem).not.toHaveBeenCalled();
    });

    it("never reads a non-visual mention in card mode", () => {
      hooks.useWorkItemTypeByKey.mockReturnValue({
        ...typeFor("bug"),
        workItemTypeDefinition: {
          ...typeFor("bug").workItemTypeDefinition,
          capabilities: { rendersInline: false },
        },
      });
      render(
        <WorkItemMentionInlineRenderer
          mention={{ entityType: "bug", entityId: "bug-1", entityName: "Bug" }}
        />,
        { wrapper: withPresentation() },
      );

      expect(screen.getByTestId("mention-badge")).toBeInTheDocument();
      expect(
        hooks.useWorkItem.mock.calls.every(
          ([, , , options]) => options?.enabled === false,
        ),
      ).toBe(true);
    });
  });
});
