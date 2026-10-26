import { createPortal } from "react-dom";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  type DesignDocResponseDto,
  type FutureRevisionContent,
  type FutureRevisionResponse,
  type ProposalResponseDto,
  type TaskResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import { UpdateProposal } from "../UpdateProposal";
import { FutureApplicationOfferDialog } from "../../ProposalDetail/FutureApplicationOfferDialog";
import { FutureApplyFooter } from "../FutureApplyFooter";

const mocks = vi.hoisted(() => ({
  realControls: false,
  entities: {} as Record<
    string,
    | { type: "task"; data: TaskResponseDto }
    | { type: "designDoc"; data: DesignDocResponseDto }
  >,
  definitions: [] as WorkItemTypeDefinitionDto[],
  proposal: undefined as ProposalResponseDto | undefined,
  readiness: vi.fn(),
  refetch: vi.fn(),
  reconciliation: vi.fn(),
  offers: vi.fn(),
  apply: vi.fn(),
  proposals: new Map<string, ProposalResponseDto>(),
  workItems: new Map<string, TaskResponseDto>(),
}));

vi.mock(
  "../../shared/WorkflowMentionInlineRenderer",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("../../shared/WorkflowMentionInlineRenderer")
    >()),
    WorkflowGraphSurface: ({
      projection,
    }: {
      projection: {
        projectedRoot: { name: string };
        children: Array<{ name: string; deleted: boolean }>;
      };
    }) => (
      <div data-testid="captured-graph">
        {projection.projectedRoot.name}:{" "}
        {projection.children
          .filter((node) => !node.deleted)
          .map((node) => node.name)
          .join(", ")}
      </div>
    ),
  }),
);
vi.mock("../WorkItemGraphChangeSummary", () => ({
  WorkItemGraphChangeSummary: ({
    operations,
  }: {
    operations: Array<{ op: string }>;
  }) => (
    <div data-testid="graph-change-summary">
      {operations.map((operation) => operation.op).join(", ")}
    </div>
  ),
}));

vi.mock("../useEntityData", () => ({
  useEntityData: () => ({
    entities: mocks.entities,
    loading: false,
    error: null,
  }),
}));
vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useMentionWorkItemTypeKey: (
    _org: string,
    _project: string,
    kind: string,
  ) => ({ typeKey: kind?.toUpperCase(), isResolved: true }),
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
  useProposal: (_org: string, _project: string, proposalId: string) => ({
    proposal: mocks.proposals.get(proposalId) ?? mocks.proposal,
    isLoading: false,
    error: null,
    refetch: mocks.refetch,
  }),
}));
vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: {
    getProposalFutureApplicability: mocks.readiness,
    getProposalReconciliation: mocks.reconciliation,
    applyProposalFuture: mocks.apply,
    listProposalFutureOffers: mocks.offers,
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
    designDoc: ({ designDocId }: { designDocId: string }) =>
      `/docs/${designDocId}`,
    plan: ({ planId }: { planId: string }) => `/plans/${planId}`,
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
  EntityLinkWithPreview: ({
    label,
    testId,
  }: {
    label: string;
    testId?: string;
  }) => <a data-testid={testId}>{label}</a>,
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
vi.mock("../ProposalStateIndicator", async (original) => {
  const actual = await original<typeof import("../ProposalStateIndicator")>();
  return {
    ...actual,
    ProposalStateIndicator: (
      props: import("../ProposalStateIndicator").ProposalStateIndicatorProps,
    ) =>
      mocks.realControls ? (
        <actual.ProposalStateIndicator {...props} />
      ) : (
        <div data-testid="proposal-state" />
      ),
  };
});
vi.mock("../ProposalEdges", () => ({ ProposalEdges: () => null }));
vi.mock("../../InteractionComponent", async (original) => ({
  ...(await original<object>()),
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
  dependencyPresentation: [
    {
      availability: "AVAILABLE",
      targetEntityId: "cap-task",
      title: "Cap Open Items at 100",
      workItemType: "STANDARD",
      status: "ACTIVE",
    },
  ],
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
    dependencyPresentation: [
      {
        availability: "AVAILABLE",
        targetEntityId: "cap-task",
        title: "Cap Open Items at 100",
        workItemType: "STANDARD",
      },
    ],
    requestorId: "user",
    requiredApprovals: 1,
    approvals: [],
    createdAt: "2026-10-22T00:00:00Z",
    updatedAt: "2026-10-22T00:00:00Z",
    ...extra,
  }) as ProposalResponseDto;

const mount = (proposal: ProposalResponseDto, footerTarget?: HTMLElement) => {
  mocks.proposal = proposal;
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <MemoryRouter>
        <UpdateProposal
          renderMode={footerTarget ? "future-review" : undefined}
          renderFutureFooter={
            footerTarget
              ? (content) => createPortal(content, footerTarget)
              : undefined
          }
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
  mocks.realControls = false;
  mocks.reconciliation.mockResolvedValue({
    data: {
      data: {
        status: "CURRENT",
        currentBases: [],
        revisions: [],
        conflictingPaths: [],
        interveningProposals: [],
        overlaps: [],
      },
    },
  });
  mocks.readiness.mockReset();
  mocks.refetch.mockReset();
  mocks.proposals.clear();
  mocks.apply.mockReset();
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
  it("renders a graph-only future from its captured baseline and complete result while live content has drifted", async () => {
    const graph = {
      valid: true,
      projectedRoot: {
        identity: { refType: "existing", id: "feature" },
        type: "DIAGRAM",
        name: "Captured Diagram",
        label: "Captured Diagram",
        sections: [],
        deleted: false,
      },
      children: [
        {
          identity: { refType: "existing", id: "element" },
          type: "DIAGRAM_ELEMENT",
          name: "Before element",
          label: "Before element",
          parent: { refType: "existing", id: "feature" },
          sections: [],
          deleted: false,
        },
      ],
      sections: [],
      incidentRelationships: [],
      identityLabels: {},
      issues: [],
      warnings: [],
    };
    const after = {
      ...graph,
      children: [{ ...graph.children[0], name: "After element" }],
    };
    const proposal = futureProposal({
      updates: {
        operation: "REVISE",
        futureId: "future",
        expectedRevision: 0,
        baseline: { kind: "LIVE", revision: "r1", content: { ...live, graph } },
        result: { ...live, graph: after },
        dependencies: [],
        graphChangeSet: {
          root: graph.projectedRoot.identity,
          operations: [
            {
              op: "workItem.update",
              ref: graph.children[0].identity,
              name: "After element",
            },
          ],
        },
      },
    });
    mocks.entities.feature = {
      type: "task",
      data: { ...live, name: "Concurrent live Diagram" },
    };
    mount(proposal);
    const review = await screen.findByTestId("future-graph-review");
    expect(
      within(review).getAllByTestId("captured-graph")[0],
    ).toHaveTextContent("Before element");
    expect(
      within(review).getAllByTestId("captured-graph")[1],
    ).toHaveTextContent("After element");
    expect(
      within(review).getByTestId("graph-change-summary"),
    ).toHaveTextContent("workItem.update");
    expect(review).not.toHaveTextContent("Concurrent live Diagram");
    expect(screen.getByTestId("proposal-state")).toBeInTheDocument();
  });

  it("carries deferred timing into the Design Doc comparison header", () => {
    const doc = {
      id: "doc",
      name: "Review notes",
      organizationId: "org",
      projectId: "project",
      status: "DRAFT",
      template: "PLAN_DOCUMENT",
      tags: [],
      sections: [
        {
          id: "section",
          key: "content",
          order: 0,
          materializedMarkdown: "Before",
          materializedProposalId: "p0",
        },
      ],
    } as DesignDocResponseDto;
    mocks.entities.doc = { type: "designDoc", data: doc };
    mount(
      futureProposal({
        targetEntityType: "DESIGN_DOC",
        targetEntityId: "doc",
        updates: {
          operation: "REVISE",
          futureId: "doc-future",
          expectedRevision: 0,
          baseline: { kind: "LIVE", revision: "doc-r1", content: doc },
          result: {
            ...doc,
            sections: [{ ...doc.sections[0], materializedMarkdown: "After" }],
          },
          dependencies: new Set(reviewedFuture.dependencies),
        },
      }),
    );
    expect(screen.getByTestId("proposal-header-action")).toHaveTextContent(
      "Updates after linked work",
    );
    expect(screen.getByTestId("proposal-title")).toHaveTextContent(
      "Review notes",
    );
    expect(screen.getByTestId("general-diff")).toHaveTextContent(
      /Before.*→.*After/,
    );
  });

  it("replaces the preview with approved work status when approval refreshes before the parent", async () => {
    const initial = futureProposal();
    mocks.proposal = initial;
    const ui = () => (
      <MemoryRouter>
        <FutureApplyFooter
          proposal={initial}
          approveControl={<button>Approve</button>}
        />
      </MemoryRouter>
    );
    const { rerender } = render(ui());
    expect(screen.getByText("Approve")).toBeInTheDocument();
    expect(mocks.readiness).not.toHaveBeenCalled();
    mocks.proposal = { ...initial, status: "APPROVED", reviewedFuture };
    rerender(ui());
    await waitFor(() =>
      expect(screen.getByText("Approved")).toBeInTheDocument(),
    );
    expect(screen.queryByText("Approve")).not.toBeInTheDocument();
    expect(screen.queryByText(/Once approved/)).not.toBeInTheDocument();
    expect(screen.getByTestId("mention-badge")).toHaveAttribute(
      "data-entity-type",
      "standard",
    );
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("keeps multiple pending work identities distinct and leaves approval with the group", () => {
    const initial = futureProposal({
      dependencyPresentation: [
        {
          availability: "AVAILABLE",
          targetEntityId: "cap-task",
          title: "Cap Open Items at 100",
          workItemType: "STANDARD",
        },
        {
          availability: "AVAILABLE",
          targetEntityId: "bug",
          title: "Clarify hidden items",
          workItemType: "BUG",
        },
        {
          availability: "AVAILABLE",
          targetEntityId: "plan",
          title: "Deliver triage",
          workItemType: "PLAN",
        },
        { availability: "UNAVAILABLE", targetEntityId: "missing" },
      ],
    });
    mocks.proposal = initial;
    render(
      <MemoryRouter>
        <FutureApplyFooter
          proposal={initial}
          approveControl={<span>Needs approval</span>}
        />
      </MemoryRouter>,
    );
    expect(
      screen
        .getAllByTestId("mention-badge")
        .map((b) => b.getAttribute("data-entity-type")),
    ).toEqual(["standard", "bug", "plan"]);
    expect(screen.getByText("Linked work unavailable")).toBeInTheDocument();
    expect(screen.getByText("Needs approval")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("future-apply")).toBeDisabled();
    expect(mocks.readiness).not.toHaveBeenCalled();
  });

  it("copies multiple linked badges with canonical identity and readable HTML", () => {
    const initial = futureProposal({
      dependencyPresentation: [
        {
          availability: "AVAILABLE",
          targetEntityId: "task",
          title: "Implement cap",
          workItemType: "STANDARD",
        },
        {
          availability: "AVAILABLE",
          targetEntityId: "bug",
          title: "Repair count",
          workItemType: "BUG",
        },
      ],
    });
    mocks.proposal = initial;
    render(
      <MemoryRouter>
        <FutureApplyFooter
          proposal={initial}
          approveControl={<span>Needs approval</span>}
        />
      </MemoryRouter>,
    );
    const linked = screen.getByTestId("future-linked-work");
    const range = document.createRange();
    range.selectNodeContents(linked);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const copied = new Map<string, string>();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: {
        setData: (type: string, value: string) => copied.set(type, value),
      },
    });
    linked.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(copied.get("text/plain")).toBe(
      "@[standard:task|Implement cap]@[bug:bug|Repair count]",
    );
    expect(copied.get("text/html")).toContain('data-entity-id="task"');
    expect(copied.get("text/html")).toContain('data-entity-id="bug"');
    selection?.removeAllRanges();
  });

  it("renders a pending future as an ordinary Feature update card", () => {
    mount(futureProposal());

    const card = screen.getByRole("region", { name: "Update Feature" });
    expect(
      within(card).getByTestId("proposal-header-action"),
    ).toHaveTextContent("Updates after linked work");
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
    expect(within(footer).getByTestId("mention-badge")).toHaveTextContent(
      "Cap Open Items at 100",
    );
    expect(within(footer).queryByText("In progress")).not.toBeInTheDocument();
    expect(within(footer).getByTestId("future-apply")).toBeDisabled();
    expect(within(footer).getByTestId("future-waiting")).toHaveTextContent(
      "Once approved, this change waits for Cap Open Items at 100 to reach Verifying. You'll be asked to apply it then.",
    );
    expect(mocks.readiness).not.toHaveBeenCalled();
  });

  it("reviews mixed readiness in the real dialog and applies only the selected revision, retaining its comparison", async () => {
    const readyFuture = {
      ...reviewedFuture,
      completionEligibility: { eligible: true, blockers: [] },
    };
    const first = futureProposal({
      status: "APPROVED",
      reviewedFuture: readyFuture,
    });
    const second = futureProposal({
      id: "second-proposal",
      title: "Second revision",
      status: "APPROVED",
      reviewedFuture: { ...reviewedFuture, id: "second-future" },
    });
    const third = futureProposal({
      id: "third-proposal",
      title: "Third revision",
      status: "APPROVED",
      reviewedFuture: { ...readyFuture, id: "third-future" },
    });
    mocks.proposals.set(third.id, third);
    mocks.proposals.set(first.id, first);
    mocks.proposals.set(second.id, second);
    mocks.proposal = first;
    const offerList = [first, second, third].map((proposal, index) => ({
      futureId: proposal.reviewedFuture!.id,
      proposalId: proposal.id,
      proposalTitle: proposal.title,
      targetEntityType: "TASK",
      targetEntityId: "feature",
      applicability: {
        revision: 1,
        canApply: index !== 1,
        blockers: index !== 1 ? [] : ["COMPLETION_INCOMPLETE"],
        completionEligibility: proposal.reviewedFuture!.completionEligibility,
      },
    }));
    mocks.offers.mockResolvedValue({ data: { data: offerList } });
    mocks.readiness.mockImplementation(({ futureId }: { futureId: string }) =>
      Promise.resolve({
        data: {
          data: {
            revision: 1,
            canApply: futureId !== "second-future",
            blockers:
              futureId !== "second-future" ? [] : ["COMPLETION_INCOMPLETE"],
            completionEligibility: readyFuture.completionEligibility,
          },
        },
      }),
    );
    render(
      <QueryClientProvider
        client={
          new QueryClient({ defaultOptions: { queries: { retry: false } } })
        }
      >
        <MemoryRouter>
          <FutureApplicationOfferDialog
            organizationId="org"
            projectId="project"
            taskId="cap-task"
            open
            onClose={vi.fn()}
          />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const firstTab = await screen.findByRole("tab", {
      name: /Open Items cap requirement Ready to apply/,
    });
    fireEvent.click(
      screen.getByRole("tab", { name: /Second revision Not ready to apply/ }),
    );
    await waitFor(() =>
      expect(
        within(screen.getByRole("tabpanel")).getByTestId("future-apply"),
      ).toBeDisabled(),
    );
    fireEvent.click(firstTab);
    const panel = screen.getByRole("tabpanel");
    const apply = within(panel).getByTestId("future-apply");
    await waitFor(() => expect(apply).toBeEnabled());
    expect(
      within(panel).getByTestId("structured-requirements-diff"),
    ).toBeInTheDocument();
    mocks.apply.mockRejectedValueOnce(new Error("Application failed"));
    fireEvent.click(apply);
    await screen.findByText(/Application failed/);
    await waitFor(() => expect(apply).toBeEnabled());
    mocks.apply.mockResolvedValueOnce({
      data: {
        data: {
          status: "APPLIED",
          future: { ...readyFuture, outcome: "APPLIED", appliedRevision: 1 },
        },
      },
    });
    mocks.offers.mockResolvedValue({ data: { data: offerList.slice(1) } });
    fireEvent.click(apply);
    await within(screen.getByRole("tabpanel")).findByText("Applied");
    expect(mocks.apply).toHaveBeenLastCalledWith({
      organizationId: "org",
      projectId: "project",
      futureId: "future",
      futureApplyRequest: { expectedRevision: 1 },
    });
    expect(
      screen.getByRole("tab", { name: /Open Items cap requirement Applied/ }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByRole("tabpanel")).getByTestId(
        "structured-requirements-diff",
      ),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("tab", { name: /Third revision Ready to apply/ }),
    );
    const thirdApply = within(screen.getByRole("tabpanel")).getByTestId(
      "future-apply",
    );
    await waitFor(() => expect(thirdApply).toBeEnabled());
    mocks.apply.mockRejectedValueOnce(
      new Error("Sibling remains independently actionable"),
    );
    fireEvent.click(thirdApply);
    await screen.findByText(/Sibling remains independently actionable/);
    expect(mocks.apply).toHaveBeenLastCalledWith({
      organizationId: "org",
      projectId: "project",
      futureId: "third-future",
      futureApplyRequest: { expectedRevision: 1 },
    });
  });

  it("keeps the full ordinary comparison and moves the single guarded action to a persistent footer", async () => {
    const footerTarget = document.createElement("div");
    document.body.appendChild(footerTarget);
    const view = mount(
      futureProposal({ status: "APPROVED", reviewedFuture }),
      footerTarget,
    );
    expect(
      screen.getByTestId("future-apply-footer").parentElement?.parentElement,
    ).toBeTruthy();
    expect(within(footerTarget).getByText("Approved")).toBeInTheDocument();
    expect(screen.getAllByTestId("future-apply")).toHaveLength(1);
    await waitFor(() =>
      expect(within(footerTarget).getByTestId("future-apply")).toBeDisabled(),
    );
    expect(
      screen.getByTestId("structured-requirements-diff"),
    ).toBeInTheDocument();
    expect(view.container.textContent).toContain("100");
    expect(
      view.container.querySelector('[data-testid="future-apply"]'),
    ).toBeNull();
    view.unmount();
    footerTarget.remove();
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
      within(sequence).queryByRole("button", {
        name: "Refresh linked work status",
      }),
    ).not.toBeInTheDocument();
    expect(within(sequence).getByTestId("future-apply")).toBeDisabled();
    expect(
      within(sequence).queryByTestId("future-waiting"),
    ).not.toBeInTheDocument();
    expect(footer.textContent).not.toMatch(/incomplete|readiness/i);
  });

  it.each(["pending", "approved", "applied"] as const)(
    "keeps multiple long linked mentions collapsed without scrolling when %s",
    (state) => {
      const linked = [0, 1].map((index) => ({
        ...reviewedFuture.dependencyPresentation[0],
        targetEntityId: `linked-work-${index}`,
        title: `Linked implementation ${index} with a deliberately long title that must truncate`,
      }));
      mount(
        futureProposal({
          status: state === "pending" ? "DRAFT" : "APPROVED",
          dependencyPresentation: linked.map(
            ({ status, ...dependency }) => dependency,
          ),
          reviewedFuture:
            state === "pending"
              ? undefined
              : {
                  ...reviewedFuture,
                  outcome: state === "applied" ? "APPLIED" : "STAGED",
                  appliedRevision: state === "applied" ? 1 : undefined,
                  dependencyPresentation: linked,
                },
        }),
      );
      const sequence = screen.getByTestId("future-review-sequence");
      const middle = within(sequence).getByTestId("future-linked-work");
      expect(getComputedStyle(middle).overflow).toBe("hidden");
      expect(getComputedStyle(sequence).overflow).toBe("hidden");
      expect(within(middle).getAllByTestId("mention-badge")).toHaveLength(2);
      expect(
        middle.querySelector('[data-testid="work-item-inline-mention"]'),
      ).toBeNull();
      expect(sequence).not.toHaveTextContent("Previously approved");
      if (state === "applied") {
        expect(within(sequence).getByText("Applied")).toBeVisible();
        expect(sequence).not.toHaveTextContent(/Applied version/);
      }
    },
  );

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

it("shows approved future drift through real shared review and hides the unresolved comparison", async () => {
  const proposal = futureProposal({ status: "APPROVED", reviewedFuture });
  mocks.reconciliation.mockResolvedValue({
    data: {
      data: {
        status: "RECONCILIATION_REQUIRED",
        currentBases: [
          {
            entityType: "TASK",
            entityId: "feature",
            version: "v2",
            content: { name: "Current" },
          },
        ],
        revisions: [],
        conflictingPaths: ["name"],
        interveningProposals: [],
        overlaps: [
          {
            path: "name",
            currentValue: "Current",
            proposedValue: "Intended",
            interveningProposalId: null,
          },
        ],
      },
    },
  });
  mount(proposal);
  expect(
    await screen.findByTestId("proposal-reconciliation-edit-by-hand"),
  ).toBeVisible();
  expect(screen.getByTestId("proposal-reconciliation-agent-fix")).toBeVisible();
  expect(screen.getByTestId("proposal-three-way-review")).toBeVisible();
  expect(screen.getByText("When this was proposed")).toBeVisible();
  expect(screen.queryByText(/Original evidence is unavailable/)).toBeNull();
  expect(screen.getByTestId("proposal-three-way-review")).toHaveTextContent(
    "Open Items",
  );
  expect(screen.getByText("Proposal")).toBeVisible();
  expect(
    screen.getByTestId("proposal-reconciliation-stages"),
  ).toHaveTextContent("Resolve conflict");
  expect(screen.queryByText("Approved")).toBeNull();
  expect(screen.queryByTestId("future-linked-work")).toBeNull();
  expect(screen.queryByTestId("general-diff")).toBeNull();
  expect(screen.queryByTestId("future-apply")).toBeNull();
});

it("keeps previous approval and authoritative linked work visible while a revised future awaits review", async () => {
  const proposal = futureProposal({
    reviewedFuture: {
      ...reviewedFuture,
      latestProposalId: "previous",
      dependencyPresentation: reviewedFuture.dependencyPresentation.map(
        (dependency) => ({ ...dependency, status: "COMPLETED" }),
      ),
    },
  });
  mocks.proposal = proposal;
  mount(proposal);
  expect(await screen.findByText("Approved")).toBeVisible();
  expect(screen.getByTestId("future-apply")).toBeDisabled();
  expect(screen.getByTestId("future-waiting")).toHaveTextContent(
    "Approval stores the same future and leaves live content unchanged",
  );
  expect(screen.getByTestId("proposal-state")).toBeVisible();
});

it.each(["APPROVED", "DRAFT"] as const)(
  "shows a retryable blocker when a %s future response omits linked-work presentation",
  async (status) => {
    // Reproduce a real response missing a field required by the current API contract.
    const incomplete = { ...reviewedFuture };
    Reflect.deleteProperty(incomplete, "dependencyPresentation");
    const proposal = futureProposal({ status, reviewedFuture: incomplete });
    mocks.proposal = proposal;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const tree = (current: ProposalResponseDto) => (
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <FutureApplyFooter
            proposal={current}
            approveControl={
              status === "DRAFT" ? <button>Approve revision</button> : undefined
            }
          />
        </MemoryRouter>
      </QueryClientProvider>
    );
    const view = render(tree(proposal));
    expect(
      screen.getByTestId("future-linked-work-unavailable"),
    ).toHaveTextContent("Linked work details are unavailable");
    expect(screen.queryByTestId("future-apply")).toBeNull();
    expect(screen.queryByText("Approve revision")).toBeNull();
    expect(mocks.readiness).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    const refreshed = { ...proposal, reviewedFuture };
    mocks.proposal = refreshed;
    view.rerender(tree(refreshed));
    expect(screen.queryByTestId("future-linked-work-unavailable")).toBeNull();
    expect(screen.getByTestId("future-linked-work")).toHaveTextContent(
      "Cap Open Items at 100",
    );
    expect(screen.getByTestId("future-apply")).toBeDisabled();
  },
);

it("reviews a reconciliation refinement with the real shared comparison and approval controls inside Resolve", async () => {
  mocks.realControls = true;
  const proposal = futureProposal({ reviewedFuture });
  mocks.proposal = proposal;
  const approve = vi.fn();
  const applied = vi.fn();
  render(
    <MemoryRouter>
      <UpdateProposal
        organizationId="org"
        projectId="project"
        proposals={[proposal]}
        renderMode="reconciliation-refinement"
        onApply={approve}
        onApplied={applied}
        onReject={vi.fn()}
      />
    </MemoryRouter>,
  );
  const approveButton = await screen.findByTestId("proposal-approve");
  await waitFor(() => expect(approveButton).toBeEnabled());
  expect(screen.queryByTestId("future-apply")).toBeNull();
  expect(screen.getByText("Cap Open Items at 100")).toBeVisible();
  fireEvent.click(approveButton);
  await waitFor(() => expect(approve).toHaveBeenCalledWith(proposal.id, {}));
  expect(applied).not.toHaveBeenCalled();
  expect(mocks.apply).not.toHaveBeenCalled();
});
