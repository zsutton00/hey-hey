import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { TaskSource, WorkStatus } from "@hey-hey/ui-common/api";
import type { PlanWorkItem } from "@hey-hey/ui-common/data";
import { PlanSummaryList } from "./PlanSummaryList";
const plan: PlanWorkItem = {
  id: "plan-1",
  name: "Draft rollout",
  type: "PLAN",
  organizationId: "org-1",
  projectId: "project-1",
  status: WorkStatus.Backlog,
  source: TaskSource.System,
};
describe("PlanSummaryList draft presentation", () => {
  it("labels BACKLOG as Draft and retains canonical Plan navigation", () => {
    render(
      <MemoryRouter>
        <PlanSummaryList projectId="project-1" plans={[plan]} />
      </MemoryRouter>
    );
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.queryByText("BACKLOG")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Draft rollout/ })).toHaveAttribute(
      "href",
      "/projects/project-1/plans/plan-1"
    );
  });
  it("keeps an execution-ready Plan labeled Ready", () => {
    render(
      <MemoryRouter>
        <PlanSummaryList
          projectId="project-1"
          plans={[{ ...plan, status: WorkStatus.Ready }]}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("Ready")).toBeInTheDocument();
    expect(screen.queryByText("Draft")).not.toBeInTheDocument();
  });
});
