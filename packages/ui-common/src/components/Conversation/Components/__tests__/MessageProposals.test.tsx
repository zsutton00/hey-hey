import React, { type ReactNode } from "react";
import { act, render } from "@testing-library/react";
import { Provider, createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalGroupLifecycle,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
  type SystemMessage,
} from "../../../../api";
import { designDocStateAtom } from "../../../../data/collections/designDocs";
import { CollectionMap } from "../../../../data/core/CollectionMap";
import { ListQueryMap } from "../../../../data/core/ListQueryMap";
import type { ConversationMessage } from "../../../../types/conversation";
import type { ProposalsAcceptedHandler } from "../../hooks/proposalsAcceptedTypes";
import type { OnApplyProposal } from "../../../ProposalDispatchers";
import { MessageProposals } from "../MessageProposals";
import { __resetEmittedMessageIdsForTests } from "../messageProposalsEmission";
import { __resetForTests as resetProposalCache } from "../../../ProposalDispatchers/proposalSelectedStateCache";

const mockInvalidateConversation = vi.fn();
const mockPatch = vi.fn();
const mockReject = vi.fn();
let mockOnProposalsAccepted: ProposalsAcceptedHandler | undefined;
const capturedGroupIds: string[] = [];

vi.mock("../../../../data/hooks/useInvalidateConversation", () => ({
  useInvalidateConversation: () => mockInvalidateConversation,
}));

vi.mock("../../../../clients/serviceClients", () => ({
  proposalsClient: {
    updateProposal: (...args: unknown[]) => mockPatch(...args),
    rejectProposal: (...args: unknown[]) => mockReject(...args),
  },
}));

vi.mock("../ConversationContext", () => ({
  useConversationContext: () => ({
    project: { id: "proj-1", organizationId: "org-1" },
    onProposalsAccepted: mockOnProposalsAccepted,
  }),
}));

type HandlerCapture = {
  organizationId: string;
  projectId: string;
  proposals: ProposalResponseDto[];
  onApply: OnApplyProposal;
  onApplied?: (proposalId: string) => Promise<void> | void;
  onReject: (proposalId: string, reason: string) => Promise<void>;
};

const captured: {
  create?: HandlerCapture;
  update?: HandlerCapture;
  delete?: HandlerCapture;
} = {};

vi.mock("../../../ProposalDispatchers", () => ({
  CreateProposal: (props: HandlerCapture) => {
    captured.create = props;
    return <div data-testid="create-proposal" />;
  },
  UpdateProposal: (props: HandlerCapture) => {
    captured.update = props;
    return <div data-testid="update-proposal" />;
  },
  DeleteProposal: (props: HandlerCapture) => {
    captured.delete = props;
    return <div data-testid="delete-proposal" />;
  },
}));

vi.mock("../../../ProposalGroupReview", () => ({
  ProposalGroupReview: ({ groupId }: { groupId: string }) => {
    capturedGroupIds.push(groupId);
    return <div data-testid="proposal-group-review" data-group-id={groupId} />;
  },
}));

const CONVERSATION_ID = "conv-xyz";
const TRIGGERING_MESSAGE_ID = "msg-1";

const buildProposal = (
  id: string,
  action: ProposalAction,
  status: ProposalStatus = ProposalStatus.Draft,
): ProposalResponseDto =>
  ({
    id,
    organizationId: "org-1",
    projectId: "proj-1",
    conversationId: CONVERSATION_ID,
    action,
    status,
    type: ProposalType.TaskCreate,
    targetEntityId: "tgt",
    targetEntityType: TargetEntityType.Task,
    updates: {},
    requestorId: "user-1",
    requiredApprovals: 2,
    approvals: [],
    createdAt: "2026-04-16T00:00:00Z",
    updatedAt: "2026-04-16T00:00:00Z",
  }) as unknown as ProposalResponseDto;

const buildConversationMessage = (
  proposals: ProposalResponseDto[],
  revisionId?: string,
): ConversationMessage =>
  ({
    message: {
      id: TRIGGERING_MESSAGE_ID,
      type: "SYSTEM",
      conversationId: CONVERSATION_ID,
      proposals,
      data: revisionId
        ? {
            uiElements: [
              {
                id: "stage-review",
                type: "plan_generation_stage_review",
              },
            ],
          }
        : {},
      parentMessage: revisionId
        ? {
            id: "completion-message",
            type: "SYSTEM",
            data: {
              type: "AGENT",
              completesExternalAgentNode: {
                action: "READY",
                nodeId: "plan-shaping-proposed-stages",
                completesTriggerMessageId: revisionId,
                payload: {
                  revisionId,
                  expectedStageCount: proposals.length,
                },
              },
            },
          }
        : undefined,
    } as unknown as SystemMessage,
    state: "open",
    canEdit: false,
  }) as ConversationMessage;

describe("MessageProposals accept/reject cache invalidation", () => {
  it("forwards complete type-definition updates and working review callbacks", async () => {
    const proposal: ProposalResponseDto = {
      ...buildProposal("type-edit", ProposalAction.Update),
      type: ProposalType.Single,
      targetEntityType: TargetEntityType.WorkItemType,
      targetEntityId: "JOB_APPLICATION_RECORD",
      updates: {
        definition: {
          key: "JOB_APPLICATION_RECORD",
          name: "Job application record",
          role: "work-item",
          allowedStatuses: ["NOT_STARTED"],
          sections: [
            {
              key: "application",
              label: "Application details",
              kind: "json",
              schemaRef: "#/components/schemas/Application",
              writingStandard: "Record the complete application.",
            },
            {
              key: "notes",
              label: "Notes",
              writingStandard: "Preserve notes.",
            },
          ],
        },
      },
    };
    render(
      <MessageProposals
        conversationMessage={buildConversationMessage([proposal])}
      />,
    );
    expect(captured.update).toMatchObject({
      proposals: [proposal],
      organizationId: "org-1",
      projectId: "proj-1",
    });
    await captured.update!.onApply(proposal.id);
    expect(mockPatch).toHaveBeenCalledOnce();
    await captured.update!.onReject(proposal.id, "Keep the current standard");
    expect(mockReject).toHaveBeenCalledOnce();
    expect(mockInvalidateConversation).toHaveBeenCalledWith(CONVERSATION_ID);
  });
  beforeEach(() => {
    vi.clearAllMocks();
    resetProposalCache();
    __resetEmittedMessageIdsForTests();
    captured.create = undefined;
    captured.update = undefined;
    captured.delete = undefined;
    capturedGroupIds.length = 0;
    mockPatch.mockImplementation(
      async ({ proposalId }: { proposalId: string }) => ({
        data: {
          data: buildProposal(
            proposalId,
            ProposalAction.Create,
            ProposalStatus.Approved,
          ),
        },
      }),
    );
    mockReject.mockResolvedValue({});
    mockOnProposalsAccepted = undefined;
  });

  it("marks the conversation item stale after accepting a proposal", async () => {
    const proposal = buildProposal("prop-1", ProposalAction.Create);
    render(
      <MessageProposals
        conversationMessage={buildConversationMessage([proposal])}
      />,
    );

    expect(captured.create).toBeDefined();
    await captured.create!.onApply("prop-1");

    expect(mockPatch).toHaveBeenCalledTimes(1);
    expect(mockInvalidateConversation).toHaveBeenCalledWith(CONVERSATION_ID);
  });

  it("passes API-owned approval state to the shared proposal renderer", () => {
    const proposal = buildProposal("prop-progress", ProposalAction.Create);

    render(
      <MessageProposals
        conversationMessage={buildConversationMessage([proposal])}
      />,
    );

    expect(captured.create?.proposals[0]).toMatchObject({
      requiredApprovals: 2,
      approvals: [],
    });
  });

  it("forwards generated future proposal response data to shared update review", () => {
    const proposal: ProposalResponseDto = {
      ...buildProposal("future-proposal", ProposalAction.VersionedUpdate),
      status: ProposalStatus.Approved,
      reviewedFuture: null,
    };

    render(
      <MessageProposals
        conversationMessage={buildConversationMessage([proposal])}
      />,
    );

    expect(captured.update?.proposals).toEqual([proposal]);
    expect(captured.update?.proposals[0]).toBe(proposal);
  });

  it("refreshes the conversation after future Apply and keeps the same future identity", async () => {
    const reviewedFuture = {
      id: "future-identity",
      outcome: "STAGED",
      revision: 3,
    } as NonNullable<ProposalResponseDto["reviewedFuture"]>;
    const proposal: ProposalResponseDto = {
      ...buildProposal("future-proposal", ProposalAction.VersionedUpdate),
      status: ProposalStatus.Approved,
      reviewedFuture,
    };
    const view = render(
      <MessageProposals
        conversationMessage={buildConversationMessage([proposal])}
      />,
    );

    expect(captured.update?.proposals[0]?.reviewedFuture?.id).toBe(
      reviewedFuture.id,
    );
    await captured.update?.onApplied?.(proposal.id);

    expect(mockInvalidateConversation).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(mockPatch).not.toHaveBeenCalled();

    const appliedProposal: ProposalResponseDto = {
      ...proposal,
      reviewedFuture: {
        ...reviewedFuture,
        outcome: "APPLIED",
        appliedRevision: 3,
      },
    };
    view.rerender(
      <MessageProposals
        conversationMessage={buildConversationMessage([appliedProposal])}
      />,
    );

    expect(captured.update?.proposals[0]?.reviewedFuture).toMatchObject({
      id: reviewedFuture.id,
      outcome: "APPLIED",
      appliedRevision: 3,
    });
  });

  it("passes a mixed workflow graph update intact to inline review", () => {
    const proposal = {
      ...buildProposal("prop-graph", ProposalAction.Update),
      type: ProposalType.Single,
      updates: {
        root: { refType: "existing", id: "workflow-1" },
        operations: [
          {
            op: "section.replace",
            ref: { refType: "existing", id: "continue-step" },
            key: "description",
            content: "Launch exactly one ready task after completion.",
          },
          {
            op: "relationship.delete",
            ref: { refType: "existing", id: "old-fulfillment" },
          },
          {
            op: "relationship.create",
            ref: { refType: "temporary", tempId: "new-fulfillment" },
            source: { refType: "existing", id: "continue-step" },
            target: { refType: "existing", id: "continuation-bug" },
            edgeType: "FULFILLED_BY",
            category: "META",
          },
        ],
      },
    } as ProposalResponseDto;

    render(
      <MessageProposals
        conversationMessage={buildConversationMessage([proposal])}
      />,
    );

    expect(captured.update?.proposals).toEqual([proposal]);
    expect(captured.update?.proposals[0]?.updates).toEqual(proposal.updates);
  });

  it("marks the conversation item stale after rejecting a proposal", async () => {
    const proposal = buildProposal("prop-2", ProposalAction.Update);
    render(
      <MessageProposals
        conversationMessage={buildConversationMessage([proposal])}
      />,
    );

    expect(captured.update).toBeDefined();
    await captured.update!.onReject("prop-2", "not needed");

    expect(mockReject).toHaveBeenCalledTimes(1);
    expect(mockInvalidateConversation).toHaveBeenCalledWith(CONVERSATION_ID);
  });

  it("keeps ordinary update approval refresh behavior single-shot", async () => {
    const proposal = buildProposal("ordinary-update", ProposalAction.Update);
    render(
      <MessageProposals
        conversationMessage={buildConversationMessage([proposal])}
      />,
    );

    await captured.update!.onApply(proposal.id);
    await captured.update!.onApplied?.(proposal.id);

    expect(mockPatch).toHaveBeenCalledOnce();
    expect(mockInvalidateConversation).toHaveBeenCalledTimes(1);
  });
});

describe("MessageProposals ungrouped compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProposalCache();
    __resetEmittedMessageIdsForTests();
    captured.create = undefined;
    captured.update = undefined;
    captured.delete = undefined;
    capturedGroupIds.length = 0;
    mockPatch.mockImplementation(
      async ({ proposalId }: { proposalId: string }) => ({
        data: {
          data: buildProposal(
            proposalId,
            ProposalAction.Create,
            ProposalStatus.Approved,
          ),
        },
      }),
    );
    mockReject.mockResolvedValue({});
    mockOnProposalsAccepted = undefined;
  });

  it("keeps action renderers and decision calls when group membership is absent", async () => {
    render(
      <MessageProposals
        conversationMessage={buildConversationMessage([
          buildProposal("p-create", ProposalAction.Create),
          buildProposal("p-update", ProposalAction.Update),
          buildProposal("p-delete", ProposalAction.Delete),
        ])}
      />,
    );

    expect(captured.create).toBeDefined();
    expect(captured.update).toBeDefined();
    expect(captured.delete).toBeDefined();
    expect(captured.create?.proposals[0].groupMembership).toBeUndefined();

    await captured.create!.onApply("p-create");
    await captured.update!.onReject("p-update", "skip");
    await captured.delete!.onApply("p-delete");

    expect(mockPatch).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        proposalId: "p-create",
        updateProposalDto: { status: ProposalStatus.Approved },
      }),
    );
    expect(mockPatch).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        proposalId: "p-delete",
        updateProposalDto: { status: ProposalStatus.Approved },
      }),
    );
    expect(mockReject).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        proposalId: "p-update",
        rejectProposalDto: { reason: "skip" },
      }),
    );
    expect(mockInvalidateConversation).toHaveBeenCalledTimes(3);
  });

  it("deduplicates explicit group identities and keeps grouped proposals out of action renderers", () => {
    const first = buildProposal("p-group-1", ProposalAction.Create);
    first.groupMembership = {
      groupId: "group-1",
      memberId: "member-1",
      memberOrder: 0,
      revision: 2,
      lifecycle: ProposalGroupLifecycle.Reviewable,
    };
    const second = buildProposal("p-group-2", ProposalAction.Update);
    second.groupMembership = {
      groupId: "group-1",
      memberId: "member-2",
      memberOrder: 1,
      revision: 2,
      lifecycle: ProposalGroupLifecycle.Reviewable,
    };
    const ungrouped = buildProposal("p-ungrouped", ProposalAction.Delete);

    render(
      <MessageProposals
        conversationMessage={buildConversationMessage([
          first,
          second,
          ungrouped,
        ])}
      />,
    );

    expect(capturedGroupIds).toEqual(["group-1"]);
    expect(captured.create).toBeUndefined();
    expect(captured.update).toBeUndefined();
    expect(captured.delete?.proposals).toEqual([ungrouped]);
  });
});

describe("MessageProposals push-from-source onProposalsAccepted", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetProposalCache();
    __resetEmittedMessageIdsForTests();
    captured.create = undefined;
    captured.update = undefined;
    captured.delete = undefined;
    capturedGroupIds.length = 0;
    mockPatch.mockImplementation(
      async ({ proposalId }: { proposalId: string }) => ({
        data: {
          data: buildProposal(
            proposalId,
            ProposalAction.Create,
            ProposalStatus.Approved,
          ),
        },
      }),
    );
    mockReject.mockResolvedValue({});
    mockOnProposalsAccepted = vi.fn();
  });

  it("fires onProposalsAccepted exactly once when the last outstanding proposal is approved", async () => {
    const proposals = [
      buildProposal("p-1", ProposalAction.Create),
      buildProposal("p-2", ProposalAction.Create),
    ];
    const conversationMessage = buildConversationMessage(proposals);

    render(<MessageProposals conversationMessage={conversationMessage} />);

    expect(captured.create).toBeDefined();

    await captured.create!.onApply("p-1");
    expect(mockOnProposalsAccepted).not.toHaveBeenCalled();

    await captured.create!.onApply("p-2");

    expect(mockOnProposalsAccepted).toHaveBeenCalledTimes(1);
    const payload = (mockOnProposalsAccepted as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(payload.message.id).toBe(TRIGGERING_MESSAGE_ID);
    expect(payload.totalProposals).toBe(2);
    expect(payload.approvedCount).toBe(2);
    expect(payload.rejectedCount).toBe(0);
    expect(payload.acceptedProposalIds.sort()).toEqual(["p-1", "p-2"]);
    expect(payload.rejectedProposalIds).toEqual([]);
  });

  it("does not call onProposalsAccepted when any proposal in the message is rejected", async () => {
    const proposals = [
      buildProposal("p-1", ProposalAction.Create),
      buildProposal("p-2", ProposalAction.Create),
    ];

    render(
      <MessageProposals
        conversationMessage={buildConversationMessage(proposals)}
      />,
    );

    expect(captured.create).toBeDefined();

    await captured.create!.onApply("p-1");
    await captured.create!.onReject("p-2", "no");

    expect(mockOnProposalsAccepted).not.toHaveBeenCalled();
  });

  it("does not call onProposalsAccepted when proposals are still outstanding", async () => {
    const proposals = [
      buildProposal("p-1", ProposalAction.Create),
      buildProposal("p-2", ProposalAction.Create),
      buildProposal("p-3", ProposalAction.Create),
    ];

    render(
      <MessageProposals
        conversationMessage={buildConversationMessage(proposals)}
      />,
    );

    await captured.create!.onApply("p-1");

    expect(mockOnProposalsAccepted).not.toHaveBeenCalled();
  });

  it("counts proposals already terminal on mount when deciding whether to fire", async () => {
    const proposals = [
      buildProposal(
        "p-already",
        ProposalAction.Create,
        ProposalStatus.Approved,
      ),
      buildProposal("p-new", ProposalAction.Create),
    ];

    render(
      <MessageProposals
        conversationMessage={buildConversationMessage(proposals)}
      />,
    );

    await captured.create!.onApply("p-new");

    expect(mockOnProposalsAccepted).toHaveBeenCalledTimes(1);
    const payload = (mockOnProposalsAccepted as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(payload.approvedCount).toBe(2);
    expect(payload.acceptedProposalIds.sort()).toEqual(["p-already", "p-new"]);
  });

  it("still fires after a remount drops the component's local state mid-sequence", async () => {
    const proposals = [
      buildProposal("p-1", ProposalAction.Create),
      buildProposal("p-2", ProposalAction.Create),
    ];
    // The same stale conversationMessage is reused across both mounts — its
    // embedded proposals never flip to Approved, exactly as when the
    // conversation has not re-fetched yet between approvals.
    const conversationMessage = buildConversationMessage(proposals);

    const { unmount } = render(
      <MessageProposals conversationMessage={conversationMessage} />,
    );
    await captured.create!.onApply("p-1");
    expect(mockOnProposalsAccepted).not.toHaveBeenCalled();

    // Simulate the FadeIn/Fragment wrapper swap in ConversationTimeline that
    // unmounts and remounts MessageProposals between approvals.
    unmount();
    render(<MessageProposals conversationMessage={conversationMessage} />);

    await captured.create!.onApply("p-2");

    expect(mockOnProposalsAccepted).toHaveBeenCalledTimes(1);
    const payload = (mockOnProposalsAccepted as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(payload.approvedCount).toBe(2);
    expect(payload.acceptedProposalIds.sort()).toEqual(["p-1", "p-2"]);
  });

  it("does not fire a second time when an already-terminal approval is replayed", async () => {
    const proposals = [buildProposal("p-1", ProposalAction.Create)];

    render(
      <MessageProposals
        conversationMessage={buildConversationMessage(proposals)}
      />,
    );

    await captured.create!.onApply("p-1");
    expect(mockOnProposalsAccepted).toHaveBeenCalledTimes(1);

    await captured.create!.onApply("p-1");
    expect(mockOnProposalsAccepted).toHaveBeenCalledTimes(1);
  });
});
