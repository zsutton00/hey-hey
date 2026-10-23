import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { EntityType } from "../../../api";
import { ActivityGraphLayout } from "../ActivityGraphLayout";
import {
  ActivityGanttDerivedEntityType,
  ActivityGanttEntityStatus,
  ActivityGanttLaneRole,
  ActivityGanttOverallStatus,
  ActivityGanttRelationshipType,
  ActivityGanttViewMode,
  toActivityGanttEntityId,
  type ActivityGanttChartData,
} from "../activityGanttPrimitives";

vi.mock("../../../contexts/OrganizationContext", () => ({
  useOrganization: () => ({
    currentOrganization: { id: "test-org-id" },
  }),
}));

beforeAll(() => {
  global.ResizeObserver = vi.fn().mockImplementation(() => ({
    observe: vi.fn(),
    unobserve: vi.fn(),
    disconnect: vi.fn(),
  }));
});

const chartDataFixture: ActivityGanttChartData = {
  parentTasks: [
    {
      id: toActivityGanttEntityId("parent-task-1"),
      entityType: EntityType.Task,
      entityId: "parent-task-1",
      title: "Parent Task",
      status: ActivityGanttEntityStatus.Completed,
      timeContext: "3/2/2026, 9:00:00 AM",
      durationLabel: "Reference 3/2/2026, 9:00:00 AM",
      detailText: null,
      laneRole: ActivityGanttLaneRole.ParentTasks,
      progress: null,
    },
  ],
  currentWork: [
    {
      id: toActivityGanttEntityId("current-task-1"),
      entityType: EntityType.Task,
      entityId: "current-task-1",
      title: "Current Task",
      status: ActivityGanttEntityStatus.InProgress,
      timeContext: "3/2/2026, 10:00:00 AM",
      durationLabel: "Updated 3/2/2026, 10:00:00 AM",
      detailText: null,
      laneRole: ActivityGanttLaneRole.CurrentWork,
      progress: {
        completedUnits: 5,
        totalUnits: 10,
      },
    },
  ],
  activeSessions: [
    {
      id: toActivityGanttEntityId("session-1"),
      entityType: EntityType.AgentSession,
      entityId: "session-1",
      title: "Coding Session",
      status: ActivityGanttEntityStatus.Active,
      timeContext: "3/2/2026, 10:05:00 AM",
      durationLabel: "Updated 3/2/2026, 10:05:00 AM",
      detailText: null,
      laneRole: ActivityGanttLaneRole.ActiveSessions,
      progress: null,
    },
  ],
  subtasks: [
    {
      id: toActivityGanttEntityId("subtask-1"),
      entityType: EntityType.Task,
      entityId: "subtask-1",
      title: "Subtask",
      status: ActivityGanttEntityStatus.Blocked,
      timeContext: "3/2/2026, 10:10:00 AM",
      durationLabel: "Updated 3/2/2026, 10:10:00 AM",
      detailText: null,
      laneRole: ActivityGanttLaneRole.Subtasks,
      progress: {
        completedUnits: 3,
        totalUnits: 10,
      },
    },
  ],
  reports: [
    {
      id: toActivityGanttEntityId("report-1"),
      entityType: ActivityGanttDerivedEntityType.Report,
      entityId: "report-1",
      title: "Final Recommendations",
      status: ActivityGanttEntityStatus.Completed,
      timeContext: "3/2/2026, 11:00:00 AM",
      durationLabel: "Created 3/2/2026, 11:00:00 AM",
      detailText: null,
      laneRole: ActivityGanttLaneRole.Reports,
      progress: null,
    },
  ],
  verificationRecommendations: [
    {
      id: toActivityGanttEntityId("verification-1"),
      entityType: ActivityGanttDerivedEntityType.VerificationRecommendation,
      entityId: "verification-1",
      title: "Run regression suite",
      status: ActivityGanttEntityStatus.NotStarted,
      timeContext: "3/2/2026, 11:00:00 AM",
      durationLabel: "Captured 3/2/2026, 11:00:00 AM",
      detailText: "Validate all auth flows",
      laneRole: ActivityGanttLaneRole.Verification,
      progress: null,
    },
  ],
  breadcrumbs: [],
  blockingRelationships: [
    {
      sourceId: toActivityGanttEntityId("subtask-1"),
      targetId: toActivityGanttEntityId("current-task-1"),
      type: ActivityGanttRelationshipType.Blocking,
    },
    {
      sourceId: toActivityGanttEntityId("current-task-1"),
      targetId: toActivityGanttEntityId("session-1"),
      type: ActivityGanttRelationshipType.Concurrent,
    },
    {
      sourceId: toActivityGanttEntityId("session-1"),
      targetId: toActivityGanttEntityId("report-1"),
      type: ActivityGanttRelationshipType.Report,
    },
  ],
  timeContext: "3/2/2026, 10:00:00 AM",
  status: ActivityGanttOverallStatus.InFlight,
};

describe("ActivityGraphLayout", () => {
  it("renders the graph container and entity cards", () => {
    render(<ActivityGraphLayout {...chartDataFixture} />);

    expect(
      screen.getByTestId("activity-gantt-layout-graph")
    ).toBeInTheDocument();

    expect(
      screen.getByTestId("activity-gantt-entity-card-parent-task-1")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("activity-gantt-entity-card-current-task-1")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("activity-gantt-entity-card-session-1")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("activity-gantt-entity-card-subtask-1")
    ).toBeInTheDocument();
  });

  it("renders footer with reports and verification", () => {
    render(<ActivityGraphLayout {...chartDataFixture} />);

    expect(
      screen.getByTestId("activity-gantt-layout-footer")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("activity-gantt-layout-lane-reports")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("activity-gantt-layout-lane-verification")
    ).toBeInTheDocument();

    expect(
      screen.getByTestId("activity-gantt-entity-card-verification-1-detail")
    ).toHaveTextContent("Validate all auth flows");
  });

  it("renders compact view with only the focal card", () => {
    render(
      <ActivityGraphLayout
        {...chartDataFixture}
        view={ActivityGanttViewMode.Compact}
      />
    );

    expect(
      screen.getByTestId("activity-gantt-entity-card-current-task-1")
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("activity-gantt-layout-graph")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("activity-gantt-layout-lane-reports")
    ).not.toBeInTheDocument();
  });

  it("renders empty state when no entities are present", () => {
    render(
      <ActivityGraphLayout
        activeSessions={[]}
        blockingRelationships={[]}
        breadcrumbs={[]}
        currentWork={[]}
        parentTasks={[]}
        reports={[]}
        status={ActivityGanttOverallStatus.Ready}
        subtasks={[]}
        timeContext="now"
        verificationRecommendations={[]}
      />
    );

    expect(screen.getByTestId("activity-gantt-layout-empty")).toHaveTextContent(
      "No related entities"
    );
  });
});
