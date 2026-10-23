import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { PlanPage } from "./PlanPage";

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  viewer: vi.fn(),
  generation: vi.fn(),
  worktree: vi.fn(),
  descriptor: vi.fn(),
  automation: vi.fn(),
  designDocs: vi.fn(),
  layoutMainScrollOwner: {
    mainContentRef: { current: null },
    taskContextStickyTop: 0,
  },
}));
const plan = {
  id: "plan-1",
  type: "PLAN",
  name: "Canonical plan",
  parentTaskId: "feature-1",
  organizationId: "org-1",
  projectId: "project-1",
  status: "ACTIVE",
  source: "USER",
};
const configuration = {
  schemaVersion: "plan-configuration.v1",
  planType: "STANDARD",
  worktreeBranch: "plan/branch",
};
vi.mock("@hey-hey/ui-common", () => ({
  createNavigationLineageEntry: (entityType: string, entityId: string) => ({
    entityType,
    entityId,
  }),
}));
vi.mock("@hey-hey/ui-common/context", () => ({
  CanonicalPageBoundary: ({ children }: { children: ReactNode }) => children,
  TrackingProvider: ({ children }: { children: ReactNode }) => children,
  createCanonicalPageDescriptor: (...args: unknown[]) =>
    mocks.descriptor(...args),
}));
vi.mock("@hey-hey/ui-common/data", () => ({
  usePlatformAdminAccess: () => ({ isPlatformAdmin: true, isResolved: true }),
  useCanonicalPlanMutations: () => ({ updatePlan: vi.fn() }),
  useCanonicalPlanAggregate: (...args: unknown[]) => mocks.aggregate(...args),
  useProject: () => ({ data: { name: "Project" } }),
  // A cache miss exercises the parent read fallback.
  useFeatureLookup: () => ({
    isReady: true,
    isLoading: false,
    get: () => undefined,
    resolveAncestry: () => ({ ancestors: [], complete: false }),
  }),
  useWorkItem: () => ({ workItem: { name: "Parent feature" } }),
}));
vi.mock("@hey-hey/ui-common/components", async () => {
  // Keep the real completion owner; PlanViewer's guard is covered in ui-common.
  const { PlanCompletionAction } =
    await import("../../../../ui-common/src/components/Plans/PlanCompletionAction");
  return {
    DependentFutures: ({ taskId }: { taskId: string }) => (
      <div data-testid="dependent-futures" data-task-id={taskId} />
    ),
    DiscussCapsuleAction: () => null,
    PlanArchiveDeleteDialog: () => null,
    PlanGenerationChat: (props: unknown) => {
      mocks.generation(props);
      return <div data-testid="plan-generation">Generation</div>;
    },
    PlanViewer: (props: {
      disablePreview?: boolean;
      readOnly?: boolean;
      organizationId: string;
      projectId: string;
      planId: string;
      onAutomateStage?: (id: string) => void;
      onViewAutomation?: () => void;
    }) => {
      mocks.viewer(props);
      return (
        <div data-testid="plan-viewer">
          {!props.readOnly && (
            <PlanCompletionAction
              organizationId={props.organizationId}
              projectId={props.projectId}
              planId={props.planId}
              planTitle={plan.name}
              planStatus={mocks.aggregate().aggregate.plan.status}
            />
          )}
          <button onClick={() => props.onAutomateStage?.("stage-2")}>
            Automate selected stage
          </button>
          <button onClick={props.onViewAutomation}>View automation</button>
        </div>
      );
    },
    PlanWorktreeEditor: (props: unknown) => {
      mocks.worktree(props);
      return <div>Worktree editor</div>;
    },
    PlanAutomationTab: (props: {
      buildTaskMonitorPath: (id: string) => string;
    }) => {
      mocks.automation(props);
      return (
        <a href={props.buildTaskMonitorPath("monitor-1")}>Existing monitor</a>
      );
    },
  };
});
vi.mock(
  "../../../../ui-common/src/components/InteractionComponent/useEntityConversationLauncher",
  () => ({
    useEntityConversationLauncher: () => ({ launch: vi.fn() }),
  }),
);
vi.mock(
  "../../../../ui-common/src/components/AgentSession/runtime/coding/useMachineResolution",
  () => ({
    useMachineResolution: () => ({
      machines: [],
      selectedMachine: null,
      setSelectedMachineId: vi.fn(),
    }),
  }),
);
vi.mock("../../../../ui-common/src/components/ActionsCapsule", () => ({
  CapsuleAction: ({
    label,
    onClick,
  }: {
    label: string;
    onClick: () => void;
  }) => <button onClick={onClick}>{label}</button>,
}));
vi.mock("../../../../ui-common/src/components/InteractionComponent", () => ({
  EntityConversationPromptDialog: ({
    open,
    primaryAction,
    secondaryAction,
  }: {
    open: boolean;
    primaryAction: { label: string };
    secondaryAction: { label: string };
  }) =>
    open ? (
      <div role="dialog">
        <button>{secondaryAction.label}</button>
        <button>{primaryAction.label}</button>
      </div>
    ) : null,
}));
vi.mock("../../components/Layout", () => ({
  DetailPageContainer: ({ children }: { children: ReactNode }) => children,
  DetailPageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  PageBreadcrumbs: ({ items }: { items: { label: string; to?: string }[] }) => (
    <nav>
      {items.map((item, index) => (
        <a key={index} href={item.to}>
          {item.label}
        </a>
      ))}
    </nav>
  ),
}));
vi.mock("./PlanConversationTab", () => ({ PlanConversationTab: () => null }));
vi.mock("../../components/Tabs/DataDebugTab", () => ({
  DataDebugTab: () => null,
}));
vi.mock("../../components/Tabs/DesignDocsTab", () => ({
  DesignDocsTab: (props: unknown) => {
    mocks.designDocs(props);
    return null;
  },
}));
vi.mock("../../components/Layout/LayoutMainBottomSpacingContext", () => ({
  useSuppressLayoutMainBottomSpacing: () => undefined,
}));
vi.mock("../../components/Layout/LayoutMainScrollOwnerContext", () => ({
  useLayoutMainScrollOwner: () => mocks.layoutMainScrollOwner,
}));
vi.mock("../../hooks/useRemainingViewportHeight", () => ({
  useRemainingViewportHeight: () => ({
    containerRef: () => undefined,
    height: 420,
  }),
}));

const Location = () => {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname + location.search}
    </output>
  );
};
const renderPage = (
  props: Partial<React.ComponentProps<typeof PlanPage>> = {},
  search = "",
) =>
  render(
    <MemoryRouter
      initialEntries={["/projects/project-1/plans/plan-1" + search]}
    >
      <Location />
      <Routes>
        <Route
          path="*"
          element={
            <PlanPage
              organizationId="org-1"
              projectId="project-1"
              planId="plan-1"
              {...props}
            />
          }
        />
      </Routes>
    </MemoryRouter>,
  );

describe("canonical Plan page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.aggregate.mockReturnValue({
      status: "ready",
      aggregate: { plan, configuration, stages: [] },
      error: null,
    });
  });
  it("renders a standalone Plan with project-level navigation", () => {
    mocks.aggregate.mockReturnValue({
      status: "ready",
      aggregate: {
        plan: { ...plan, parentTaskId: undefined },
        configuration,
        stages: [],
      },
      error: null,
    });
    renderPage();
    expect(screen.getByTestId("dependent-futures")).toHaveAttribute(
      "data-task-id",
      plan.id,
    );
    expect(
      screen.getByRole("heading", { name: plan.name }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Parent feature" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Plans" })).toHaveAttribute(
      "href",
      "/projects/project-1/plans",
    );
    expect(mocks.descriptor).toHaveBeenCalledWith(
      "task",
      "plan-1",
      [{ entityType: "task", entityId: "plan-1" }],
      { kind: "task", taskType: "PLAN", label: plan.name },
    );
  });

  it("reads a canonical aggregate and publishes Task identity with Feature ancestry", () => {
    renderPage();
    expect(
      screen.getByRole("heading", { name: plan.name }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Parent feature" }),
    ).toHaveAttribute("href", "/projects/project-1/features/feature-1");
    expect(mocks.aggregate).toHaveBeenCalledWith(
      "org-1",
      "project-1",
      "plan-1",
    );
    expect(mocks.descriptor).toHaveBeenCalledWith(
      "task",
      "plan-1",
      [
        { entityType: "task", entityId: "feature-1" },
        { entityType: "task", entityId: "plan-1" },
      ],
      { kind: "task", taskType: "PLAN", label: plan.name },
    );
    expect(mocks.viewer).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        planId: "plan-1",
        disablePreview: true,
        readOnly: false,
      }),
    );
    expect(screen.getByTestId("plan-viewer")).toBeInTheDocument();
  });

  it("passes canonical Plan identity to the Design Docs tab", () => {
    renderPage({}, "?tab=documents");

    expect(mocks.designDocs).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      planId: "plan-1",
      enableFilters: true,
    });
  });

  it("renders loading and registry errors without inventing a Plan", () => {
    mocks.aggregate.mockReturnValue({
      status: "loading",
      aggregate: null,
      error: null,
    });
    const { rerender } = renderPage();
    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    mocks.aggregate.mockReturnValue({
      status: "error",
      aggregate: null,
      error: new Error("Invalid PLAN registry"),
    });
    rerender(
      <MemoryRouter>
        <PlanPage
          organizationId="org-1"
          projectId="project-1"
          planId="plan-1"
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Invalid PLAN registry",
    );
    expect(mocks.viewer).not.toHaveBeenCalled();
  });
  it("keeps malformed Plan generation recoverable with structured findings", () => {
    const draft = { ...plan, status: "BACKLOG" };
    mocks.aggregate.mockReturnValue({
      status: "error",
      aggregate: null,
      error: new Error("Plan Stage dependencies must form one linear chain."),
      validationIssues: [
        {
          layer: "structural",
          field: "stages.stage-2.dependencies.stage-1",
          code: "PLAN_STAGE_LINEAR_CHAIN",
          reason: "Plan Stage dependencies must form one linear chain.",
          suggestion: "Keep the Stage dependency graph linear.",
        },
      ],
      recovery: { plan: draft, configuration },
    });

    renderPage();

    expect(
      screen.getByTestId("plan-generation-validation-recovery"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("plan-generation-validation-error"),
    ).toHaveTextContent("stages.stage-2.dependencies.stage-1");
    expect(screen.getByTestId("plan-generation")).toBeInTheDocument();
    expect(screen.queryByTestId("plan-viewer")).not.toBeInTheDocument();
    expect(mocks.generation).toHaveBeenCalledWith(
      expect.objectContaining({ plan: draft, configuration }),
    );
  });
  it("routes the selected canonical Stage to monitor setup", async () => {
    renderPage();
    await userEvent.click(
      screen.getByRole("button", { name: "Automate selected stage" }),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/plans/plan-1/stages/stage-2/task-monitor/setup",
    );
  });
  it("opens existing automation under the Plan URL", () => {
    renderPage({}, "?tab=automation");
    expect(
      screen.getByRole("link", { name: "Existing monitor" }),
    ).toHaveAttribute(
      "href",
      "/projects/project-1/plans/plan-1/task-monitor/monitor-1",
    );
  });
  it("supplies canonical configuration to the worktree editor", () => {
    renderPage({}, "?tab=admin");
    expect(mocks.worktree).toHaveBeenCalledWith({ plan, configuration });
  });
  it("keeps preview observational and omits automation callbacks", () => {
    renderPage({ preview: true });
    expect(mocks.descriptor).not.toHaveBeenCalled();
    expect(mocks.viewer.mock.calls[0][0].onAutomateStage).toBeUndefined();
    expect(
      screen.queryByRole("button", { name: "Edit Plan" }),
    ).not.toBeInTheDocument();
  });
  it("retains embedded automation content and bounded viewport", () => {
    renderPage({
      view: "automation",
      automationHeightMode: "remaining-viewport",
      automationContent: <div>Setup form</div>,
    });
    expect(screen.getByTestId("plan-automation-viewport")).toHaveTextContent(
      "Setup form",
    );
    expect(mocks.automation).not.toHaveBeenCalled();
  });
});

it("shows Draft generation for BACKLOG even when stage outlines exist", () => {
  const draft = { ...plan, status: "BACKLOG" };
  mocks.aggregate.mockReturnValue({
    status: "ready",
    aggregate: {
      plan: draft,
      configuration,
      stages: [{ stage: { id: "stage-outline" } }],
    },
    error: null,
  });
  renderPage();
  expect(screen.getByText("Draft")).toBeInTheDocument();
  expect(screen.getByTestId("plan-generation")).toBeInTheDocument();
  expect(screen.queryByTestId("plan-viewer")).not.toBeInTheDocument();
  expect(mocks.generation).toHaveBeenCalledWith(
    expect.objectContaining({
      plan: draft,
      configuration,
      organizationId: "org-1",
      projectId: "project-1",
      planId: "plan-1",
      scrollPolicy: {
        mode: "owned",
        ownerRef: mocks.layoutMainScrollOwner.mainContentRef,
      },
    }),
  );
});
it("keeps READY plans in the execution view", () => {
  mocks.aggregate.mockReturnValue({
    status: "ready",
    aggregate: {
      plan: { ...plan, status: "READY" },
      configuration,
      stages: [],
    },
    error: null,
  });
  renderPage();
  expect(screen.getByText("Ready")).toBeInTheDocument();
  expect(screen.getByTestId("plan-viewer")).toBeInTheDocument();
  expect(screen.queryByTestId("plan-generation")).not.toBeInTheDocument();
});

it("offers Complete and Review for canonical Verifying Plans", async () => {
  mocks.aggregate.mockReturnValue({
    status: "ready",
    aggregate: {
      plan: { ...plan, status: "VERIFYING" },
      configuration,
      stages: [],
    },
    error: null,
  });

  renderPage();

  expect(mocks.viewer).toHaveBeenCalledWith(
    expect.objectContaining({ disablePreview: true, readOnly: false }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Complete" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Complete and Review" }),
  ).toBeInTheDocument();
});

it("does not register Complete in Plan previews", () => {
  mocks.aggregate.mockReturnValue({
    status: "ready",
    aggregate: {
      plan: { ...plan, status: "VERIFYING" },
      configuration,
      stages: [],
    },
    error: null,
  });

  renderPage({ preview: true });

  expect(mocks.viewer).toHaveBeenCalledWith(
    expect.objectContaining({ readOnly: true }),
  );
  expect(
    screen.queryByRole("button", { name: "Complete" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
});

it("keeps a draft preview observational", () => {
  mocks.aggregate.mockReturnValue({
    status: "ready",
    aggregate: {
      plan: { ...plan, status: "BACKLOG" },
      configuration,
      stages: [],
    },
    error: null,
  });
  renderPage({ preview: true });
  expect(screen.getByTestId("plan-draft-preview")).toBeInTheDocument();
  expect(screen.queryByTestId("plan-generation")).not.toBeInTheDocument();
});
