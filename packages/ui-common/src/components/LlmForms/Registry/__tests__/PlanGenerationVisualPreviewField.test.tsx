import React from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type FutureRevisionContent,
  type FutureRevisionResponse,
  type ProposalResponseDto,
} from "../../../../api";
import { PlanGenerationVisualPreviewField } from "../PlanGenerationVisualPreviewField";
import type { ConversationMessage } from "../../../../types/conversation";
import type { FieldComponentContext, FieldConfig } from "../types";

const actionMocks = vi.hoisted(() => ({
  handleApply: vi.fn(() => Promise.resolve()),
  handleReject: vi.fn(() => Promise.resolve()),
}));

const proposalClientMocks = vi.hoisted(() => ({
  getProposal: vi.fn(),
}));

const loadedProposals = new Map<string, ProposalResponseDto>();

const workItemMocks = vi.hoisted(() => ({
  useWorkItem: vi.fn(),
}));

vi.mock("../../../../data/hooks/useWorkItem", () => workItemMocks);

vi.mock("../../../shared/WorkflowMentionInlineRenderer", () => ({
  renderMentionNode: (mention: {
    entityType: string;
    entityId: string;
    entityName: string;
  }) => (
    <div
      data-testid={`visual-content-${mention.entityType}-${mention.entityId}`}
    >
      {mention.entityName}
    </div>
  ),
}));

vi.mock("../../../../clients/serviceClients", () => ({
  proposalsClient: proposalClientMocks,
}));

vi.mock("../../../Conversation/Components/MessageProposals", () => ({
  useMessageProposalActions: () => ({
    ...actionMocks,
    proposalDiffDefaultViewMode: undefined,
  }),
}));

vi.mock("../../../ProposalDispatchers/useProposalState", () => ({
  useProposalState: () => ({
    getState: () => ({ state: "pending" }),
  }),
}));

vi.mock("../../../ProposalDispatchers", () => ({
  CreateProposal: ({
    proposals,
    onApply,
    onReject,
  }: {
    proposals: ProposalResponseDto[];
    onApply: (proposalId: string) => Promise<void>;
    onReject?: (proposalId: string, reason: string) => Promise<void>;
  }) => {
    const proposal = proposals[0];
    return (
      <div data-testid={`visual-card-${proposal.id}`}>
        <button onClick={() => onApply(proposal.id)}>Approve</button>
        <button onClick={() => onReject?.(proposal.id, "Needs revision")}>
          Reject
        </button>
      </div>
    );
  },
  DeleteProposal: ({
    proposals,
    onApply,
    onReject,
  }: {
    proposals: ProposalResponseDto[];
    onApply: (proposalId: string) => Promise<void>;
    onReject?: (proposalId: string, reason: string) => Promise<void>;
  }) => {
    const proposal = proposals[0];
    return (
      <div data-testid={`visual-card-${proposal.id}`}>
        <button onClick={() => onApply(proposal.id)}>Approve</button>
        <button onClick={() => onReject?.(proposal.id, "Needs revision")}>
          Reject
        </button>
      </div>
    );
  },
  UpdateProposal: ({
    proposals,
    onApply,
    onReject,
    onApplied,
  }: {
    proposals: ProposalResponseDto[];
    onApply: (proposalId: string) => Promise<void>;
    onReject?: (proposalId: string, reason: string) => Promise<void>;
    onApplied?: (proposalId: string) => Promise<void> | void;
  }) => {
    const proposal = proposals[0];
    return (
      <div
        data-testid={`visual-card-${proposal.id}`}
        data-future-id={
          "futureId" in proposal.updates ? proposal.updates.futureId : undefined
        }
      >
        {proposal.reviewedFuture?.outcome === "APPLIED" && (
          <span>Applied version {proposal.reviewedFuture.appliedRevision}</span>
        )}
        <button onClick={() => onApply(proposal.id)}>Approve</button>
        <button onClick={() => onReject?.(proposal.id, "Needs revision")}>
          Reject
        </button>
        {onApplied && (
          <button onClick={() => void onApplied(proposal.id)}>
            Apply future
          </button>
        )}
      </div>
    );
  },
  ProposalStepper: ({
    proposals,
    getStepMetadata,
    renderProposal,
  }: {
    proposals: ProposalResponseDto[];
    getStepMetadata?: (
      proposal: ProposalResponseDto,
      index: number,
    ) => React.ReactNode;
    renderProposal: (proposal: ProposalResponseDto) => React.ReactNode;
  }) => (
    <div data-testid="visual-preview-stepper">
      {proposals.map((proposal, index) => (
        <section key={proposal.id} data-testid={`visual-step-${proposal.id}`}>
          <h3>{proposal.title}</h3>
          {getStepMetadata?.(proposal, index)}
          {renderProposal(proposal)}
        </section>
      ))}
    </div>
  ),
}));

const createProposal = (id: string, title: string): ProposalResponseDto => ({
  id,
  organizationId: "organization-1",
  projectId: "project-1",
  type: ProposalType.Single,
  action: ProposalAction.Create,
  status: ProposalStatus.Draft,
  targetEntityId: `target-${id}`,
  targetEntityType: TargetEntityType.Task,
  title,
  updates: { name: title },
  requestorId: "requestor-1",
  requiredApprovals: 1,
  approvals: [],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
});

const proposals = [
  createProposal("mockup-list", "Mockup list"),
  createProposal("diagram-overview", "Diagram overview"),
  createProposal("diagram-detail", "Diagram detail"),
];

const futureContent: FutureRevisionContent = {
  id: "target-future-plan",
  name: "Future task",
  type: "STANDARD",
  sections: [],
  organizationId: "organization-1",
  projectId: "project-1",
  status: "BACKLOG",
  source: "user",
};

const futureRevision: FutureRevisionResponse = {
  id: "shared-future",
  organizationId: "organization-1",
  projectId: "project-1",
  targetEntityType: "TASK",
  targetEntityId: futureContent.id,
  revision: 1,
  outcome: "STAGED",
  completionEligibility: { eligible: true, blockers: [] },
  originatingProposalId: "future-plan",
  latestProposalId: "future-plan",
  baseline: { kind: "LIVE", revision: "live-revision", content: futureContent },
  result: futureContent,
  dependencies: [],
  history: [],
  outstandingRefinementProposalIds: new Set(),
};

const futureProposal: ProposalResponseDto = {
  ...createProposal("future-plan", "Future task"),
  action: ProposalAction.VersionedUpdate,
  status: ProposalStatus.Approved,
  updates: {
    operation: "REVISE",
    futureId: futureRevision.id,
    expectedRevision: 1,
    baseline: futureRevision.baseline,
    result: futureRevision.result,
    dependencies: new Set(),
  },
  reviewedFuture: futureRevision,
};

const config: FieldConfig = {
  field: "visual-preview",
  description: "Visual preview",
  type: "plan_generation_visual_preview",
  payload: {
    responseType: "plan_generation_visual_preview_v1",
    entries: [
      {
        proposalId: "mockup-list",
        artifactFamily: "mockup",
        presentationOrder: 0,
      },
      {
        proposalId: "diagram-overview",
        artifactFamily: "diagram",
        presentationOrder: 1,
      },
      {
        proposalId: "diagram-detail",
        artifactFamily: "diagram",
        presentationOrder: 2,
        relationship: {
          kind: "refines",
          proposalId: "diagram-overview",
        },
      },
    ],
  },
};

const context = {
  conversationId: "conversation-1",
  projectId: "project-1",
  organizationId: "organization-1",
} as FieldComponentContext;

const conversationMessage = {
  message: {
    id: "message-1",
    conversationId: "conversation-1",
  },
} as unknown as ConversationMessage;

const workItems: Record<string, { id: string; name: string; type: string }> = {
  "target-mockup-list": {
    id: "target-mockup-list",
    name: "Mockup list content",
    type: "mockup",
  },
  "target-diagram-overview": {
    id: "target-diagram-overview",
    name: "Diagram overview content",
    type: "DIAGRAM",
  },
};

const approve = (proposal: ProposalResponseDto): ProposalResponseDto => ({
  ...proposal,
  status: ProposalStatus.Approved,
});

const mockProposals = (loaded: ProposalResponseDto[]) =>
  proposalClientMocks.getProposal.mockImplementation(
    ({ proposalId }: { proposalId: string }) =>
      Promise.resolve({
        data: { data: loaded.find((proposal) => proposal.id === proposalId) },
      }),
  );

describe("PlanGenerationVisualPreviewField", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    workItemMocks.useWorkItem.mockImplementation(
      (_organizationId: string, _type: string, workItemId: string) => {
        const workItem = workItems[workItemId];
        return {
          workItem: workItem ?? null,
          isFetched: true,
          error: workItem ? null : new Error("Not found"),
        };
      },
    );
    loadedProposals.clear();
    [...proposals, futureProposal].forEach((proposal) =>
      loadedProposals.set(proposal.id, proposal),
    );
    proposalClientMocks.getProposal.mockImplementation(
      ({ proposalId }: { proposalId: string }) =>
        Promise.resolve({
          data: { data: loadedProposals.get(proposalId) },
        }),
    );
  });

  it("renders ordered visual steps and carries relationship metadata from payload entries", async () => {
    render(
      <PlanGenerationVisualPreviewField
        config={config}
        context={context}
        conversationMessage={conversationMessage}
        isSubmitted={false}
      />,
    );

    await waitFor(() =>
      expect(screen.getAllByTestId(/visual-step-/)).toHaveLength(3),
    );
    expect(
      screen.getAllByTestId(/visual-step-/).map((step) => step.textContent),
    ).toEqual([
      "Mockup listApproveReject",
      "Diagram overviewApproveReject",
      "Diagram detailRefines Diagram overviewApproveReject",
    ]);
    expect(screen.getByText("Refines Diagram overview")).toBeInTheDocument();
    expect(
      screen.queryByTestId("plan-generation-visual-preview-family"),
    ).not.toBeInTheDocument();
    const review = screen.getByTestId("plan-generation-visual-preview-review");
    expect(review).toHaveStyle({ borderWidth: "2px", borderStyle: "solid" });
    expect(
      within(review).getByTestId("visual-preview-stepper"),
    ).toBeInTheDocument();
    expect(
      within(review).getAllByRole("button", { name: "Approve" }),
    ).toHaveLength(3);
  });

  it("routes approval and rejection through the shared message action handlers", async () => {
    render(
      <PlanGenerationVisualPreviewField
        config={config}
        context={context}
        conversationMessage={conversationMessage}
        isSubmitted={false}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId("visual-card-diagram-detail"),
      ).toBeInTheDocument(),
    );
    const detailCard = screen.getByTestId("visual-card-diagram-detail");
    fireEvent.click(
      within(detailCard).getByRole("button", { name: "Approve" }),
    );
    fireEvent.click(within(detailCard).getByRole("button", { name: "Reject" }));

    expect(actionMocks.handleApply).toHaveBeenCalledWith("diagram-detail");
    expect(actionMocks.handleReject).toHaveBeenCalledWith(
      "diagram-detail",
      "Needs revision",
    );
  });

  it("renders approved reused visuals as their content and keeps pending visuals as proposals, in order", async () => {
    mockProposals([approve(proposals[0]), approve(proposals[1]), proposals[2]]);
    render(
      <PlanGenerationVisualPreviewField
        config={config}
        context={context}
        conversationMessage={conversationMessage}
        isSubmitted={false}
      />,
    );

    await waitFor(() =>
      expect(screen.getAllByTestId(/visual-step-/)).toHaveLength(3),
    );
    expect(
      screen.getAllByTestId(/visual-step-/).map((step) => step.dataset.testid),
    ).toEqual([
      "visual-step-mockup-list",
      "visual-step-diagram-overview",
      "visual-step-diagram-detail",
    ]);
    expect(
      screen.getByTestId("visual-content-mockup-target-mockup-list"),
    ).toHaveTextContent("Mockup list content");
    expect(
      screen.getByTestId("visual-content-diagram-target-diagram-overview"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("visual-card-mockup-list"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("visual-card-diagram-overview"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("visual-card-diagram-detail"),
    ).toBeInTheDocument();
  });

  it("falls back to the proposal card when an approved visual's content cannot be resolved", async () => {
    mockProposals([
      approve({ ...proposals[0], targetEntityId: "target-missing" }),
      proposals[1],
      proposals[2],
    ]);
    render(
      <PlanGenerationVisualPreviewField
        config={config}
        context={context}
        conversationMessage={conversationMessage}
        isSubmitted={false}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("visual-card-mockup-list")).toBeInTheDocument(),
    );
    expect(screen.getAllByTestId(/visual-step-/)).toHaveLength(3);
    expect(screen.queryByTestId(/visual-content-/)).not.toBeInTheDocument();
  });

  it("presents an all-approved set as content without asking for individual approval", async () => {
    const allApprovedConfig: FieldConfig = {
      ...config,
      payload: {
        responseType: "plan_generation_visual_preview_v1",
        entries: [
          {
            proposalId: "mockup-list",
            artifactFamily: "mockup",
            presentationOrder: 0,
          },
          {
            proposalId: "diagram-overview",
            artifactFamily: "diagram",
            presentationOrder: 1,
          },
        ],
      },
    };
    mockProposals([approve(proposals[0]), approve(proposals[1])]);
    render(
      <PlanGenerationVisualPreviewField
        config={allApprovedConfig}
        context={context}
        conversationMessage={conversationMessage}
        isSubmitted={false}
      />,
    );

    await waitFor(() =>
      expect(screen.getAllByTestId(/visual-content-/)).toHaveLength(2),
    );
    expect(screen.getAllByTestId(/visual-step-/)).toHaveLength(2);
    expect(
      screen.queryByRole("button", { name: "Approve" }),
    ).not.toBeInTheDocument();
    expect(actionMocks.handleApply).not.toHaveBeenCalled();
  });

  it("renders futures through the ordinary update card and refreshes after Apply", async () => {
    const futureConfig: FieldConfig = {
      ...config,
      payload: {
        responseType: "plan_generation_visual_preview_v1",
        entries: [
          {
            proposalId: "diagram-overview",
            artifactFamily: "diagram",
            presentationOrder: 0,
          },
          {
            proposalId: futureProposal.id,
            artifactFamily: "diagram",
            presentationOrder: 1,
            relationship: {
              kind: "refines",
              proposalId: "diagram-overview",
            },
          },
        ],
      },
    };

    render(
      <PlanGenerationVisualPreviewField
        config={futureConfig}
        context={context}
        conversationMessage={conversationMessage}
        isSubmitted={false}
      />,
    );

    const review = await screen.findByTestId(
      `visual-card-${futureProposal.id}`,
    );
    expect(review).toHaveAttribute("data-future-id", futureRevision.id);
    expect(screen.getByText("Refines Diagram overview")).toBeInTheDocument();

    fireEvent.click(within(review).getByRole("button", { name: "Approve" }));
    expect(actionMocks.handleApply).toHaveBeenCalledWith(futureProposal.id);
    expect(proposalClientMocks.getProposal).toHaveBeenCalledTimes(2);

    const appliedProposal: ProposalResponseDto = {
      ...futureProposal,
      reviewedFuture: {
        ...futureRevision,
        outcome: "APPLIED",
        appliedRevision: 1,
      },
    };
    loadedProposals.set(futureProposal.id, appliedProposal);
    fireEvent.click(
      within(review).getByRole("button", { name: "Apply future" }),
    );

    expect(actionMocks.handleApply).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Applied version 1")).toBeInTheDocument();
    expect(proposalClientMocks.getProposal).toHaveBeenCalledTimes(4);
    expect(
      screen.getByTestId(`visual-card-${futureProposal.id}`),
    ).toHaveAttribute("data-future-id", futureRevision.id);
    expect(screen.getByText("Refines Diagram overview")).toBeInTheDocument();
  });
});
