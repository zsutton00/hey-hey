import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  WorkItemTypeEffectiveSource,
  WorkItemTypeLifecycleStatus,
  WorkItemTypeRole,
  EntityType,
  type WorkItemTypeSummaryDto,
} from "@hey-hey/ui-common/api";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectPage } from "./ProjectPage";

const mockQueryState: Record<string, string | undefined> = {};
const mockSetNavigationState = vi.fn();
const mockProjectOverview = vi.fn();
const mockProjectWorkItemsTab = vi.fn();
const mockDesignDocsTab = vi.fn();
const mockPlanList = vi.fn();
const mockDiscussCapsuleAction = vi.fn();
const mockProposalsTab = vi.fn();
const mockProjectAgentsTab = vi.fn();
const mockProjectSettingsTab = vi.fn();
const mockProjectHelpPage = vi.fn();
const mockTrackingProvider = vi.fn();
const mockBreadcrumbs = vi.fn();
const mockBuildProjectWorkspaceNavigation = vi.hoisted(() => vi.fn());
let mockWorkItemTypesReady = true;
let mockWorkItemTypes: WorkItemTypeSummaryDto[] = [];
let mockProject: Record<string, unknown> | undefined;

const workItemType = (
  key: string,
  name: string,
  role: WorkItemTypeRole,
  overrides: Partial<WorkItemTypeSummaryDto> = {}
): WorkItemTypeSummaryDto => ({
  id: `type-${key}`,
  projectId: "project-1",
  status: WorkItemTypeLifecycleStatus.Active,
  effectiveSource: WorkItemTypeEffectiveSource.Canonical,
  definition: { key, name, role, sections: [], allowedStatuses: [] },
  ...overrides,
});

const defaultWorkItemTypes = (): WorkItemTypeSummaryDto[] => [
  workItemType("STANDARD", "Tasks", WorkItemTypeRole.WorkItem),
  workItemType("BUG", "Bugs", WorkItemTypeRole.WorkItem),
  workItemType(
    "CUSTOM_WORK_ITEM",
    "Custom Work Items",
    WorkItemTypeRole.WorkItem
  ),
  workItemType("FEATURE", "Features", WorkItemTypeRole.ProjectInfo),
  workItemType(
    "CUSTOM_PROJECT_INFO",
    "Custom Project Info",
    WorkItemTypeRole.ProjectInfo
  ),
  workItemType("INITIATIVE", "Initiatives", WorkItemTypeRole.ProjectInfo),
  workItemType(
    "SCHEDULED_REPORT",
    "Scheduled Reports",
    WorkItemTypeRole.Scheduled
  ),
  workItemType("WEBHOOK", "Webhooks", WorkItemTypeRole.Trigger),
  workItemType("TASK_MONITOR", "Task Monitors", WorkItemTypeRole.Monitor),
];

vi.mock("nuqs", () => ({
  parseAsString: { withDefault: () => ({}) },
  useQueryStates: () => [
    { tab: mockQueryState.tab, type: mockQueryState.type },
    mockSetNavigationState,
  ],
}));

vi.mock("@hey-hey/ui-common", () => ({
  WebPathService: {
    project: (projectId: string) => `/projects/${projectId}`,
    projects: () => "/projects",
  },
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  useOrganization: () => ({ currentOrganization: { id: "org-1" } }),
  TrackingProvider: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    context: unknown;
  }) => {
    mockTrackingProvider(props);
    return children;
  },
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org-1", userId: "user-1" }),
}));

vi.mock("@hey-hey/ui-common/data", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@hey-hey/ui-common/data")
  >();
  mockBuildProjectWorkspaceNavigation.mockImplementation(
    actual.buildProjectWorkspaceNavigation
  );

  return {
    ...actual,
    buildProjectWorkspaceNavigation: mockBuildProjectWorkspaceNavigation,
    useProject: () => ({ data: mockProject }),
    useProjectPlans: () => ({ plans: [], isLoading: false }),
    useWorkItemTypes: () => ({
      workItemTypes: mockWorkItemTypes,
      isReady: mockWorkItemTypesReady,
    }),
  };
});

vi.mock("@hey-hey/ui-common/components", () => ({
  DiscussCapsuleAction: (props: unknown) => {
    mockDiscussCapsuleAction(props);
    return <div data-testid="discuss-capsule-action" />;
  },
  ProjectOverview: (props: unknown) => {
    mockProjectOverview(props);
    return <div>Authoritative Project Overview</div>;
  },
  PlanList: (props: unknown) => {
    mockPlanList(props);
    return <div>Plans content</div>;
  },
}));

vi.mock("../../components/SegmentedToggle", () => ({
  SegmentedToggle: (props: {
    onChange: (value: string) => void;
    segments: Array<{ value: string; label: string }>;
  }) => (
    <div data-testid="type-selector">
      {props.segments.map((segment) => (
        <button
          key={segment.value}
          onClick={() => props.onChange(segment.value)}
          type="button"
        >
          {segment.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("../../components/Layout", () => ({
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DetailPageTabs: ({
    onChange,
    tabs,
  }: {
    onChange: (value: string) => void;
    tabs: Array<{ value: string; label: string }>;
  }) => (
    <nav aria-label="Project views">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => onChange(tab.value)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </nav>
  ),
  PageBreadcrumbs: (props: unknown) => {
    mockBreadcrumbs(props);
    return <nav aria-label="Breadcrumbs" />;
  },
}));

vi.mock("../../components/Tabs", () => ({
  buildAdminMetadataItems: () => [],
  DesignDocsTab: (props: unknown) => {
    mockDesignDocsTab(props);
    return <div>Design Docs content</div>;
  },
  ProjectWorkItemsTab: (props: unknown) => {
    mockProjectWorkItemsTab(props);
    return <div>Work items content</div>;
  },
  ProposalsTab: (props: unknown) => {
    mockProposalsTab(props);
    return <div>Project review records</div>;
  },
}));

vi.mock("./ProjectAgentsTab", () => ({
  ProjectAgentsTab: (props: unknown) => {
    mockProjectAgentsTab(props);
    return <div>Project Agents composition</div>;
  },
}));

vi.mock("./ProjectSettingsTab", () => ({
  ProjectSettingsTab: (props: unknown) => {
    mockProjectSettingsTab(props);
    return <div>Project Settings composition</div>;
  },
}));

vi.mock("../NewOrgLanding/ProjectHelpPage", () => ({
  ProjectHelpPage: (props: unknown) => {
    mockProjectHelpPage(props);
    return <div>Project Help composition</div>;
  },
}));

describe("ProjectPage", () => {
  beforeEach(() => {
    delete mockQueryState.tab;
    delete mockQueryState.type;
    mockWorkItemTypes = defaultWorkItemTypes();
    mockWorkItemTypesReady = true;
    mockProject = {
      id: "project-1",
      name: "Project Alpha",
      hasEstablishedActivity: true,
      createdBy: "user-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    };
    vi.clearAllMocks();
  });

  const renderPage = (path = "/projects/project-1") =>
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectPage />} />
          <Route
            path="/projects/:projectId/landing"
            element={<ProjectPage />}
          />
        </Routes>
      </MemoryRouter>
    );

  it.each(["/projects/project-1", "/projects/project-1/landing"])(
    "renders the shared Overview by default at %s without a stored preference",
    (path) => {
      const storageSpy = vi.spyOn(Storage.prototype, "getItem");

      renderPage(path);

      expect(
        screen.getByText("Authoritative Project Overview")
      ).toBeInTheDocument();
      expect(mockProjectOverview).toHaveBeenCalledWith({
        organizationId: "org-1",
        projectId: "project-1",
      });
      expect(storageSpy).not.toHaveBeenCalled();
      storageSpy.mockRestore();
    }
  );

  it("presents the seven durable destinations in order", () => {
    renderPage();

    const navigation = screen.getByRole("navigation", {
      name: "Project views",
    });
    expect(
      Array.from(
        navigation.querySelectorAll("button"),
        (button) => button.textContent
      )
    ).toEqual([
      "Overview",
      "Work",
      "Reviews",
      "Agents",
      "Knowledge",
      "Settings",
      "Help",
    ]);
    expect(navigation).not.toHaveTextContent("Admin");
    expect(
      screen.queryByTestId("overview-segmented-toggle")
    ).not.toBeInTheDocument();
  });

  it.each([
    "overview",
    "work",
    "reviews",
    "agents",
    "knowledge",
    "settings",
    "help",
  ])(
    "registers the project-scoped Discuss action on the %s destination",
    (destination) => {
      mockQueryState.tab = destination;
      renderPage();

      expect(mockDiscussCapsuleAction).toHaveBeenCalledWith({
        entityId: "project-1",
        entityType: EntityType.Project,
        entityTitle: "Project Alpha",
        organizationId: "org-1",
        projectId: "project-1",
      });
    }
  );

  it("withholds Discuss until project context resolves", () => {
    mockProject = undefined;
    renderPage();

    expect(mockDiscussCapsuleAction).not.toHaveBeenCalled();
    expect(
      screen.queryByTestId("discuss-capsule-action")
    ).not.toBeInTheDocument();
  });

  it("uses canonical project paths for tracking and breadcrumbs", () => {
    renderPage();

    expect(mockTrackingProvider).toHaveBeenCalledWith({
      context: { page: { name: "project", path: "/projects/project-1" } },
    });
    expect(mockBreadcrumbs).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [
          { label: "Projects", to: "/projects" },
          {
            label: "Project Alpha",
            to: "/projects/project-1",
            isCurrent: true,
            type: "project",
          },
        ],
      })
    );
  });

  it("renders Work from its stable query-backed type selection", () => {
    mockQueryState.tab = "work";
    mockQueryState.type = "BUG";
    renderPage();

    expect(screen.getByRole("button", { name: "Tasks" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bugs" })).toBeInTheDocument();
    expect(mockProjectWorkItemsTab).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      taskType: "BUG",
      title: "Bugs",
      emptyMessage: "No bugs in this project yet.",
    });
  });

  it("maps pre-overhaul role query tabs onto the durable Work destination", () => {
    mockQueryState.tab = WorkItemTypeRole.WorkItem;
    mockQueryState.type = "BUG";
    renderPage();

    expect(mockProjectWorkItemsTab).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: "BUG", title: "Bugs" })
    );
  });

  it("renders Features, Design Docs, and Plans under Knowledge without Initiatives", () => {
    mockQueryState.tab = "knowledge";
    mockQueryState.type = "FEATURE";
    renderPage();

    expect(mockBuildProjectWorkspaceNavigation).toHaveBeenCalledWith(
      mockWorkItemTypes,
      "project-1"
    );
    expect(
      screen.getByRole("button", { name: "Features" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Custom Project Info" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Design Docs" })
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plans" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Initiatives" })
    ).not.toBeInTheDocument();
    expect(mockProjectWorkItemsTab).toHaveBeenCalledWith(
      expect.objectContaining({ taskType: "FEATURE", title: "Features" })
    );
  });

  it.each([
    ["tasks", "STANDARD", "work-item"],
    ["bugs", "BUG", "work-item"],
    ["features", "FEATURE", "work-item"],
    ["plans", "PLAN", "plan"],
    ["knowledge-base", "DESIGN_DOC", "design-doc"],
  ] as const)("preserves the legacy %s destination", (tab, _key, kind) => {
    mockQueryState.tab = tab;
    renderPage();

    if (kind === "plan") expect(mockPlanList).toHaveBeenCalledTimes(1);
    if (kind === "design-doc")
      expect(mockDesignDocsTab).toHaveBeenCalledTimes(1);
    if (kind === "work-item")
      expect(mockProjectWorkItemsTab).toHaveBeenCalledTimes(1);
  });

  it("withholds Work and Knowledge content until registry resolution succeeds", () => {
    mockQueryState.tab = "work";
    mockWorkItemTypesReady = false;
    renderPage();

    expect(
      screen.getByRole("navigation", { name: "Project views" })
    ).toHaveTextContent("Work");
    expect(screen.queryByTestId("type-selector")).not.toBeInTheDocument();
    expect(mockProjectWorkItemsTab).not.toHaveBeenCalled();
    expect(mockDesignDocsTab).not.toHaveBeenCalled();
    expect(mockPlanList).not.toHaveBeenCalled();
  });

  it("renders an explicit empty Work destination after a ready empty snapshot", () => {
    mockQueryState.tab = "work";
    mockWorkItemTypes = [];
    renderPage();

    expect(
      screen.getByText("No work item types are available for this project.")
    ).toBeInTheDocument();
    expect(screen.queryByTestId("type-selector")).not.toBeInTheDocument();
  });

  it("mounts canonical Reviews, Agents, and Settings compositions", () => {
    mockQueryState.tab = "reviews";
    const reviews = renderPage("/projects/project-1?tab=reviews");
    expect(mockProposalsTab).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
    });
    reviews.unmount();

    mockQueryState.tab = "agents";
    const agents = renderPage();
    expect(mockProjectAgentsTab).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      userId: "user-1",
    });
    agents.unmount();

    mockQueryState.tab = "settings";
    renderPage();
    expect(mockProjectSettingsTab).toHaveBeenCalledWith({
      metadataItems: [],
      organizationId: "org-1",
      projectId: "project-1",
    });
  });

  it("mounts the existing Help surface with the active project context", () => {
    mockQueryState.tab = "help";
    renderPage("/projects/project-1?tab=help");

    expect(mockProjectHelpPage).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
    });
    expect(screen.getByText("Project Help composition")).toBeInTheDocument();
  });

  it("writes destination and type changes to push-history query state", async () => {
    const user = userEvent.setup();
    mockQueryState.tab = "work";
    mockQueryState.type = "STANDARD";
    renderPage();

    await user.click(screen.getByRole("button", { name: "Bugs" }));
    expect(mockSetNavigationState).toHaveBeenCalledWith(
      { tab: "work", type: "BUG" },
      { history: "push" }
    );

    await user.click(screen.getByRole("button", { name: "Knowledge" }));
    expect(mockSetNavigationState).toHaveBeenCalledWith(
      { tab: "knowledge", type: "FEATURE" },
      { history: "push" }
    );

    await user.click(screen.getByRole("button", { name: "Help" }));
    expect(mockSetNavigationState).toHaveBeenCalledWith(
      { tab: "help", type: "STANDARD" },
      { history: "push" }
    );
  });
});
