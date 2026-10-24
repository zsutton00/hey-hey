import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsAdapter } from "nuqs/adapters/react-router";
import React from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ProjectAgentsTab } from "./ProjectAgentsTab";
import { TaskRouter } from "../Task/TaskRouter";

const mocks = vi.hoisted(() => ({ useWorkItems: vi.fn(), evalPage: vi.fn() }));
const evalItem = {
  id: "eval-1",
  projectId: "project-1",
  parentTaskId: "feature-1",
  name: "Review agent quality",
  type: "EVAL",
  status: "ACTIVE",
  createdAt: "2026-10-24T00:00:00Z",
  updatedAt: "2026-10-24T00:00:00Z",
};
vi.mock("@hey-hey/ui-common/data", () => ({
  useWorkItemTypes: () => ({
    isReady: true,
    workItemTypes: [
      {
        id: "type-eval",
        projectId: "project-1",
        status: "ACTIVE",
        definition: { key: "EVAL", name: "Evaluations", role: "monitor" },
      },
    ],
  }),
  useWorkItems: (...args: unknown[]) => {
    mocks.useWorkItems(...args);
    return { workItems: [evalItem], isLoading: false };
  },
  useWorkItem: () => ({ workItem: evalItem, isLoading: false, error: null }),
}));
vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org-1" }),
}));
vi.mock("@hey-hey/ui-common/context", async (original) => ({
  ...(await original<typeof import("@hey-hey/ui-common/context")>()),
  CanonicalPageBoundary: ({ children }: { children: React.ReactNode }) =>
    children,
}));
vi.mock("@hey-hey/ui-common/components", async () => {
  const { TaskList } =
    await import("../../../../../packages/ui-common/src/components/TaskList/TaskList");
  return {
    TaskList,
    TaskMonitorActivityTab: () => null,
    EntityFilters: () => null,
    FeaturePicker: () => null,
  };
});
vi.mock(
  "../../../../../packages/ui-common/src/components/InteractionComponent",
  () => ({
    InteractionComponent: ({ children }: { children: React.ReactNode }) =>
      children,
  }),
);
vi.mock(
  "../../../../../packages/ui-common/src/data/hooks/useWorkItemTypes",
  () => ({
    useWorkItemTypeByKey: () => ({ workItemTypeDefinition: undefined }),
  }),
);
vi.mock(
  "../../../../../packages/ui-common/src/data/hooks/useConversationPhase",
  () => ({ useConversationPhase: () => ({ phase: undefined }) }),
);
vi.mock("../../components/Activity", () => ({
  PaginatedCodingSessionsFeed: () => null,
  PaginatedSessionFeed: () => null,
}));
vi.mock("./views", () => ({ CostsView: () => null, UsageView: () => null }));
vi.mock("../Eval/EvalPage", () => ({
  EvalPage: (props: unknown) => {
    mocks.evalPage(props);
    return <div>Canonical Eval detail</div>;
  },
}));
vi.mock("../Features/FeaturePage", () => ({ FeaturePage: () => null }));
vi.mock("../Goals/GoalPage", () => ({ GoalPage: () => null }));
vi.mock("../Plan/PlanPage", () => ({ PlanPage: () => null }));
vi.mock("../Task/TaskPage", () => ({ TaskPage: () => null }));
vi.mock("../Task/TaskMonitorPage", () => ({ TaskMonitorPage: () => null }));
vi.mock("../Task/WorkflowDetailPage", () => ({
  WorkflowDetailPage: () => null,
}));
vi.mock("../Task/WorkflowStepPage", () => ({ WorkflowStepPage: () => null }));

describe("Agents Eval canonical opening", () => {
  it("queries the current project and opens a real list row through the task router with Feature ownership", async () => {
    window.history.replaceState(
      {},
      "",
      "/projects/project-1?agentsSubTab=evals",
    );
    const user = userEvent.setup();
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <BrowserRouter>
          <NuqsAdapter>
            <Routes>
              <Route
                path="/projects/:projectId"
                element={
                  <ProjectAgentsTab
                    organizationId="org-1"
                    projectId="project-1"
                    userId="user-1"
                  />
                }
              />
              <Route
                path="/projects/:projectId/tasks/:taskId"
                element={<TaskRouter />}
              />
            </Routes>
          </NuqsAdapter>
        </BrowserRouter>
      </QueryClientProvider>,
    );
    expect(mocks.useWorkItems).toHaveBeenCalledWith(
      "org-1",
      "task",
      "project-1",
      undefined,
      expect.objectContaining({ taskType: "EVAL", parentTaskId: undefined }),
    );
    const row = screen.getByRole("link", { name: /Review agent quality/ });
    expect(row).toHaveAttribute("href", "/projects/project-1/tasks/eval-1");
    await user.click(row);
    await waitFor(() =>
      expect(screen.getByText("Canonical Eval detail")).toBeInTheDocument(),
    );
    expect(mocks.evalPage).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        task: expect.objectContaining({
          id: "eval-1",
          parentTaskId: "feature-1",
          type: "EVAL",
        }),
      }),
    );
  });
});
