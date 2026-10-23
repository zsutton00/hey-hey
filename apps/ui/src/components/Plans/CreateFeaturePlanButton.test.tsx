import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { CreateFeaturePlanButton } from "./CreateFeaturePlanButton";
const createTask = vi.hoisted(() => vi.fn());
vi.mock("@hey-hey/ui-common/data", () => ({
  useWorkItemTypeByKey: () => ({ workItemTypeDefinition: undefined }),
  useWorkItemUpdateMethods: () => ({ createTask }),
  isPlanWorkItem: (item: { type: string; parentTaskId?: string }) =>
    item.type === "PLAN" && Boolean(item.parentTaskId),
}));
const Location = () => {
  const location = useLocation();
  return <output data-testid="location">{location.pathname}</output>;
};
const renderButton = () =>
  render(
    <MemoryRouter>
      <Location />
      <CreateFeaturePlanButton
        organizationId="org-1"
        projectId="project-1"
        featureId="feature-1"
      />
    </MemoryRouter>,
  );
beforeEach(() => vi.clearAllMocks());
it("creates a generic PLAN under the selected Feature with authored outcome and configuration", async () => {
  createTask.mockResolvedValue({
    id: "plan-1",
    type: "PLAN",
    parentTaskId: "feature-1",
  });
  renderButton();
  await userEvent.click(screen.getByRole("button", { name: "Create Plan" }));
  expect(
    screen.getByRole("button", { name: "Create", exact: true }),
  ).toBeDisabled();
  await userEvent.type(screen.getByLabelText(/Plan name/), "Ship auth");
  await userEvent.type(
    screen.getByLabelText(/Desired outcome/),
    "Users can sign in",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Create", exact: true }),
  );
  expect(createTask).toHaveBeenCalledWith({
    name: "Ship auth",
    type: "PLAN",
    parentTaskId: "feature-1",
    status: "BACKLOG",
    source: "user",
    sections: [
      { key: "outcome", content: "Users can sign in" },
      {
        key: "planConfiguration",
        content: {
          schemaVersion: "plan-configuration.v1",
          planType: "STANDARD",
          worktreeBranch: null,
        },
      },
    ],
  });
  await waitFor(() =>
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/project-1/plans/plan-1",
    ),
  );
});
it("keeps authored data available when creation fails", async () => {
  createTask.mockRejectedValue(new Error("Creation denied"));
  renderButton();
  await userEvent.click(screen.getByRole("button", { name: "Create Plan" }));
  await userEvent.type(screen.getByLabelText(/Plan name/), "Ship auth");
  await userEvent.type(
    screen.getByLabelText(/Desired outcome/),
    "Users can sign in",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Create", exact: true }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Creation denied");
  expect(screen.getByLabelText(/Plan name/)).toHaveValue("Ship auth");
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});
