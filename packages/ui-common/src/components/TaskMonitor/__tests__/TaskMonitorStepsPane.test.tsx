import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkStatus } from "../../../api";
import { TaskMonitorStepsPane } from "../TaskMonitorStepsPane";
import type { TaskMonitorProjectedNode } from "../useTaskMonitorProjection";
import {
  createTask,
  firstTaskId,
  secondTaskId,
} from "./taskMonitorTestFixtures";

const nodes: readonly TaskMonitorProjectedNode[] = [
  {
    position: 0,
    taskId: firstTaskId,
    dependsOnTaskIds: [],
    isCursor: false,
    task: {
      kind: "loaded",
      task: {
        ...createTask(firstTaskId, "Prepare release", WorkStatus.Completed),
        dueDate: "2026-09-01T12:00:00.000Z",
      },
    },
    session: { kind: "none" },
    visualStatus: "completed",
    launchConfiguration: {
      method: "quick",
      provider: "codex",
      model: "gpt-5.5",
      reasoningEffort: "high",
    },
  },
  {
    position: 1,
    taskId: secondTaskId,
    dependsOnTaskIds: [firstTaskId],
    isCursor: true,
    task: {
      kind: "loaded",
      task: createTask(secondTaskId, "Ship release", WorkStatus.Active),
    },
    session: { kind: "none" },
    visualStatus: "active",
    launchConfiguration: {
      method: "quick",
      provider: "codex",
      model: "gpt-5.5",
      reasoningEffort: "high",
    },
  },
];

describe("TaskMonitorStepsPane", () => {
  it("renders canonical order, ordinals, available metadata, and active state", () => {
    render(
      <TaskMonitorStepsPane
        nodes={nodes}
        projectId="project-1"
        selectedTaskId={secondTaskId}
        onSelectTask={vi.fn()}
      />
    );

    expect(screen.getByLabelText("Step 1")).toHaveTextContent("1");
    expect(screen.getByLabelText("Step 2")).toHaveTextContent("2");
    for (const stepNumber of screen.getAllByTestId("task-monitor-step-number")) {
      expect(stepNumber).toHaveStyle({
        position: "absolute",
        top: "-10px",
        left: "-10px",
        width: "24px",
        height: "24px",
        borderRadius: "50%",
      });
    }
    expect(screen.getByText("Prepare release")).toBeVisible();
    expect(screen.getByText("Ship release")).toBeVisible();
    expect(screen.getByLabelText("dueDate: Sep 1, 2026")).toBeVisible();
    expect(screen.getByTestId("task-monitor-active-step")).toBeVisible();
  });

  it("selects a loaded canonical task without navigating away", async () => {
    const user = userEvent.setup();
    const onSelectTask = vi.fn();
    render(
      <TaskMonitorStepsPane
        nodes={nodes}
        projectId="project-1"
        selectedTaskId={secondTaskId}
        onSelectTask={onSelectTask}
      />
    );

    await user.click(screen.getByText("Prepare release"));

    expect(onSelectTask).toHaveBeenCalledWith(firstTaskId);
  });
});
