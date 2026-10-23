import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { PlanStepPage } from "./PlanStepPage";
const taskPage = vi.hoisted(() => vi.fn());
vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org-1" }),
}));
vi.mock("../Task/TaskPage", () => ({
  TaskPage: (props: unknown) => {
    taskPage(props);
    return <div>Canonical implementation Task</div>;
  },
}));
describe("canonical Plan Step route", () => {
  it("opens the implementation Task using the canonical route identity", () => {
    render(
      <MemoryRouter
        initialEntries={[
          "/projects/project-1/plans/plan-task/stages/stage-task/steps/implementation-task",
        ]}
      >
        <Routes>
          <Route
            path="/projects/:projectId/plans/:planId/stages/:stageId/steps/:stepId"
            element={<PlanStepPage />}
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(
      screen.getByText("Canonical implementation Task"),
    ).toBeInTheDocument();
    expect(taskPage).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      taskId: "implementation-task",
    });
  });
});
