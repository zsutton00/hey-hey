import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentEdgeType, TaskSource, WorkStatus } from "../../api";
import type {
  PlanStageStandardTask,
  PlanStageWorkItem,
} from "../../data/plans/canonicalPlan";
import { PlanStageStepperCard } from "./PlanStageStepperCard";
import { PlanStageStepsList } from "./PlanStageStepsList";

vi.mock("../InteractionComponent", () => ({
  InteractionComponent: ({
    entityId,
    entitySubtype,
    children,
  }: {
    entityId: string;
    entitySubtype?: string;
    children: React.ReactNode;
  }) => (
    <div
      data-testid="stage-interaction"
      data-entity-id={entityId}
      data-entity-subtype={entitySubtype}
    >
      {children}
    </div>
  ),
}));

const stage: PlanStageWorkItem = {
  id: "stage-1",
  name: "Build release flow",
  type: "PLAN_STAGE",
  parentTaskId: "plan-1",
  organizationId: "org-1",
  projectId: "project-1",
  status: WorkStatus.Active,
  source: TaskSource.System,
  sections: [
    {
      id: "stage-description",
      key: "description",
      order: 0,
      materializedMarkdown: "Ship the first vertical slice.",
    },
  ],
};

const buildTask = (
  id: string,
  name: string,
  overrides: Partial<PlanStageStandardTask> = {}
): PlanStageStandardTask => ({
  id,
  name,
  type: "STANDARD",
  parentTaskId: stage.id,
  organizationId: stage.organizationId,
  projectId: stage.projectId,
  status: WorkStatus.Backlog,
  source: TaskSource.System,
  ...overrides,
});

describe("canonical Plan presentation", () => {
  it("renders a Plan Stage and previews its canonical Standard Task", () => {
    const task = buildTask("task-1", "Implement API");

    render(
      <PlanStageStepperCard
        stage={stage}
        isActive
        isSelected
        previewTask={task}
        previewLabel="Next task"
        totalTasks={2}
        completedTasks={1}
      />
    );

    expect(screen.getByText(stage.name)).toBeInTheDocument();
    expect(screen.getByText("Implement API")).toBeInTheDocument();
    expect(screen.getByText("1/2 tasks completed")).toBeInTheDocument();
    expect(screen.getByTestId("stage-interaction")).toHaveAttribute(
      "data-entity-subtype",
      "PLAN_STAGE"
    );
  });

  it("shows dependency relationships between canonical Standard Tasks", () => {
    const prerequisite = buildTask("task-1", "Implement API");
    const dependent = buildTask("task-2", "Connect UI", {
      edges: [
        {
          id: "edge-1",
          type: AgentEdgeType.DependsOn,
          sourceNodeId: "task-2",
          targetNodeId: "task-1",
        },
      ],
    });
    const onTaskClick = vi.fn();

    render(
      <PlanStageStepsList
        stage={stage}
        tasks={[prerequisite, dependent]}
        onTaskClick={onTaskClick}
      />
    );

    expect(screen.getByText("Depends on Implement API")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Connect UI"));
    expect(onTaskClick).toHaveBeenCalledWith(dependent);
  });

  it("fails closed when a Task is not a direct child of the Stage", () => {
    render(
      <PlanStageStepsList
        stage={stage}
        tasks={[
          buildTask("task-1", "Misparented task", {
            parentTaskId: "another-stage",
          }),
        ]}
      />
    );

    expect(screen.getByTestId("plan-stage-task-list-error")).toHaveTextContent(
      "invalid ancestry"
    );
    expect(screen.queryByTestId("plan-stage-task-card")).toBeNull();
  });
});
