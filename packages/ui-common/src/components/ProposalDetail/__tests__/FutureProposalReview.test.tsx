import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import {
  TaskSource,
  WorkStatus,
  type FutureCompletionDependency,
  type FutureRevisionContent,
  type ProposalResponseDto,
  type TaskResponseDto,
} from "../../../api";
import { FutureProposalReview } from "../FutureProposalReview";

const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  refetch: vi.fn(),
  live: vi.fn(),
  apply: vi.fn(),
  readiness: vi.fn(),
  workItems: new Map<string, TaskResponseDto>(),
}));
vi.mock("../../../data/hooks/useProposal", () => ({
  useProposal: () => ({
    proposal: mocks.read(),
    isLoading: false,
    error: null,
    refetch: mocks.refetch,
  }),
}));
vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { getTask: mocks.live },
  proposalsClient: {
    applyProposalFuture: mocks.apply,
    getProposalFutureApplicability: mocks.readiness,
  },
}));
vi.mock("../../../data/hooks/useInvalidateProposalReview", () => ({
  useInvalidateProposalReview: () => vi.fn(),
}));
vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: (
    _organizationId: string,
    _entityType: "initiative" | "task",
    taskId: string,
  ) => ({
    workItem: mocks.workItems.get(taskId) ?? null,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    refetch: async () => null,
    markStale: vi.fn(),
  }),
}));
vi.mock("../FutureProposalLink", () => ({
  FutureProposalLink: () => <a href="/pending">Pending refinement</a>,
}));
vi.mock("../../SuggestedContent", () => ({
  DiffRenderer: ({
    oldContent,
    newContent,
  }: {
    oldContent: string;
    newContent: string;
  }) => (
    <div>
      <span>{oldContent}</span>
      <span>{newContent}</span>
    </div>
  ),
}));

const content: FutureRevisionContent = {
  id: "target",
  organizationId: "org",
  projectId: "project",
  type: "FEATURE",
  name: "Live name",
  status: "BACKLOG",
  source: "user",
  sections: [
    {
      id: "section",
      key: "description",
      order: 0,
      materializedMarkdown: "Unchanged full section",
      materializedProposalId: "basis-proposal",
    },
  ],
};
const makeDependency = (
  targetEntityId: string,
): FutureCompletionDependency => ({
  edgeType: "DEPENDS_ON",
  targetEntityType: "TASK",
  targetEntityId,
});
const makeWorkItem = (id: string, name: string): TaskResponseDto => ({
  id,
  name,
  type: "STANDARD",
  sections: [],
  organizationId: "org",
  projectId: "project",
  status: WorkStatus.Backlog,
  source: TaskSource.User,
});
const proposal: ProposalResponseDto = {
  id: "pending-review",
  organizationId: "org",
  projectId: "project",
  type: "SINGLE",
  action: "VERSIONED_UPDATE",
  status: "DRAFT",
  targetEntityId: "target",
  targetEntityType: "TASK",
  title: "Refine future",
  updates: {
    operation: "REVISE",
    futureId: "future",
    expectedRevision: 1,
    baseline: { kind: "LIVE", revision: "basis", content },
    result: { ...content, name: "Proposed name" },
    dependencies: new Set(),
  },
  requestorId: "user",
  requiredApprovals: 1,
  approvals: [],
  createdAt: "2026-09-28T00:00:00Z",
  updatedAt: "2026-09-28T00:00:00Z",
  reviewedFuture: {
    id: "future",
    organizationId: "org",
    projectId: "project",
    targetEntityId: "target",
    targetEntityType: "TASK",
    revision: 1,
    outcome: "STAGED",
    originatingProposalId: "origin",
    latestProposalId: "origin",
    baseline: {
      kind: "LIVE",
      revision: "basis",
      content: { ...content, sections: [...content.sections] },
    },
    result: {
      ...content,
      name: "Approved name",
      sections: [...content.sections],
    },
    dependencies: [],
    history: [],
    outstandingRefinementProposalIds: new Set(["pending-review"]),
    completionEligibility: { eligible: false, blockers: [] },
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.workItems.clear();
  mocks.read.mockReturnValue(proposal);
  mocks.live.mockResolvedValue({ data: { data: content } });
  mocks.readiness.mockResolvedValue({
    data: {
      data: {
        revision: 1,
        canApply: false,
        blockers: ["COMPLETION_INCOMPLETE"],
      },
    },
  });
});
it("shows live, approved and proposed content separately and keeps ordinary approval distinct from Apply", async () => {
  const approve = vi.fn().mockResolvedValue(undefined);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FutureProposalReview
        proposal={proposal}
        onApprove={approve}
        onReject={undefined}
      />
    </QueryClientProvider>,
  );
  await screen.findByText("Proposed name");
  expect(screen.getByText("Live name")).toBeInTheDocument();
  expect(screen.getAllByText("Approved name")).toHaveLength(2);
  expect(screen.getAllByText("Unchanged full section")).toHaveLength(4);
  expect(screen.getByTestId("future-apply")).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: /Approve/ }));
  await waitFor(() => expect(approve).toHaveBeenCalledWith("pending-review"));
  expect(mocks.apply).not.toHaveBeenCalled();
  expect(mocks.refetch).toHaveBeenCalled();
});

it("rejects a refinement through ordinary review while retaining the approved future", async () => {
  const pending = { ...proposal, id: "reject-pending" };
  mocks.read.mockReturnValue(pending);
  const reject = vi.fn().mockResolvedValue(undefined);
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <FutureProposalReview
        proposal={pending}
        onApprove={vi.fn()}
        onReject={reject}
      />
    </QueryClientProvider>,
  );
  await screen.findByText("Proposed name");
  fireEvent.click(screen.getByRole("button", { name: "Reject" }));
  fireEvent.change(screen.getByLabelText("Reason for rejection"), {
    target: { value: "Keep the approved direction" },
  });
  fireEvent.click(screen.getByTestId("proposal-reject-submit"));
  await waitFor(() =>
    expect(reject).toHaveBeenCalledWith(
      "reject-pending",
      "Keep the approved direction",
    ),
  );
  expect(screen.getAllByText("Approved name")).toHaveLength(2);
  expect(mocks.apply).not.toHaveBeenCalled();
  expect(mocks.refetch).toHaveBeenCalled();
});

it("shows added and removed dependencies for a pending refinement", async () => {
  const addedDependency = makeDependency("added-work");
  const removedDependency = makeDependency("removed-work");
  const retainedDependency = makeDependency("retained-work");
  const pending = {
    ...proposal,
    updates: {
      ...proposal.updates,
      dependencies: new Set([addedDependency, retainedDependency]),
    },
    reviewedFuture: {
      ...proposal.reviewedFuture!,
      dependencies: [removedDependency, retainedDependency],
    },
  } satisfies ProposalResponseDto;
  mocks.read.mockReturnValue(pending);
  mocks.workItems.set("added-work", makeWorkItem("added-work", "Added work"));
  mocks.workItems.set(
    "removed-work",
    makeWorkItem("removed-work", "Removed work"),
  );
  mocks.workItems.set(
    "retained-work",
    makeWorkItem("retained-work", "Retained work"),
  );

  render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <FutureProposalReview
          proposal={pending}
          onApprove={vi.fn()}
          onReject={undefined}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );

  const changes = await screen.findByTestId("future-dependency-changes");
  expect(
    within(changes).getByText("Added completion dependencies"),
  ).toBeInTheDocument();
  expect(within(changes).getByText("Added work")).toBeInTheDocument();
  expect(
    within(changes).getByText("Removed completion dependencies"),
  ).toBeInTheDocument();
  expect(within(changes).getByText("Removed work")).toBeInTheDocument();
  expect(within(changes).queryByText("Retained work")).not.toBeInTheDocument();
});

it("shows every proposed dependency for a first revision in grouped review", async () => {
  const firstDependency = makeDependency("first-work");
  const secondDependency = makeDependency("second-work");
  const firstRevision = {
    ...proposal,
    id: "first-revision",
    updates: {
      ...proposal.updates,
      expectedRevision: 0,
      dependencies: new Set([firstDependency, secondDependency]),
    },
    reviewedFuture: null,
  } satisfies ProposalResponseDto;
  mocks.read.mockReturnValue(firstRevision);
  mocks.workItems.set("first-work", makeWorkItem("first-work", "First work"));
  mocks.workItems.set(
    "second-work",
    makeWorkItem("second-work", "Second work"),
  );

  render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <FutureProposalReview
          proposal={firstRevision}
          onApprove={vi.fn()}
          onReject={undefined}
          renderMode="group-member"
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );

  const changes = await screen.findByTestId("future-dependency-changes");
  expect(
    within(changes).getByText("Added completion dependencies"),
  ).toBeInTheDocument();
  expect(within(changes).getByText("First work")).toBeInTheDocument();
  expect(within(changes).getByText("Second work")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /Approve/ }),
  ).not.toBeInTheDocument();
});
