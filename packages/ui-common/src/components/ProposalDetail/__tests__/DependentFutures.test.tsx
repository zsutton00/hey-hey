import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { DependentFutures } from "../DependentFutures";

const proposal = vi.hoisted(() => ({
  id: "proposal",
  title: "Reviewed direction",
  action: "UPDATE",
  type: "SINGLE",
  status: "DRAFT",
  targetEntityType: "TASK",
  targetEntityId: "target",
  requiredApprovals: 1,
  approvals: [],
  influences: [],
  updates: {},
  createdAt: "2026-01-01T00:00:00.000Z",
}));
const query = vi.hoisted(() =>
  vi.fn(() => ({
    data: [proposal],
    isLoading: false,
    error: null,
    pagination: { hasNext: false },
  })),
);
vi.stubGlobal(
  "IntersectionObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);
vi.mock("react-router-dom", () => ({ useNavigate: vi.fn(() => vi.fn()) }));
vi.mock("../../../data/hooks/useEntityContext", () => ({
  useEntityContext: vi.fn(() => ({
    data: null,
    isLoading: false,
    error: null,
    fetch: vi.fn(),
  })),
}));
vi.mock("../../InteractionComponent/useEntityConversationLauncher", () => ({
  useEntityConversationLauncher: vi.fn(() => ({
    launch: vi.fn().mockResolvedValue(true),
    isLoading: false,
    error: null,
  })),
}));
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
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      "/projects/project/proposals/proposal",
    );
    expect(screen.getByText("Reviewed direction")).toBeInTheDocument();
  },
);

it("shows loading, empty and error states", () => {
  const base = { pagination: { hasNext: false } };
  query.mockReturnValueOnce({
    ...base,
    data: [],
    isLoading: true,
    error: null,
  });
  const { unmount } = render(
    <DependentFutures organizationId="org" projectId="project" taskId="t" />,
  );
  expect(screen.queryByText("Reviewed direction")).not.toBeInTheDocument();
  unmount();

  query.mockReturnValueOnce({
    ...base,
    data: [],
    isLoading: false,
    error: null,
  });
  const second = render(
    <DependentFutures organizationId="org" projectId="project" taskId="t" />,
  );
  expect(screen.getByText("No proposals found")).toBeInTheDocument();
  second.unmount();

  query.mockReturnValueOnce({
    ...base,
    data: [],
    isLoading: false,
    error: new Error("boom"),
  });
  render(
    <DependentFutures organizationId="org" projectId="project" taskId="t" />,
  );
  expect(screen.getByText("boom")).toBeInTheDocument();
  expect(screen.queryByText("Dependent futures")).not.toBeInTheDocument();
});

it("pages through further results", async () => {
  query.mockReturnValue({
    data: [proposal],
    isLoading: false,
    error: null,
    pagination: { hasNext: true },
  });
  render(
    <DependentFutures organizationId="org" projectId="project" taskId="t" />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(query).toHaveBeenLastCalledWith("org", "project", {
    completionDependencyId: "t",
    offset: 20,
    limit: 20,
  });
});
