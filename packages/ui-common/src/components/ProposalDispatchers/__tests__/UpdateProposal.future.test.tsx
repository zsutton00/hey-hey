import { render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  type FutureRevisionContent,
  type FutureRevisionResponse,
  type ProposalResponseDto,
  type TaskResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import { UpdateProposal } from "../UpdateProposal";

const mocks = vi.hoisted(() => ({
  entities: {} as Record<string, { type: "task"; data: TaskResponseDto }>,
  definitions: [] as WorkItemTypeDefinitionDto[],
  proposal: undefined as ProposalResponseDto | undefined,
  readiness: vi.fn(),
  workItems: new Map<string, TaskResponseDto>(),
}));

vi.mock("../useEntityData", () => ({
  useEntityData: () => ({
    entities: mocks.entities,
    loading: false,
    error: null,
  }),
}));
vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: true,
    isReady: true,
    isLoading: false,
    error: null,
  }),
  useWorkItemTypeByKey: () => ({ workItemTypeSummary: undefined }),
  useWorkItemTypes: () => ({
    workItemTypes: mocks.definitions.map((definition) => ({
      definition,
      status: "ACTIVE",
      projectId: "project",
    })),
    isLoading: false,
    error: null,
  }),
}));
vi.mock("../../../data/hooks/useProposal", () => ({
  useProposal: () => ({
    proposal: mocks.proposal,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
}));
vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: {
    getProposalFutureApplicability: mocks.readiness,
    applyProposalFuture: vi.fn(),
  },
  unifiedApiClient: {},
}));
vi.mock("../../../data/hooks/useFeatureHierarchy", () => ({
  useFeatureLookup: () => ({
    isLoading: false,
    isReady: true,
    get: () => undefined,
  }),
}));
vi.mock("../../../contexts/PathServiceContext", () => ({
  usePathService: () => ({
    feature: ({ featureId }: { featureId: string }) => `/features/${featureId}`,
    task: ({ taskId }: { taskId: string }) => `/tasks/${taskId}`,
    proposal: ({ proposalId }: { proposalId: string }) =>
      `/proposals/${proposalId}`,
  }),
}));
vi.mock("../../../data/hooks/useUsers", () => ({
  useUsers: () => ({ data: [] }),
}));
vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: (_org: string, _type: string, taskId: string) => ({
    workItem: mocks.workItems.get(taskId),
    isLoading: false,
    error: null,
  }),
}));
vi.mock("../../../data/hooks/useServices", () => ({
  useServices: () => ({ services: [], isLoading: false, error: null }),
}));
vi.mock("../modeAvailability", () => ({
  useModeAvailability: () => undefined,
}));
vi.mock("../ModeAvailabilitySummary", () => ({
  ModeAvailabilitySummary: () => null,
}));
vi.mock("../../Entity", () => ({
  EntityLinkWithPreview: ({ label }: { label: string }) => <a>{label}</a>,
}));
vi.mock("../../SuggestedContent", () => ({
  DiffRenderer: ({
    oldContent,
    newContent,
  }: {
    oldContent: string;
    newContent: string;
  }) => (
    <div data-testid="general-diff">
      {oldContent} → {newContent}
    </div>
  ),
}));
vi.mock("../ProposalStateIndicator", () => ({
  ProposalStateIndicator: () => <div data-testid="proposal-state" />,
  ProposalOutOfDateReview: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("../ProposalEdges", () => ({ ProposalEdges: () => null }));
vi.mock("../../InteractionComponent", () => ({
  InteractionComponent: ({
    entityTitle,
    children,
  }: {
    entityTitle: string;
    children: React.ReactNode;
  }) => <section aria-label={entityTitle}>{children}</section>,
}));

const featureDefinition: WorkItemTypeDefinitionDto = {
  key: "FEATURE",
  name: "Feature",
  sections: [
    { key: "description", label: "Description" },
    {
      key: "requirements",
      label: "Requirements",
      kind: "json",
      schemaRef: "#/components/schemas/FeatureRequirementsSection",
    },
  ],
  allowedStatuses: [],
};

const requirement = (id: string, statement: string) => ({
  id,
  statement,
  designedBy: [],
  fulfilledBy: [],
  contracts: [],
});
const req1 = "00000000-0000-4000-8000-000000000001";
const req2 = "00000000-0000-4000-8000-000000000002";
const requirements = (records: ReturnType<typeof requirement>[]) =>
  JSON.stringify({ records });

const live: FutureRevisionContent = {
  id: "feature",
  organizationId: "org",
  projectId: "project",
  type: "FEATURE",
  name: "Open Items",
  status: "ACTIVE",
  source: "user",
  sections: [
    {
      id: "s1",
      key: "description",
      order: 0,
      materializedMarkdown: "Unchanged description",
      materializedProposalId: "p0",
    },
    {
      id: "s2",
      key: "requirements",
      order: 1,
      materializedMarkdown: requirements([requirement(req1, "Existing rule")]),
      materializedProposalId: "p0",
    },
  ],
};
const result: FutureRevisionContent = {
  ...live,
  sections: [
    live.sections[0],
    {
      ...live.sections[1],
      materializedMarkdown: requirements([
        requirement(req1, "Existing rule"),
        requirement(req2, "Cap Open Items at 100"),
      ]),
    },
  ],
};
const reviewedFuture: FutureRevisionResponse = {
  id: "future",
  organizationId: "org",
  projectId: "project",
  targetEntityType: "TASK",
  targetEntityId: "feature",
  revision: 1,
  outcome: "STAGED",
  originatingProposalId: "future-proposal",
  latestProposalId: "future-proposal",
  baseline: { kind: "LIVE", revision: "r1", content: live },
  result,
  dependencies: [
    {
      edgeType: "DEPENDS_ON",
      targetEntityType: "TASK",
      targetEntityId: "cap-task",
    },
  ],
  history: [],
  completionEligibility: {
    eligible: false,
    blockers: [
      {
        dependency: {
          edgeType: "DEPENDS_ON",
          targetEntityType: "TASK",
          targetEntityId: "cap-task",
        },
        reason: "INCOMPLETE",
        status: "ACTIVE",
      },
    ],
  },
  outstandingRefinementProposalIds: new Set(),
};
const futureProposal = (
  extra: Partial<ProposalResponseDto> = {},
): ProposalResponseDto =>
  ({
    id: "future-proposal",
    organizationId: "org",
    projectId: "project",
    type: "SINGLE",
    action: ProposalAction.VersionedUpdate,
    status: "DRAFT",
    targetEntityId: "feature",
    targetEntityType: "TASK",
    title: "Open Items cap requirement",
    updates: {
      operation: "REVISE",
      futureId: "future",
      expectedRevision: 0,
      baseline: { kind: "LIVE", revision: "r1", content: live },
      result,
      dependencies: new Set(reviewedFuture.dependencies),
    },
    requestorId: "user",
    requiredApprovals: 1,
    approvals: [],
    createdAt: "2026-10-22T00:00:00Z",
    updatedAt: "2026-10-22T00:00:00Z",
    ...extra,
  }) as ProposalResponseDto;

const mount = (proposal: ProposalResponseDto) => {
  mocks.proposal = proposal;
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <UpdateProposal
          proposals={[proposal]}
          onApply={vi.fn()}
          onReject={vi.fn()}
          organizationId="org"
          projectId="project"
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  mocks.readiness.mockReset();
  mocks.definitions.splice(0, mocks.definitions.length, featureDefinition);
  mocks.entities.feature = {
    type: "task",
    data: live as unknown as TaskResponseDto,
  };
  mocks.workItems.set("cap-task", {
    id: "cap-task",
    name: "Cap Open Items at 100",
    type: "STANDARD",
    status: "ACTIVE",
    organizationId: "org",
    projectId: "project",
    source: "user",
    sections: [],
  } as TaskResponseDto);
  mocks.readiness.mockResolvedValue({
    data: {
      data: {
        revision: 1,
        canApply: false,
        blockers: ["COMPLETION_INCOMPLETE"],
        completionEligibility: reviewedFuture.completionEligibility,
      },
    },
  });
});

describe("UpdateProposal future revisions", () => {
  it("renders a pending future as an ordinary Feature update card", () => {
    mount(futureProposal());

    const card = screen.getByRole("region", { name: "Update Feature" });
    expect(
      within(card).getByTestId("structured-requirements-diff"),
    ).toBeInTheDocument();
    expect(
      card.querySelector(`[data-requirement-id="${req2}"]`),
    ).toHaveAttribute("data-requirement-change", "added");
    // Nothing else changed, so no title/status/description diff appears.
    expect(screen.queryByTestId("general-diff")).not.toBeInTheDocument();
    expect(card.textContent).not.toContain('"records"');
    // Approve → linked work (preview) → greyed-out Apply, before approval.
    const footer = within(card).getByTestId("future-apply-footer");
    expect(footer).toHaveAttribute("data-state", "preview");
    expect(within(footer).getByTestId("proposal-state")).toBeInTheDocument();
    expect(
      within(footer).getByTestId("future-dependency-preview"),
    ).toHaveTextContent("Cap Open Items at 100");
    expect(within(footer).queryByText("In progress")).not.toBeInTheDocument();
    expect(within(footer).getByTestId("future-apply")).toBeDisabled();
    expect(within(footer).getByTestId("future-waiting")).toHaveTextContent(
      "Once approved, this change waits for Cap Open Items at 100 to reach Verifying. You'll be asked to apply it then.",
    );
    expect(mocks.readiness).not.toHaveBeenCalled();
  });

  it("swaps the footer for Approved → linked work → Apply once approved", async () => {
    mount(futureProposal({ status: "APPROVED", reviewedFuture }));

    const footer = screen.getByTestId("future-apply-footer");
    expect(screen.queryByTestId("proposal-state")).not.toBeInTheDocument();
    expect(within(footer).getByText("Approved")).toBeInTheDocument();
    expect(within(footer).getByTestId("future-dependency")).toHaveTextContent(
      "Cap Open Items at 100In progress",
    );
    await waitFor(() =>
      expect(within(footer).getByTestId("future-waiting")).toHaveTextContent(
        "Waiting for Cap Open Items at 100. You'll be asked to apply this change when it reaches Verifying. Refresh checks the status again.",
      ),
    );
    const sequence = within(footer).getByTestId("future-review-sequence");
    expect(within(sequence).getByText("Approved")).toBeInTheDocument();
    expect(
      within(sequence).getByTestId("future-dependency"),
    ).toBeInTheDocument();
    expect(
      within(sequence).getByRole("button", {
        name: "Refresh linked work status",
      }),
    ).toBeInTheDocument();
    expect(within(sequence).getByTestId("future-apply")).toBeDisabled();
    expect(
      within(sequence).queryByTestId("future-waiting"),
    ).not.toBeInTheDocument();
    expect(footer.textContent).not.toMatch(/incomplete|readiness/i);
  });

  it("shows a cancellation as one plain line on the ordinary card", () => {
    mount(
      futureProposal({
        updates: {
          operation: "CANCEL",
          futureId: "future",
          expectedRevision: 1,
        } as unknown as ProposalResponseDto["updates"],
        reviewedFuture,
      }),
    );
    expect(screen.getByTestId("future-cancel-notice")).toHaveTextContent(
      "Cancels this approved change.",
    );
    expect(screen.getByTestId("proposal-state")).toBeInTheDocument();
  });
});
