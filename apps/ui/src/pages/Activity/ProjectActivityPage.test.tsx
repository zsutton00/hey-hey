import { parseOrganizationActivityQuery } from "./activityHistoryRoute";
import { EntityType, ProjectMetricIdentity } from "@hey-hey/ui-common/api";
import type { ActivityExpandPayload } from "@hey-hey/ui-common/components";
import {
  useAgentSessions,
  useCorrelatedActivity,
  useProject,
  useTaskHierarchy,
} from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationHomePage } from "../OrganizationHome/OrganizationHomePage";
import {
  ProjectActivityPage,
} from "./ProjectActivityPage";

const paginatedCodingSessionsFeedMock = vi.fn();
const crossProjectActivityFeedMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQueries: vi.fn(() => []),
}));

vi.mock("@hey-hey/ui-common/clients", () => ({
  unifiedApiClient: {
    getReport: vi.fn(),
    getTask: vi.fn(),
  },
}));

vi.mock("@hey-hey/ui-common/components", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/components")>()),
  CorrelatedActivityFeed: ({ onExpandActivity }: { onExpandActivity?: (payload: ActivityExpandPayload) => void }) =>
    onExpandActivity ? (
      <button data-testid="project-activity-open-entity" onClick={() => onExpandActivity({
        activity: { entityId: "task-1", entityType: EntityType.Task, kind: "entity", projectId: "project-2" } as ActivityExpandPayload["activity"],
        href: "/projects/project-2/tasks/task-1",
      })}>Open project row</button>
    ) : null,
  OrganizationHome: ({
    onMetricActivate,
  }: {
    onMetricActivate: (path: string) => void;
  }) => (
    <button
      data-testid="organization-home-metric"
      onClick={() =>
        onMetricActivate(
          "/organizations/org-1/activity?metric=TASK_COMPLETED&projectIds=project-2&projectIds=project-1&windowStart=2026-03-01T00%3A00%3A00.000Z&windowEnd=2026-03-02T00%3A00%3A00.000Z&actorScope=ORGANIZATION",
        )
      }
      type="button"
    >
      Open metric
    </button>
  ),
  CrossProjectActivityFeed: (props: Record<string, unknown>) => {
    crossProjectActivityFeedMock(props);
    const onExpandActivity =
      typeof props.onExpandActivity === "function"
        ? (props.onExpandActivity as (payload: ActivityExpandPayload) => void)
        : undefined;
    const onPageChange =
      typeof props.onPageChange === "function"
        ? (props.onPageChange as (offset: number) => void)
        : undefined;
    return typeof onExpandActivity === "function" ? (
      <>
        <button
          data-testid="cross-project-activity-open-entity"
          onClick={() =>
            onExpandActivity({
              activity: {
                entityId: "task-1",
                entityType: EntityType.Task,
                kind: "entity",
                projectId: "project-2",
              } as ActivityExpandPayload["activity"],
              href: "/projects/project-2/tasks/task-1",
            } satisfies ActivityExpandPayload)
          }
          type="button"
        >
          Open entity
        </button>
        {onPageChange ? (
          <button
            data-testid="cross-project-activity-next-page"
            onClick={() => onPageChange(50)}
            type="button"
          >
            Next page
          </button>
        ) : null}
      </>
    ) : (
      <div data-testid="cross-project-activity-feed-mock" />
    );
  },
  ReportSummaryCard: () => null,
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useAccountDefaultOrganization: vi.fn(() => ({
    state: { status: "ready", preference: { organizationId: null } },
    save: vi.fn(),
    reload: vi.fn(),
  })),
  useProjectMembers: vi.fn(() => ({
    data: [],
    isReady: true,
    isFetched: true,
    hasNext: false,
  })),
  useProjects: vi.fn(() => ({ create: vi.fn() })),
  useAgentSessions: vi.fn(),
  useCorrelatedActivity: vi.fn(),
  useProject: vi.fn(),
  useTaskHierarchy: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  usePermissions: vi.fn(() => ({ createProjects: true })),
  useUserIdentity: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    loading: false,
    user: { id: "user-1", name: "Alex" },
  })),
  useOrganization: vi.fn(() => ({
    currentOrganization: { id: "org-1" },
    error: null,
    loading: false,
  })),
}));

vi.mock("../../hooks/useShouldShowNewOrgIntro", () => ({
  useShouldShowNewOrgIntro: vi.fn(() => ({
    isReady: true,
    shouldShow: false,
  })),
}));

vi.mock("../../components/Layout", () => ({
  PageBreadcrumbs: () => null,
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  DetailPageHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));

vi.mock("../../utils/statusUtils", () => ({
  getStatusLabel: (status: string) => status,
}));

vi.mock("../../components/Activity", () => ({
  PaginatedCodingSessionsFeed: (props: Record<string, unknown>) => {
    paginatedCodingSessionsFeedMock(props);
    return <div>Paginated Coding Sessions Feed</div>;
  },
  PaginatedSessionFeed: ({ variant }: { variant: string }) => (
    <div>{`Paginated ${variant} Feed`}</div>
  ),
}));

const useCorrelatedActivityMock = vi.mocked(useCorrelatedActivity);
const useAgentSessionsMock = vi.mocked(useAgentSessions);
const useProjectMock = vi.mocked(useProject);
const useTaskHierarchyMock = vi.mocked(useTaskHierarchy);
const useUserIdentityMock = vi.mocked(useUserIdentity);

const LocationProbe = () => {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
};

describe("ProjectActivityPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();

    useUserIdentityMock.mockReturnValue({
      currentOrgId: "org-1",
      userId: "user-1",
    });

    useProjectMock.mockReturnValue({
      data: {
        id: "project-1",
        name: "Project One",
      },
    } as ReturnType<typeof useProject>);

    useCorrelatedActivityMock.mockReturnValue({
      data: null,
      error: null,
      isLoading: false,
      pagination: {
        limit: 200,
        nextOffset: null,
        offset: 0,
        totalCount: 1,
      },
      rawRecords: [],
      records: [
        {
          activityId: "activity-1",
          activityType: "NOTIFICATION",
          entityId: "message-1",
          entityType: EntityType.Message,
          id: "MESSAGE:message-1:NOTIFICATION:2026-03-01T00:00:00.000Z:SYSTEM",
          kind: "entity",
          linkedEntities: [],
          projectId: "project-1",
          preview: {
            dropdown: "Dropdown preview",
            full: "Full preview",
          },
          previewText: "Full preview",
          priorityRank: 40,
          reports: [],
          source: "SYSTEM",
          timestamp: "2026-03-01T00:00:00.000Z",
          title: "Selected message activity",
          type: "NOTIFICATION",
        },
      ],
    } as ReturnType<typeof useCorrelatedActivity>);

    useAgentSessionsMock.mockReturnValue({
      agentSessions: [],
      error: null,
      isLoading: false,
    } as ReturnType<typeof useAgentSessions>);

    useTaskHierarchyMock.mockReturnValue({
      children: [],
      error: null,
      isLoading: false,
      parent: null,
    } as ReturnType<typeof useTaskHierarchy>);
  });

  it("loads detail mode activity by selected entity scope", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/projects/project-1/activity?entityType=MESSAGE&entityId=message-1",
        ]}
      >
        <Routes>
          <Route
            element={<ProjectActivityPage />}
            path="/projects/:projectId/activity"
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(useCorrelatedActivityMock).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        enabled: true,
        entityId: "message-1",
        entityType: EntityType.Message,
        limit: 200,
        view: "full",
      }),
    );

    expect(screen.getByText("Selected message activity")).toBeInTheDocument();
    expect(
      screen.queryByText(/No activity snapshot found for entity/i),
    ).not.toBeInTheDocument();
  });

  it("uses the paginated collection for the Coding Sessions activity mode", () => {
    localStorage.setItem("activity-mode", "CODING_SESSION");

    render(
      <MemoryRouter initialEntries={["/projects/project-1/activity"]}>
        <Routes>
          <Route
            element={<ProjectActivityPage />}
            path="/projects/:projectId/activity"
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.getByText("Paginated Coding Sessions Feed"),
    ).toBeInTheDocument();
    expect(paginatedCodingSessionsFeedMock).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, projectId: "project-1" }),
    );
  });

  it("uses the paginated collection for the Conversations activity mode", () => {
    localStorage.setItem("activity-mode", "AGENT_SESSION");

    render(
      <MemoryRouter initialEntries={["/projects/project-1/activity"]}>
        <Routes>
          <Route
            element={<ProjectActivityPage />}
            path="/projects/:projectId/activity"
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.getByText("Paginated conversations Feed"),
    ).toBeInTheDocument();
  });

  it("loads bookmarkable organization Activity filters without using project mode", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/organizations/org-1/activity?projectId=project-1&entityType=TASK&activityMode=ALL&since=2026-03-01T00%3A00%3A00.000Z&until=2026-03-02T00%3A00%3A00.000Z&limit=25&offset=10",
        ]}
      >
        <Routes>
          <Route
            element={<ProjectActivityPage />}
            path="/organizations/:organizationId/activity"
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Project Activity")).toBeInTheDocument();
    expect(useCorrelatedActivityMock).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        activityScope: "organization",
        projectId: "project-1",
        entityType: [EntityType.Task],
        activityMode: "ALL",
        since: "2026-03-01T00:00:00.000Z",
        until: "2026-03-02T00:00:00.000Z",
        limit: 25,
        offset: 10,
      }),
    );
    expect(crossProjectActivityFeedMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        query: expect.objectContaining({
          projectId: "project-1",
          offset: 10,
        }),
      }),
    );
  });

  it("names an explicitly project-scoped metric and preserves its query window", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/organizations/org-1/activity?viewScope=project&metric=TASK_COMPLETED&projectIds=project-1&projectIds=project-2&windowStart=2026-03-01T00%3A00%3A00.000Z&windowEnd=2026-03-02T00%3A00%3A00.000Z&actorScope=PERSONAL&actorUserId=user-1",
        ]}
      >
        <Routes>
          <Route
            element={<ProjectActivityPage />}
            path="/organizations/:organizationId/activity"
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Project Activity · Tasks Completed")).toBeInTheDocument();
    expect(screen.queryByText(/Metric evidence|Metric identity|TASK_COMPLETED/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Server-effective window/)).not.toBeInTheDocument();
    expect(crossProjectActivityFeedMock.mock.calls.at(-1)?.[0].query).not.toHaveProperty("viewScope");
    expect(useCorrelatedActivityMock).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        activityScope: "organization",
        metricContinuation: expect.objectContaining({
          metric: ProjectMetricIdentity.TaskCompleted,
          projectIds: ["project-1", "project-2"],
          windowStart: "2026-03-01T00:00:00.000Z",
          windowEnd: "2026-03-02T00:00:00.000Z",
          actorScope: { mode: "PERSONAL", userId: "user-1" },
        }),
      }),
    );
  });

  it("names an organization-wide metric without narrowing its query", () => {
    render(
      <MemoryRouter initialEntries={["/organizations/org-1/activity?metric=AGENT_SESSION_CREATED&projectIds=project-1&projectIds=project-2&windowStart=2026-03-01T00%3A00%3A00.000Z&windowEnd=2026-03-02T00%3A00%3A00.000Z&actorScope=PERSONAL&actorUserId=user-1"]}>
        <Routes>
          <Route element={<ProjectActivityPage />} path="/organizations/:organizationId/activity" />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Organization Activity · Agent Sessions Created")).toBeInTheDocument();
    expect(crossProjectActivityFeedMock.mock.calls.at(-1)?.[0].query.metricContinuation.projectIds).toEqual(["project-1", "project-2"]);
  });

  it("keeps organization scope when its continuation has one authorized project", () => {
    render(
      <MemoryRouter initialEntries={["/organizations/org-1/activity?metric=TASK_CREATED&projectIds=project-1&windowStart=2026-03-01T00%3A00%3A00.000Z&windowEnd=2026-03-02T00%3A00%3A00.000Z&actorScope=ORGANIZATION"]}>
        <Routes>
          <Route element={<ProjectActivityPage />} path="/organizations/:organizationId/activity" />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Organization Activity · Tasks Created")).toBeInTheDocument();
  });

  it("opens the source entity from organization history while retaining its metric page", () => {
    const originPath =
      "/organizations/org-1/activity?metric=TASK_COMPLETED&projectIds=project-2&projectIds=project-1&windowStart=2026-03-01T00%3A00%3A00.000Z&windowEnd=2026-03-02T00%3A00%3A00.000Z&actorScope=ORGANIZATION&offset=50";

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <Routes>
          <Route element={<OrganizationHomePage />} path="/home" />
          <Route
            element={<ProjectActivityPage />}
            path="/organizations/:organizationId/activity"
          />
          <Route
            element={<ProjectActivityPage />}
            path="/projects/:projectId/activities/:activityEntityRef"
          />
          <Route
            element={<ProjectActivityPage />}
            path="/projects/:projectId/activity"
          />
          <Route element={<div>Task destination</div>} path="/projects/:projectId/tasks/:taskId" />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("organization-home-metric"));
    fireEvent.click(screen.getByTestId("cross-project-activity-next-page"));

    expect(screen.getByText("Organization Activity · Tasks Completed")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(originPath);

    fireEvent.click(screen.getByTestId("cross-project-activity-open-entity"));

    expect(screen.getByTestId("location")).toHaveTextContent("/projects/project-2/tasks/task-1");
    expect(useCorrelatedActivityMock).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        activityScope: "organization",
        metricContinuation: expect.objectContaining({
          metric: ProjectMetricIdentity.TaskCompleted,
          projectIds: ["project-2", "project-1"],
          windowStart: "2026-03-01T00:00:00.000Z",
          windowEnd: "2026-03-02T00:00:00.000Z",
        }),
        offset: 50,
      }),
    );
  });

  it("opens a project history row at its source href", () => {
    render(<MemoryRouter initialEntries={["/projects/project-1/activity"]}>
      <Routes>
        <Route element={<ProjectActivityPage />} path="/projects/:projectId/activity" />
        <Route element={<div>Task destination</div>} path="/projects/:projectId/tasks/:taskId" />
      </Routes>
      <LocationProbe />
    </MemoryRouter>);
    fireEvent.click(screen.getByTestId("project-activity-open-entity"));
    expect(screen.getByTestId("location")).toHaveTextContent("/projects/project-2/tasks/task-1");
  });

  it("keeps the existing project Activity fallback for direct detail entry", () => {
    render(
      <MemoryRouter
        initialEntries={["/projects/project-1/activities/TASK-task-1"]}
      >
        <Routes>
          <Route
            element={<ProjectActivityPage />}
            path="/projects/:projectId/activities/:activityEntityRef"
          />
          <Route
            element={<ProjectActivityPage />}
            path="/projects/:projectId/activity"
          />
        </Routes>
        <LocationProbe />
      </MemoryRouter>,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Back to Activity List" }),
    );

    expect(screen.getByText("Project Activity")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/activity",
    );
  });

  it("renders a validation state for unsupported organization Activity filters", () => {
    render(
      <MemoryRouter
        initialEntries={["/organizations/org-1/activity?activityMode=INVALID"]}
      >
        <Routes>
          <Route
            element={<ProjectActivityPage />}
            path="/organizations/:organizationId/activity"
          />
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.getByTestId("organization-activity-invalid-query"),
    ).toHaveTextContent("Unsupported activityMode filter");
    expect(useCorrelatedActivityMock).toHaveBeenCalledWith(
      "org-1",
      expect.objectContaining({
        activityScope: "organization",
        enabled: false,
      }),
    );
  });
  it("applies period edits as separate history, resets pagination, and restores the URL query", () => {
    const projectId = "550e8400-e29b-41d4-a716-446655440001";
    render(
      <MemoryRouter
        initialEntries={[
          "/organizations/org-1/activity?metric=TASK_COMPLETED&projectIds=" +
            projectId +
            "&windowStart=2026-03-01T00%3A00%3A00.000Z&windowEnd=2026-03-02T00%3A00%3A00.000Z&actorScope=ORGANIZATION&offset=50&viewScope=project",
        ]}
      >
        <LocationProbe />
        <Routes>
          <Route
            element={<ProjectActivityPage />}
            path="/organizations/:organizationId/activity"
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      crossProjectActivityFeedMock.mock.calls.at(-1)?.[0].query
        .metricContinuation.projectIds,
    ).toEqual([projectId]);
    expect(screen.getByText("Project Activity · Tasks Completed")).toBeInTheDocument();
    fireEvent.change(screen.getByTestId("activity-history-end"), {
      target: { value: "2026-03-04T12:00" },
    });
    fireEvent.click(screen.getByTestId("activity-history-apply"));
    const query = crossProjectActivityFeedMock.mock.calls.at(-1)?.[0].query;
    expect(query).toEqual(
      expect.objectContaining({
        historyFilter: {
          metric: ProjectMetricIdentity.TaskCompleted,
          projectIds: [projectId],
          windowStart: "2026-03-01T00:00:00.000Z",
          windowEnd: new Date("2026-03-04T12:00").toISOString(),
        },
        offset: 0,
      }),
    );
    expect(query.metricContinuation).toBeUndefined();
    expect(screen.getByText("Project Activity · Tasks Completed")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("viewScope=project");
    expect(
      screen.queryByTestId("organization-activity-metric-summary"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/do not represent the original chart count/),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("cross-project-activity-next-page"));
    expect(crossProjectActivityFeedMock.mock.calls.at(-1)?.[0].query).toEqual({
      ...query,
      offset: 50,
    });
    const url = new URL(
      screen.getByTestId("location").textContent!,
      "https://example.test",
    );
    expect(parseOrganizationActivityQuery(url.searchParams)).toEqual({
      kind: "valid",
      query: { ...query, offset: 50 },
      viewScope: "project",
    });
    fireEvent.change(screen.getByTestId("activity-history-end"), {
      target: { value: "2026-03-05T12:00" },
    });
    fireEvent.click(screen.getByTestId("activity-history-apply"));
    expect(
      crossProjectActivityFeedMock.mock.calls.at(-1)?.[0].query.offset,
    ).toBe(0);
  });
});
