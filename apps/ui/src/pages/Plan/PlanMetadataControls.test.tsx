import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { TaskSource, WorkStatus } from "@hey-hey/ui-common/api";
import { PlanMetadataControls } from "./PlanMetadataControls";
const updatePlan = vi.hoisted(() => vi.fn());
vi.mock("@hey-hey/ui-common/data", () => ({
  useCanonicalPlanMutations: () => ({ updatePlan }),
}));
vi.mock("@hey-hey/ui-common/components", () => ({
  WorkItemMetadata: ({
    fields,
    disabled,
  }: {
    fields: { status: { onChange?: (status: string) => void } };
    disabled: boolean;
  }) => (
    <button
      disabled={disabled}
      onClick={() => fields.status.onChange?.("ACTIVE")}
    >
      Activate
    </button>
  ),
}));
const plan = {
  id: "plan-1",
  type: "PLAN" as const,
  name: "Plan",
  parentTaskId: "feature-1",
  organizationId: "org-1",
  projectId: "project-1",
  status: WorkStatus.Ready,
  source: TaskSource.User,
};
it("shows pending approval instead of claiming a status change was applied", async () => {
  updatePlan.mockResolvedValue({ status: "pending", plan });
  render(<PlanMetadataControls plan={plan} />);
  await userEvent.click(screen.getByRole("button", { name: "Activate" }));
  expect(updatePlan).toHaveBeenCalledWith("plan-1", { status: "ACTIVE" });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "awaiting proposal approval"
  );
});
it("shows failed mutations and allows another attempt", async () => {
  updatePlan.mockRejectedValue(new Error("Cannot activate"));
  render(<PlanMetadataControls plan={plan} />);
  await userEvent.click(screen.getByRole("button", { name: "Activate" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Cannot activate");
  expect(screen.getByRole("button", { name: "Activate" })).toBeEnabled();
});
