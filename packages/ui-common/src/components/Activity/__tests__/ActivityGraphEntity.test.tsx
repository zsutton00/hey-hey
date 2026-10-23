import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const canHoverState = { value: true };

vi.mock("../../../hooks/useCanHover", () => ({
  useCanHover: () => canHoverState.value,
}));

vi.mock("../../shared/EntityHoverCard", () => ({
  EntityHoverCard: () => <div data-testid="entity-hover-card-mock" />,
}));

vi.mock("../../../contexts/OrganizationContext", () => ({
  useOrganization: () => ({
    currentOrganization: { id: "test-org-id" },
  }),
}));
import { PathServiceProvider } from "../../../contexts/PathServiceContext";
import { getPathService, type PathService } from "../../../services";
import { EntityType } from "../../../api";
import { ActivityGraphEntity } from "../ActivityGraphEntity";
import {
  ActivityGanttEntityStatus,
  ActivityGanttLaneRole,
  ActivityGanttRelationshipType,
  ActivityGanttViewMode,
  toActivityGanttEntityId,
} from "../activityGanttPrimitives";

describe("ActivityGraphEntity", () => {
  beforeEach(() => {
    canHoverState.value = true;
  });

  const renderEntity = (ui: ReactElement) =>
    render(<MemoryRouter>{ui}</MemoryRouter>);

  it("renders progress and relationship signals in full view", () => {
    renderEntity(
      <ActivityGraphEntity
        entity={{
          id: toActivityGanttEntityId("current-work-task-1"),
          entityType: EntityType.Task,
          entityId: "task-1",
          title: "Current Task",
          status: ActivityGanttEntityStatus.InProgress,
          timeContext: "3/2/2026, 10:00:00 AM",
          durationLabel: "Updated 3/2/2026, 10:00:00 AM",
          detailText: "Waiting on API response",
          laneRole: ActivityGanttLaneRole.CurrentWork,
          progress: {
            completedUnits: 5,
            totalUnits: 10,
          },
        }}
        signals={[
          ActivityGanttRelationshipType.Blocking,
          ActivityGanttRelationshipType.Concurrent,
        ]}
      />
    );

    expect(
      screen.getByTestId(
        "activity-gantt-entity-card-current-work-task-1-status"
      )
    ).toHaveTextContent("In Progress");
    expect(
      screen.getByTestId(
        "activity-gantt-entity-card-current-work-task-1-signal-BLOCKING"
      )
    ).toHaveTextContent("Blocking");
    expect(
      screen.getByTestId(
        "activity-gantt-entity-card-current-work-task-1-signal-CONCURRENT"
      )
    ).toHaveTextContent("Concurrent");
    expect(
      screen.getByTestId(
        "activity-gantt-entity-card-current-work-task-1-duration"
      )
    ).toHaveTextContent("Updated 3/2/2026, 10:00:00 AM");
    expect(
      screen.getByTestId(
        "activity-gantt-entity-card-current-work-task-1-detail"
      )
    ).toHaveTextContent("Waiting on API response");
  });

  it("renders emphasis styling with status metadata", () => {
    renderEntity(
      <ActivityGraphEntity
        emphasis
        entity={{
          id: toActivityGanttEntityId("focal-task-1"),
          entityType: EntityType.Task,
          entityId: "task-focal-1",
          title: "Focal Task",
          status: ActivityGanttEntityStatus.Active,
          timeContext: "3/2/2026, 10:00:00 AM",
          durationLabel: "Updated 3/2/2026, 10:00:00 AM",
          detailText: null,
          laneRole: ActivityGanttLaneRole.CurrentWork,
          progress: null,
        }}
      />
    );

    expect(
      screen.getByTestId("activity-gantt-entity-card-focal-task-1-status")
    ).toHaveTextContent("Active");

    const card = screen.getByTestId("activity-gantt-entity-card-focal-task-1");
    expect(card).toBeInTheDocument();
  });

  it("hides timing metadata in compact view", () => {
    renderEntity(
      <ActivityGraphEntity
        entity={{
          id: toActivityGanttEntityId("parent-task-1"),
          entityType: EntityType.Task,
          entityId: "task-parent-1",
          title: "Parent task",
          status: ActivityGanttEntityStatus.Completed,
          timeContext: "3/2/2026, 9:00:00 AM",
          durationLabel: "Reference 3/2/2026, 9:00:00 AM",
          detailText: null,
          laneRole: ActivityGanttLaneRole.ParentTasks,
          progress: null,
        }}
        view={ActivityGanttViewMode.Compact}
      />
    );

    expect(
      screen.queryByTestId("activity-gantt-entity-card-parent-task-1-duration")
    ).not.toBeInTheDocument();
  });

  it("renders plan-scoped task cards as links", () => {
    const basePathService = getPathService();
    const pathService: PathService = {
      ...basePathService,
      planTask: ({ planId, taskId }) => `/custom/plan-task/${planId}/${taskId}`,
    };

    render(
      <MemoryRouter>
        <PathServiceProvider pathService={pathService}>
          <ActivityGraphEntity
            entity={{
              id: toActivityGanttEntityId("parent-task-1"),
              entityType: EntityType.Task,
              entityId: "task-parent-1",
              title: "Parent task",
              status: ActivityGanttEntityStatus.Completed,
              timeContext: "3/2/2026, 9:00:00 AM",
              durationLabel: "Reference 3/2/2026, 9:00:00 AM",
              detailText: null,
              laneRole: ActivityGanttLaneRole.Subtasks,
              progress: null,
            }}
            planScope={{
              planId: "plan-1",
              stageId: "stage-1",
              stepId: "step-1",
            }}
            projectId="project-1"
          />
        </PathServiceProvider>
      </MemoryRouter>
    );

    expect(
      screen.getByTestId("activity-gantt-entity-card-parent-task-1")
    ).toHaveAttribute("href", "/custom/plan-task/plan-1/task-parent-1");
  });

  it("opens the hover preview on hover when the device supports hover", () => {
    vi.useFakeTimers();

    renderEntity(
      <ActivityGraphEntity
        entity={{
          id: toActivityGanttEntityId("hover-task-desktop"),
          entityType: EntityType.Task,
          entityId: "task-hover-desktop",
          title: "Hover Task",
          status: ActivityGanttEntityStatus.InProgress,
          timeContext: "3/2/2026, 10:00:00 AM",
          durationLabel: "Updated 3/2/2026, 10:00:00 AM",
          detailText: null,
          laneRole: ActivityGanttLaneRole.CurrentWork,
          progress: null,
        }}
      />
    );

    fireEvent.mouseEnter(
      screen.getByTestId("activity-gantt-entity-card-hover-task-desktop")
    );

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(screen.getByTestId("entity-hover-card-mock")).toBeInTheDocument();
    vi.useRealTimers();
  });

  it("suppresses the hover preview on touch devices", () => {
    vi.useFakeTimers();
    canHoverState.value = false;

    renderEntity(
      <ActivityGraphEntity
        entity={{
          id: toActivityGanttEntityId("hover-task-touch"),
          entityType: EntityType.Task,
          entityId: "task-hover-touch",
          title: "Hover Task",
          status: ActivityGanttEntityStatus.InProgress,
          timeContext: "3/2/2026, 10:00:00 AM",
          durationLabel: "Updated 3/2/2026, 10:00:00 AM",
          detailText: null,
          laneRole: ActivityGanttLaneRole.CurrentWork,
          progress: null,
        }}
      />
    );

    fireEvent.mouseEnter(
      screen.getByTestId("activity-gantt-entity-card-hover-task-touch")
    );

    act(() => {
      vi.advanceTimersByTime(600);
    });

    expect(
      screen.queryByTestId("entity-hover-card-mock")
    ).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
