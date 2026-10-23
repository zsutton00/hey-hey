import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DependentFutures } from "../DependentFutures";

const query = vi.hoisted(() =>
  vi.fn(() => ({
    data: [{ id: "proposal", title: "Reviewed direction" }],
    isLoading: false,
    error: null,
    pagination: { hasNext: false },
  })),
);
vi.mock("../../../data/hooks/useProposals", () => ({ useProposals: query }));
vi.mock("../../../contexts/PathServiceContext", () => ({
  usePathService: () => ({
    proposal: ({
      projectId,
      proposalId,
    }: {
      projectId: string;
      proposalId: string;
    }) => `/projects/${projectId}/proposals/${proposalId}`,
  }),
}));

it.each(["task", "bug", "plan"])(
  "links %s completion dependencies to the canonical proposal route",
  (taskId) => {
    render(
      <DependentFutures
        organizationId="org"
        projectId="project"
        taskId={taskId}
      />,
    );
    expect(query).toHaveBeenCalledWith("org", "project", {
      completionDependencyId: taskId,
      offset: 0,
      limit: 20,
    });
    expect(
      screen.getByRole("link", { name: "Reviewed direction" }),
    ).toHaveAttribute("href", "/projects/project/proposals/proposal");
  },
);
