import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { EntityType, GoalAudience } from "../../api";
import { GoalPickerModal } from "./GoalPickerModal";

const { attach, fetchGoals } = vi.hoisted(() => ({
  attach: vi.fn().mockResolvedValue(undefined),
  fetchGoals: vi.fn(),
}));
vi.mock("../../data/hooks/useActiveGoals", () => ({
  useActiveGoals: () => ({
    data: [
      {
        id: "goal",
        name: "Undated outcome",
        dueDate: null,
        audience: GoalAudience.Project,
      },
    ],
    isLoading: false,
    error: null,
    fetch: fetchGoals,
  }),
}));
vi.mock("../../data/hooks/useAttachToGoal", () => ({
  useAttachToGoal: () => ({ attach, isLoading: false, error: null }),
}));
vi.mock("../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeTrackingEligibility: () => ({
    isReady: true,
    isAllowed: true,
    error: null,
  }),
}));

it("keeps undated Goals selectable and attaches work to the selected Goal", async () => {
  const onClose = vi.fn();
  render(
    <GoalPickerModal
      open
      onClose={onClose}
      organizationId="org"
      projectId="project"
      targetEntityId="task"
      targetEntityType={EntityType.Task}
      targetTaskType="STANDARD"
    />,
  );
  expect(screen.getByText("No target date")).toBeInTheDocument();
  await userEvent.click(screen.getByText("Undated outcome"));
  await userEvent.click(screen.getByRole("button", { name: "Add to Goal" }));
  await waitFor(() =>
    expect(attach).toHaveBeenCalledWith({
      goalId: "goal",
      targetEntityId: "task",
      targetEntityType: EntityType.Task,
    }),
  );
  expect(onClose).toHaveBeenCalledOnce();
});
