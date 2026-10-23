import userEvent from "@testing-library/user-event";
import { render, screen, waitFor } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ActivityMetricContinuationDto,
  EntityStarDto,
  OrganizationProjectEntitlementDto,
  ProjectMetricDto,
  ProjectMetricsResponseDto,
  ProjectResponseDto,
} from "../../../api";
import {
  EntityType,
  ProjectMetricIdentity,
  ProjectRole,
  ProjectStatus,
} from "../../../api";
import { PathServiceProvider } from "../../../contexts";
import {
  getPathService,
  type PathService,
} from "../../../services/webPathService";

const useProjectsMock = vi.hoisted(() => vi.fn());
const useEntityStarsMock = vi.hoisted(() => vi.fn());
const useEntityStarMock = vi.hoisted(() =>
  vi.fn(() => ({
    isStarred: false,
    isLoading: false,
    isMutating: false,
    error: null,
    mutationError: null,
    toggle: vi.fn(),
  })),
);
const useProjectMetricsMock = vi.hoisted(() => vi.fn());
const usePermissionsMock = vi.hoisted(() => vi.fn());

vi.mock("@mui/x-charts/BarChart", () => ({
  BarChart: () => <div data-testid="mui-bar-chart" />,
}));

vi.mock("../../../data/hooks/useProjects", () => ({
  useProjects: useProjectsMock,
}));
vi.mock("../../../data/hooks/useEntityStars", () => ({
  useEntityStars: useEntityStarsMock,
  useEntityStar: useEntityStarMock,
}));
vi.mock("../../../data/hooks/useProjectMetrics", () => ({
  useProjectMetrics: useProjectMetricsMock,
}));
vi.mock("../../../hooks/auth/usePermissions", () => ({
  usePermissions: usePermissionsMock,
}));

import {
  OrganizationHome,
  formatProjectUpdatedAt,
  formatProjectStatus,
} from "../OrganizationHome";

const ORGANIZATION_ID = "organization-1";
const USER_ID = "user-1";
const onMetricActivate = vi.fn();
const WINDOW_START = "2026-09-03T12:00:00.000Z";
const WINDOW_END = "2026-09-04T12:00:00.000Z";

const makeProject = (
  id: string,
  name = id,
  description?: string,
): ProjectResponseDto => ({
  id,
  organizationId: ORGANIZATION_ID,
  name,
  description,
  status: ProjectStatus.Active,
  currentUserRole: ProjectRole.Owner,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-02-02T00:00:00.000Z",
});

const makeStar = (
  id: string,
  entityId: string,
  userId = USER_ID,
): EntityStarDto => ({
  id,
  organizationId: ORGANIZATION_ID,
  userId,
  entityType: EntityType.Project,
  entityId,
  entityName: entityId,
  createdAt: "2026-01-01T00:00:00.000Z",
});

const makeEntitlement = (
  overrides: Partial<OrganizationProjectEntitlementDto> = {},
): OrganizationProjectEntitlementDto => ({
  defaultProjectLimit: 2,
  projectLimitOverride: null,
  projectLimit: 2,
  usage: {
    projectCount: 1,
    workItemCount: 12,
    observedAt: "2026-09-04T00:00:00.000Z",
  },
  canCreateProject: true,
  creationUnavailableReason: null,
  ...overrides,
});

const projectsResult = (
  projects: ProjectResponseDto[],
  entitlement: OrganizationProjectEntitlementDto = makeEntitlement(),
) => ({
  projects,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn().mockResolvedValue(projects),
  entitlement,
  entitlementLoading: false,
  refreshEntitlement: vi.fn().mockResolvedValue(entitlement),
});

const starsResult = (stars: EntityStarDto[]) => ({
  data: stars,
  stars,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn().mockResolvedValue(stars),
  markStale: vi.fn(),
  isStarred: vi.fn(),
  isMutating: false,
  mutationError: null,
  star: vi.fn(),
  unstar: vi.fn(),
  starEntity: vi.fn(),
  unstarEntity: vi.fn(),
  refresh: vi.fn(),
  clearError: vi.fn(),
});

const makeMetric = (
  metric: ProjectMetricIdentity,
  value = 0,
): ProjectMetricDto => {
  const activityContinuation: ActivityMetricContinuationDto = {
    metric,
    projectIds: ["project-1"],
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
    actorScope: { mode: "ORGANIZATION" },
  };

  return { metric, value, activityContinuation };
};

const metricsResult = (
  metrics: ProjectMetricDto[] = [
    makeMetric(ProjectMetricIdentity.TaskCreated, 3),
    makeMetric(ProjectMetricIdentity.TaskCompleted, 2),
    makeMetric(ProjectMetricIdentity.TaskVerifying, 1),
    makeMetric(ProjectMetricIdentity.BugCreated, 4),
    makeMetric(ProjectMetricIdentity.BugCompleted, 3),
    makeMetric(ProjectMetricIdentity.BugVerifying, 2),
    makeMetric(ProjectMetricIdentity.PlanCreated, 1),
    makeMetric(ProjectMetricIdentity.PlanCompleted, 1),
    makeMetric(ProjectMetricIdentity.PlanVerifying, 0),
    makeMetric(ProjectMetricIdentity.AgentSessionCreated, 2),
    makeMetric(ProjectMetricIdentity.ProjectInfoCreated, 5),
    makeMetric(ProjectMetricIdentity.ProjectInfoUpdated, 6),
  ],
): {
  data: ProjectMetricsResponseDto;
  isLoading: boolean;
  isFetching: boolean;
  isFetched: boolean;
  isReady: boolean;
  error: Error | null;
  isStale: boolean;
  refetch: ReturnType<typeof vi.fn>;
  markStale: ReturnType<typeof vi.fn>;
} => ({
  data: {
    metrics,
    actorScope: { mode: "ORGANIZATION" },
    effectiveProjectIds: ["project-1"],
    windowStart: WINDOW_START,
    windowEnd: WINDOW_END,
  },
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn().mockResolvedValue(null),
  markStale: vi.fn(),
});

type ProjectsQueryResult = ReturnType<typeof projectsResult>;
type EntityStarsQueryResult = ReturnType<typeof starsResult>;
type ProjectMetricsQueryResult = ReturnType<typeof metricsResult>;

const renderHome = (
  projects: ProjectResponseDto[],
  stars: EntityStarDto[],
  currentUserId = USER_ID,
  projectQueryResult: ProjectsQueryResult = projectsResult(projects),
  starQueryResult: EntityStarsQueryResult = starsResult(stars),
  metricsQueryResult: ProjectMetricsQueryResult = metricsResult(),
  onCreateProject = vi.fn(),
) => {
  useProjectsMock.mockReturnValue(projectQueryResult);
  useEntityStarsMock.mockReturnValue(starQueryResult);
  useProjectMetricsMock.mockReturnValue(metricsQueryResult);

  const pathService: PathService = {
    ...getPathService(),
    onboarding: vi.fn(
      ({ projectId }: { projectId: string }) =>
        `/canonical/projects/${projectId}/onboarding`,
    ),
    project: vi.fn((projectId: string) => `/canonical/projects/${projectId}`),
    projects: vi.fn(() => "/canonical/projects"),
  };

  return render(
    <ThemeProvider theme={createTheme()}>
      <PathServiceProvider pathService={pathService}>
        <MemoryRouter>
          <OrganizationHome
            header={null}
            organizationId={ORGANIZATION_ID}
            currentUserId={currentUserId}
            onMetricActivate={onMetricActivate}
            onCreateProject={onCreateProject}
          />
        </MemoryRouter>
      </PathServiceProvider>
    </ThemeProvider>,
  );
};

describe("OrganizationHome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectMetricsMock.mockReturnValue(metricsResult());
    usePermissionsMock.mockReturnValue({ createProjects: true });
  });

  it("formats project update dates and statuses for display", () => {
    expect(formatProjectUpdatedAt("2026-02-02T00:00:00.000Z")).toBe(
      "Feb 2, 2026",
    );
    expect(formatProjectStatus(ProjectStatus.Onboarding)).toBe("Onboarding");
  });

  it("routes project rows directly from project lifecycle status", () => {
    renderHome(
      [
        makeProject("project-active", "Active Project"),
        {
          ...makeProject("project-onboarding", "Onboarding Project"),
          status: ProjectStatus.Onboarding,
        },
      ],
      [],
    );

    const projectLinks = screen.getAllByTestId(
      "organization-home-project-link",
    );
    expect(projectLinks[0]).toHaveAttribute(
      "href",
      "/canonical/projects/project-active",
    );
    expect(projectLinks[1]).toHaveAttribute(
      "href",
      "/canonical/projects/project-onboarding/onboarding",
    );
  });

  it.each([false, true])(
    "replaces onboarding row stars regardless of activity maturity (%s)",
    (hasEstablishedActivity) => {
      renderHome(
        [
          {
            ...makeProject("onboarding", "New project"),
            status: ProjectStatus.Onboarding,
            hasEstablishedActivity,
          },
        ],
        [],
      );
      expect(
        screen.getByRole("button", { name: "Cancel Onboarding" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("organization-home-project-star-toggle"),
      ).not.toBeInTheDocument();
    },
  );

  it.each([ProjectRole.Architect, ProjectRole.Member, ProjectRole.Viewer])(
    "hides cancel onboarding from a project %s",
    (currentUserRole) => {
      renderHome(
        [
          {
            ...makeProject("onboarding", "New project"),
            status: ProjectStatus.Onboarding,
            currentUserRole,
          },
        ],
        [],
      );
      expect(
        screen.queryByRole("button", { name: "Cancel Onboarding" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("organization-home-project-star-toggle"),
      ).not.toBeInTheDocument();
    },
  );

  it.each(
    Object.values(ProjectStatus).filter(
      (status) => status !== ProjectStatus.Onboarding,
    ),
  )("preserves the row star for %s", (status) => {
    renderHome(
      [{ ...makeProject("existing", "Existing project"), status }],
      [],
    );
    expect(
      screen.getByTestId("organization-home-project-star-toggle"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cancel Onboarding" }),
    ).not.toBeInTheDocument();
  });

  it("requests and labels personal and organization activity separately", () => {
    renderHome([], []);

    expect(useProjectMetricsMock).toHaveBeenNthCalledWith(
      1,
      ORGANIZATION_ID,
      undefined,
      {},
      "PERSONAL",
      USER_ID,
    );
    expect(useProjectMetricsMock).toHaveBeenNthCalledWith(
      2,
      ORGANIZATION_ID,
      undefined,
      {},
      "ORGANIZATION",
    );
    expect(screen.getByText("My Activity")).toBeInTheDocument();
    expect(screen.getByText("Only you")).toBeInTheDocument();
    expect(screen.getByText("Organization Activity")).toBeInTheDocument();
    expect(screen.getByText("All accessible projects")).toBeInTheDocument();
    expect(screen.getAllByText("Last 24 hours")).toHaveLength(2);
    expect(screen.queryByText("Project Info Updates")).not.toBeInTheDocument();
  });

  it("renders backend-owned project entitlement values and launches creation when available", async () => {
    const onCreateProject = vi.fn();
    renderHome(
      [],
      [],
      USER_ID,
      projectsResult(
        [],
        makeEntitlement({
          projectLimit: 5,
          usage: {
            projectCount: 3,
            workItemCount: 42,
            observedAt: "2026-09-04T00:00:00.000Z",
          },
        }),
      ),
      starsResult([]),
      metricsResult(),
      onCreateProject,
    );

    expect(
      screen.getByTestId("organization-home-project-entitlement"),
    ).toHaveTextContent("3 of 5 projects used");
    expect(screen.getByRole("heading", { name: "Projects" })).toBeVisible();
    const createButton = screen.getByRole("button", {
      name: "Create Project",
    });
    expect(createButton).toBeEnabled();

    await userEvent.click(createButton);
    expect(onCreateProject).toHaveBeenCalledOnce();
  });

  it("hides project creation from callers whose organization role cannot create projects", () => {
    usePermissionsMock.mockReturnValue({ createProjects: false });
    renderHome(
      [],
      [],
      USER_ID,
      projectsResult([], makeEntitlement({ canCreateProject: true })),
      starsResult([]),
      metricsResult(),
    );

    expect(screen.getByRole("heading", { name: "Projects" })).toBeVisible();
    expect(
      screen.queryByTestId("organization-home-create-project"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("organization-home-create-project-tooltip-target"),
    ).not.toBeInTheDocument();
  });

  it("disables creation at the organization limit and places colorful plan guidance below the project list", () => {
    const reason = "Your organization has reached its project limit.";
    renderHome(
      [],
      [],
      USER_ID,
      projectsResult(
        [],
        makeEntitlement({
          usage: {
            projectCount: 2,
            workItemCount: 42,
            observedAt: "2026-09-04T00:00:00.000Z",
          },
          canCreateProject: false,
          creationUnavailableReason: reason,
        }),
      ),
    );

    const createButton = screen.getByRole("button", {
      name: "Create Project",
    });
    const unavailableMessage = screen.getByTestId(
      "organization-home-project-create-unavailable",
    );
    expect(createButton).toBeDisabled();
    expect(
      screen.getByTestId("organization-home-project-entitlement"),
    ).toHaveTextContent("2 of 2 projects used");
    expect(unavailableMessage).toHaveClass("MuiAlert-colorWarning");
    expect(unavailableMessage).toHaveTextContent(
      "A higher plan is required to create another project.",
    );
    expect(unavailableMessage).toHaveTextContent(reason);
  });

  it("explains the higher-plan requirement from the disabled Create project tooltip", async () => {
    renderHome(
      [],
      [],
      USER_ID,
      projectsResult(
        [],
        makeEntitlement({
          canCreateProject: false,
          creationUnavailableReason:
            "Your organization has reached its project limit.",
        }),
      ),
    );

    const tooltipTarget = screen.getByTestId(
      "organization-home-create-project-tooltip-target",
    );
    await userEvent.hover(tooltipTarget);

    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "A higher plan is required to create another project. Your organization has reached its project limit.",
    );
  });

  it("paginates the complete collection after stable star ordering", async () => {
    const projects = Array.from({ length: 11 }, (_, index) =>
      makeProject(
        `project-${index + 1}`,
        `Project ${index + 1}`,
        `Description for project ${index + 1}`,
      ),
    );

    renderHome(projects, [makeStar("star-11", "project-11")]);

    expect(
      screen.getAllByTestId("organization-home-project-link"),
    ).toHaveLength(5);
    expect(
      screen.getAllByTestId("organization-home-project-item"),
    ).toHaveLength(5);
    expect(screen.getByText("Project 11")).toBeInTheDocument();
    expect(screen.getByText("Description for project 11")).toBeInTheDocument();
    expect(screen.getAllByTestId("project-updated-at")).toHaveLength(5);
    screen.getAllByTestId("project-updated-at").forEach((date) => {
      expect(date).toHaveTextContent("Updated Feb 2, 2026");
    });
    const activeStatuses = screen.getAllByText("Active");
    expect(activeStatuses).toHaveLength(5);
    activeStatuses.forEach((status) => {
      expect(status.closest(".MuiChip-root")).toHaveClass(
        "MuiChip-colorSuccess",
      );
    });
    expect(
      screen.queryByTestId("organization-home-starred-card"),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByTestId("organization-home-project-link")[0],
    ).toHaveAttribute("data-project-id", "project-11");
    expect(
      screen.getAllByTestId("organization-home-project-star-toggle"),
    ).toHaveLength(5);
    const firstProject = screen.getAllByTestId(
      "organization-home-project-item",
    )[0]!;
    const firstDetails = firstProject.querySelector(
      '[data-testid="organization-home-project-details"]',
    )!;
    const firstUpdatedAt = firstProject.querySelector(
      '[data-testid="project-updated-at"]',
    )!;
    const firstDescription = firstProject.querySelector(
      '[data-testid="organization-home-project-description"]',
    )!;
    const firstActions = firstProject.querySelector(
      '[data-testid="organization-home-project-actions"]',
    )!;
    expect(firstDetails).toContainElement(firstUpdatedAt);
    expect(firstDetails).toHaveTextContent("Project 11");
    expect(firstDetails).toHaveTextContent("Updated Feb 2, 2026");
    expect(firstDetails).not.toHaveTextContent("·");
    const titleRow = firstDetails.querySelector("h3")!.parentElement!;
    expect(titleRow).toContainElement(
      firstDetails.querySelector('[aria-label^="Project status:"]'),
    );
    expect(titleRow).not.toContainElement(firstUpdatedAt);
    expect(getComputedStyle(titleRow).flexDirection).toBe("row");
    expect(useEntityStarMock).toHaveBeenCalledWith(
      ORGANIZATION_ID,
      EntityType.Project,
      "project-11",
    );
    expect(firstDescription).toHaveTextContent("Description for project 11");
    expect(firstActions).toContainElement(
      firstProject.querySelector(
        '[data-testid="organization-home-project-star-toggle"]',
      ),
    );
    expect(
      firstProject.querySelector(
        '[data-testid="organization-home-project-navigation"]',
      ),
    ).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Go to page 3" }));
    expect(
      screen.getAllByTestId("organization-home-project-link"),
    ).toHaveLength(1);
    expect(screen.getByText("Project 10")).toBeInTheDocument();
    await userEvent.type(
      screen.getByLabelText("Search projects"),
      "Project 11",
    );
    expect(screen.getByText("Project 11")).toBeInTheDocument();
    expect(
      screen.getAllByTestId("organization-home-project-link"),
    ).toHaveLength(1);
    expect(
      screen.queryByTestId("organization-home-all-projects-link"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Find a project to continue where you left off."),
    ).not.toBeInTheDocument();
    expect(useEntityStarsMock).toHaveBeenCalledWith(ORGANIZATION_ID, {
      entityType: EntityType.Project,
      enabled: true,
    });
  });

  it("searches every loaded project without reapplying the chooser cap", async () => {
    const projects = Array.from({ length: 11 }, (_, index) =>
      makeProject(`project-${index + 1}`, `Project ${index + 1}`),
    );
    const user = userEvent.setup();

    renderHome(projects, []);
    await user.type(
      screen.getByRole("textbox", { name: "Search projects" }),
      "Project 11",
    );

    expect(
      screen.getAllByTestId("organization-home-project-link"),
    ).toHaveLength(1);
    expect(screen.getByText("Project 11")).toBeInTheDocument();
  });

  it("filters starred records to the selected organization, project type, and user", () => {
    const projects = [makeProject("project-1"), makeProject("project-2")];
    const otherOrganizationStar = {
      ...makeStar("star-other-org", "project-2"),
      organizationId: "organization-2",
    };
    const otherEntityStar = {
      ...makeStar("star-other-entity", "project-2"),
      entityType: EntityType.Task,
    };

    renderHome(projects, [
      makeStar("star-current", "project-1"),
      makeStar("star-other-user", "project-2", "user-2"),
      otherOrganizationStar,
      otherEntityStar,
    ]);

    expect(
      screen.getAllByTestId("organization-home-project-link")[0],
    ).toHaveAttribute("data-project-id", "project-1");
  });

  it("distinguishes no-project and no-search-result states", async () => {
    const user = userEvent.setup();
    const view = renderHome([], []);

    expect(
      screen.getByTestId("organization-home-no-projects"),
    ).toBeInTheDocument();

    view.rerender(
      <ThemeProvider theme={createTheme()}>
        <MemoryRouter>
          <OrganizationHome
            header={null}
            organizationId={ORGANIZATION_ID}
            currentUserId={USER_ID}
            onMetricActivate={onMetricActivate}
            onCreateProject={vi.fn()}
          />
        </MemoryRouter>
      </ThemeProvider>,
    );

    useProjectsMock.mockReturnValue(
      projectsResult([makeProject("project-1", "Alpha")]),
    );
    useEntityStarsMock.mockReturnValue(starsResult([]));
    view.rerender(
      <ThemeProvider theme={createTheme()}>
        <PathServiceProvider pathService={getPathService()}>
          <MemoryRouter>
            <OrganizationHome
              header={null}
              organizationId={ORGANIZATION_ID}
              currentUserId={USER_ID}
              onMetricActivate={onMetricActivate}
              onCreateProject={vi.fn()}
            />
          </MemoryRouter>
        </PathServiceProvider>
      </ThemeProvider>,
    );

    await user.type(
      screen.getByRole("textbox", { name: "Search projects" }),
      "missing",
    );
    expect(
      screen.getByTestId("organization-home-no-search-results"),
    ).toBeInTheDocument();
  });

  it("shows explicit loading and error states", () => {
    useProjectsMock.mockReturnValue({
      ...projectsResult([]),
      isFetched: false,
      isLoading: true,
    });
    useEntityStarsMock.mockReturnValue({
      ...starsResult([]),
      isFetched: false,
      isLoading: true,
    });

    const { rerender } = renderHome(
      [],
      [],
      USER_ID,
      {
        ...projectsResult([]),
        isFetched: false,
        isLoading: true,
      },
      {
        ...starsResult([]),
        isFetched: false,
        isLoading: true,
      },
    );
    expect(
      screen.getByTestId("organization-home-projects-loading"),
    ).toBeInTheDocument();

    useProjectsMock.mockReturnValue({
      ...projectsResult([]),
      error: new Error("projects unavailable"),
      isReady: false,
    });
    useEntityStarsMock.mockReturnValue({
      ...starsResult([]),
      error: new Error("stars unavailable"),
      isReady: false,
    });
    rerender(
      <ThemeProvider theme={createTheme()}>
        <PathServiceProvider pathService={getPathService()}>
          <MemoryRouter>
            <OrganizationHome
              header={null}
              organizationId={ORGANIZATION_ID}
              onMetricActivate={onMetricActivate}
              onCreateProject={vi.fn()}
            />
          </MemoryRouter>
        </PathServiceProvider>
      </ThemeProvider>,
    );

    expect(
      screen.getByTestId("organization-home-projects-error"),
    ).toBeInTheDocument();

    useProjectsMock.mockReturnValue(projectsResult([]));
    rerender(
      <ThemeProvider theme={createTheme()}>
        <PathServiceProvider pathService={getPathService()}>
          <MemoryRouter>
            <OrganizationHome
              header={null}
              organizationId={ORGANIZATION_ID}
              onMetricActivate={onMetricActivate}
              onCreateProject={vi.fn()}
            />
          </MemoryRouter>
        </PathServiceProvider>
      </ThemeProvider>,
    );
    expect(
      screen.getByTestId("organization-home-project-stars-error"),
    ).toBeInTheDocument();
  });

  it("re-queries both scopes when the organization changes", async () => {
    useProjectsMock.mockImplementation((organizationId: string | undefined) =>
      projectsResult(
        organizationId === "organization-2"
          ? [makeProject("project-2")]
          : [makeProject("project-1")],
      ),
    );
    useEntityStarsMock.mockImplementation(
      (organizationId: string | undefined) =>
        starsResult(
          organizationId === "organization-2"
            ? [makeStar("star-2", "project-2")]
            : [makeStar("star-1", "project-1")],
        ),
    );

    const pathService = getPathService();
    const view = render(
      <ThemeProvider theme={createTheme()}>
        <PathServiceProvider pathService={pathService}>
          <MemoryRouter>
            <OrganizationHome
              header={null}
              organizationId="organization-1"
              currentUserId={USER_ID}
              onMetricActivate={onMetricActivate}
              onCreateProject={vi.fn()}
            />
          </MemoryRouter>
        </PathServiceProvider>
      </ThemeProvider>,
    );

    view.rerender(
      <ThemeProvider theme={createTheme()}>
        <PathServiceProvider pathService={pathService}>
          <MemoryRouter>
            <OrganizationHome
              header={null}
              organizationId="organization-2"
              currentUserId={USER_ID}
              onMetricActivate={onMetricActivate}
              onCreateProject={vi.fn()}
            />
          </MemoryRouter>
        </PathServiceProvider>
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(useProjectsMock).toHaveBeenLastCalledWith("organization-2", {
        enabled: true,
      });
      expect(useEntityStarsMock).toHaveBeenLastCalledWith("organization-2", {
        entityType: EntityType.Project,
        enabled: true,
      });
    });
    expect(screen.getByText("project-2")).toBeInTheDocument();
    expect(screen.queryByText("project-1")).not.toBeInTheDocument();
  });
});
