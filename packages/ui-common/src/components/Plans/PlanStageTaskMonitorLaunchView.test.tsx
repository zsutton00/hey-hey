import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createTaskMonitorDefinition } from "../TaskMonitor/__tests__/taskMonitorTestFixtures";
import { PreviewHostProvider } from "../../contexts/PreviewHostContext";
import type { PlanStageTaskMonitorSetupDraft } from "./planStageTaskMonitorSetup";
import { PlanStageTaskMonitorLaunchView } from "./PlanStageTaskMonitorLaunchView";

const createDraft = (): PlanStageTaskMonitorSetupDraft => {
  const definition = createTaskMonitorDefinition();
  return {
    definition,
    provenance: {
      organizationId: "org-1",
      projectId: "project-1",
      planId: "plan-1",
      planWorktreeBranch: null,
      planParentTaskId: "feature-1",
      planLabel: "Feature delivery",
      stageId: "stage-1",
      stageLabel: "Build the feature",
      preparedAt: "2026-07-14T01:02:03.000Z",
    },
    executableTasks: [
      {
        taskId: definition.executionPlan[0].taskId,
        label: "Implement the feature",
        description: "Build the feature.",
        serviceIds: ["service-1"],
      },
    ],
  };
};

describe("PlanStageTaskMonitorLaunchView", () => {
  it("renders explicit read-error, invalid-source, and empty states", () => {
    const onContinue = vi.fn();

    const { rerender } = render(
      <PlanStageTaskMonitorLaunchView
        state={{ status: "read-error", message: "Read failed" }}
        onContinue={onContinue}
      />
    );
    expect(
      screen.getByTestId("plan-stage-task-monitor-read-error")
    ).toHaveTextContent("Read failed");

    rerender(
      <PlanStageTaskMonitorLaunchView
        state={{ status: "invalid-source", messages: ["Stage mismatch"] }}
        onContinue={onContinue}
      />
    );
    expect(
      screen.getByTestId("plan-stage-task-monitor-invalid-source")
    ).toHaveTextContent("Stage mismatch");

    rerender(
      <PlanStageTaskMonitorLaunchView
        state={{
          status: "no-executable-work",
          messages: ["No executable work"],
        }}
        onContinue={onContinue}
      />
    );
    expect(
      screen.getByTestId("plan-stage-task-monitor-no-executable-work")
    ).toHaveTextContent("No executable work");
  });

  it("renders the reviewable draft and forwards continuation", () => {
    const onContinue = vi.fn();
    const openPreview = vi.fn();
    const draft = createDraft();

    render(
      <PreviewHostProvider host={{ openPreview }}>
        <PlanStageTaskMonitorLaunchView
          state={{ status: "ready", draft }}
          onContinue={onContinue}
        />
      </PreviewHostProvider>
    );

    expect(
      screen.getByTestId("plan-stage-task-monitor-provenance")
    ).toHaveTextContent("Feature delivery · Build the feature");
    expect(
      screen.getByTestId("plan-stage-task-monitor-execution-visualization")
    ).toHaveTextContent("Implement the feature");
    expect(
      screen.getByTestId("plan-stage-task-monitor-execution-visualization")
    ).toHaveTextContent("Build the feature.");
    expect(screen.getByText("Tasks to execute")).toBeInTheDocument();
    expect(screen.queryByText("Guidance references")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("plan-stage-task-monitor-supporting-evidence")
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("plan-stage-task-monitor-task-preview"));
    expect(openPreview).toHaveBeenCalledWith({
      entityType: "task",
      entityId: draft.definition.executionPlan[0].taskId,
    });

    fireEvent.click(screen.getByTestId("plan-stage-task-monitor-continue"));
    expect(onContinue).toHaveBeenCalledWith(draft);
  });
});
