import React from "react";
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalGroupLifecycle,
  ProposalOutOfDateStatus,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  WorkItemChangeSetMaterializationState,
  type ProposalGroupMembership,
  type ProposalResponseDto,
} from "../../../api";
import type { OnApplyProposal } from "../../ProposalDispatchers";
import { ProposalDetail } from "../ProposalDetail";
import { ActionsCapsuleProvider } from "../../ActionsCapsule/ActionsCapsuleProvider";
import { useActionsCapsule } from "../../ActionsCapsule/ActionsCapsuleContext";

const mockInvalidateConversation = vi.fn();
const mockInvalidateReview = vi.fn();
const mockPatch = vi.fn();
const mockReject = vi.fn();
const mockRefetch = vi.fn();

vi.mock("../../../data/hooks/useInvalidateConversation", () => ({
  useInvalidateConversation: () => mockInvalidateConversation,
}));
vi.mock("../../../data/hooks/useInvalidateProposalReview", () => ({
  useInvalidateProposalReview: () => mockInvalidateReview,
}));

vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: {
    updateProposal: (...args: unknown[]) => mockPatch(...args),
    rejectProposal: (...args: unknown[]) => mockReject(...args),
  },
}));

const CONVERSATION_ID = "conv-abc";

const buildProposal = (
  action: ProposalAction,
  status: ProposalStatus = ProposalStatus.Draft,
  updates: Record<string, unknown> = {},
  proposalId = "prop-1",
): ProposalResponseDto =>
  ({
    id: proposalId,
    organizationId: "org-1",
    projectId: "proj-1",
    conversationId: CONVERSATION_ID,
    action,
    status,
    type: currentType,
    targetEntityId:
      currentTargetEntityType === TargetEntityType.WorkItemType
        ? "JOB_APPLICATION_RECORD"
        : "tgt",
    targetEntityType: currentTargetEntityType,
    updates,
    requestorId: "user-1",
    requiredApprovals: 2,
    approvals: [],
    outOfDateStatus: ProposalOutOfDateStatus.Current,
    materialization: currentMaterialization,
    groupMembership: currentGroupMembership,
    createdAt: "2026-04-16T00:00:00Z",
    updatedAt: "2026-04-16T00:00:00Z",
  }) as unknown as ProposalResponseDto;

let currentStatus: ProposalStatus = ProposalStatus.Draft;
let currentTargetEntityType: TargetEntityType = TargetEntityType.Task;
let currentAction: ProposalAction = ProposalAction.Create;
let currentUpdates: Record<string, unknown> = {};
let currentType: ProposalType = ProposalType.Single;
let currentMaterialization: ProposalResponseDto["materialization"];
let currentGroupMembership: ProposalGroupMembership | undefined;

const setProposalState = (
  status: ProposalStatus,
  action: ProposalAction = ProposalAction.Create,
  updates: Record<string, unknown> = {},
): void => {
  currentStatus = status;
  currentAction = action;
  currentUpdates = updates;
  currentType = ProposalType.Single;
  currentMaterialization = undefined;
  currentGroupMembership = undefined;
};

const setGraphProposalState = (
  status: ProposalStatus,
  materialization?: ProposalResponseDto["materialization"],
  updates: Record<string, unknown> = {
    root: { refType: "existing", id: "tgt" },
    operations: [],
  },
): void => {
  currentStatus = status;
  currentAction = ProposalAction.Update;
  currentType = ProposalType.Single;
  currentUpdates = updates;
  currentMaterialization = materialization;
};

vi.mock("../../../data/hooks/useProposal", () => ({
  useProposal: (
    _organizationId: string,
    _projectId: string,
    proposalId: string,
  ) => ({
    proposal: buildProposal(
      currentAction,
      currentStatus,
      currentUpdates,
      proposalId,
    ),
    isLoading: false,
    error: null,
    refetch: mockRefetch,
  }),
}));

vi.mock("../../../data/hooks/useProject", () => ({
  useProject: () => ({ data: { id: "proj-1", name: "Test Project" } }),
}));

vi.mock("../../../data/hooks/useConversation", () => ({
  useConversation: () => ({
    data: { id: CONVERSATION_ID, messages: [] },
  }),
}));

vi.mock("../../Conversation", () => ({
  DISABLED_CONVERSATION_SCROLL_POLICY: {
    mode: "disabled",
  },
  ConversationPanelLayout: ({
    leftContent,
    rightContent,
  }: {
    leftContent: React.ReactNode;
    rightContent: React.ReactNode;
  }) => (
    <div>
      <div data-testid="left-pane">{leftContent}</div>
      <div data-testid="right-pane">{rightContent}</div>
    </div>
  ),
  ConversationViewer: () => <div data-testid="conversation-viewer" />,
  useConversationPanel: () => ({ isExpanded: false }),
}));

vi.mock("../../Entity", () => ({
  EntityLinkWithPreview: () => <div />,
}));

vi.mock("../../InteractionComponent", () => ({
  InteractionComponent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../../AgentSession/RefinerChat", () => ({
  RefinerChat: () => <div data-testid="proposal-refiner-chat" />,
}));

vi.mock("../../ProposalGroupReview", () => ({
  ProposalGroupReview: ({ groupId }: { groupId: string }) => (
    <div data-testid="proposal-group-review" data-group-id={groupId} />
  ),
}));

const mockUseFullEntityContext = vi.fn();

vi.mock("../../../data/hooks/useFullEntityContext", () => ({
  useFullEntityContext: (...args: unknown[]) =>
    mockUseFullEntityContext(...args),
}));

vi.mock("../../Features/FeatureTreeVisualization", () => ({
  __esModule: true,
  default: (props: { focusedFeatureId?: string }) => (
    <div
      data-testid="feature-tree-visualization"
      data-focused-feature-id={props.focusedFeatureId}
    />
  ),
}));

type HandlerCapture = {
  organizationId: string;
  projectId: string;
  proposals: ProposalResponseDto[];
  onApply: OnApplyProposal;
  onApplied?: (id: string) => void | Promise<void>;
  onReject: (id: string, reason: string) => Promise<void>;
};

const captured: {
  create?: HandlerCapture;
  update?: HandlerCapture;
  delete?: HandlerCapture;
} = {};

vi.mock("../../ProposalDispatchers", () => ({
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
  isWorkItemGraphProposal: (proposal: ProposalResponseDto) =>
    proposal.action === ProposalAction.Update &&
    typeof proposal.updates === "object" &&
    proposal.updates !== null &&
    "root" in proposal.updates &&
    "operations" in proposal.updates,
}));

interface RegisteredAction {
  id: string;
  label: string;
  behavior: string;
  onClick?: () => void;
}

const ActionsHarness: React.FC<{
  onActions: (actions: RegisteredAction[]) => void;
}> = ({ onActions }) => {
  const ctx = useActionsCapsule();
  React.useEffect(() => {
    onActions(ctx.actions as unknown as RegisteredAction[]);
  }, [ctx.actions, onActions]);
  return null;
};

const renderWithProviders = (
  ui: React.ReactNode,
): {
  getLatestActions: () => RegisteredAction[];
  rerender: (nextUi: React.ReactNode) => void;
} => {
  const seen: RegisteredAction[][] = [];
  const onActions = (actions: RegisteredAction[]): void => {
    seen.push(actions);
  };
  const withProviders = (content: React.ReactNode) => (
    <ActionsCapsuleProvider>
      {content}
      <ActionsHarness onActions={onActions} />
    </ActionsCapsuleProvider>
  );
  const rendered = render(withProviders(ui));
  return {
    getLatestActions: () => seen[seen.length - 1] ?? [],
    rerender: (nextUi) => rendered.rerender(withProviders(nextUi)),
  };
};

const findModeToggle = (
  actions: RegisteredAction[],
): RegisteredAction | undefined =>
  actions.find((a) => a.id === "proposal-mode-toggle");

beforeEach(() => {
  currentTargetEntityType = TargetEntityType.Task;
  vi.clearAllMocks();
  captured.create = undefined;
  captured.update = undefined;
  captured.delete = undefined;
  mockPatch.mockImplementation(
    async ({ proposalId }: { proposalId: string }) => ({
      data: {
        data: buildProposal(
          currentAction,
          ProposalStatus.Approved,
          currentUpdates,
          proposalId,
        ),
      },
    }),
  );
  mockReject.mockResolvedValue({});
  mockRefetch.mockResolvedValue(null);
  setProposalState(ProposalStatus.Draft, ProposalAction.Create);
  mockUseFullEntityContext.mockReturnValue({
    data: null,
    isLoading: false,
    isFetched: false,
    error: null,
    refetch: vi.fn(),
  });
});

describe("ProposalDetail accept/reject cache invalidation", () => {
  it("forwards complete type-definition updates and working review callbacks", async () => {
    const updates = {
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
          { key: "notes", label: "Notes", writingStandard: "Preserve notes." },
        ],
      },
    };
    setProposalState(ProposalStatus.Draft, ProposalAction.Update, updates);
    currentTargetEntityType = TargetEntityType.WorkItemType;
    renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
      />,
    );
    expect(captured.update).toMatchObject({
      organizationId: "org-1",
      projectId: "proj-1",
      proposals: [
        {
          updates,
          targetEntityType: TargetEntityType.WorkItemType,
          targetEntityId: "JOB_APPLICATION_RECORD",
        },
      ],
    });
    await act(async () => {
      await captured.update!.onApply("prop-1");
    });
    expect(mockPatch).toHaveBeenCalledOnce();
    await act(async () => {
      await captured.update!.onReject("prop-1", "Keep the current standard");
    });
    expect(mockReject).toHaveBeenCalledOnce();
    expect(mockInvalidateConversation).toHaveBeenCalledWith(CONVERSATION_ID);
  });
  it("publishes the display title from the already-loaded proposal", () => {
    const onPresentationLoaded = vi.fn();
    setProposalState(ProposalStatus.Draft, ProposalAction.Update, {
      name: "Update launch policy",
    });

    renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
        onPresentationLoaded={onPresentationLoaded}
      />,
    );

    expect(onPresentationLoaded).toHaveBeenCalledWith("Update launch policy");
  });

  it("passes API-owned approval state to the shared proposal renderer", () => {
    renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
      />,
    );

    expect(captured.create?.proposals[0]).toMatchObject({
      requiredApprovals: 2,
      approvals: [],
    });
  });

  it("marks the originating conversation stale after accept", async () => {
    renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
      />,
    );

    expect(captured.create).toBeDefined();
    await captured.create!.onApply("prop-1");

    expect(mockPatch).toHaveBeenCalledTimes(1);
    expect(mockInvalidateReview).toHaveBeenCalledWith("org-1", "proj-1");
    expect(mockInvalidateConversation).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });

  it("includes out-of-date acknowledgement in the generated approval request", async () => {
    setProposalState(ProposalStatus.Draft, ProposalAction.Update);
    renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
      />,
    );

    await captured.update!.onApply("prop-1", {
      acknowledgeOutOfDate: true,
    });

    expect(mockPatch).toHaveBeenCalledWith(
      expect.objectContaining({
        updateProposalDto: {
          status: ProposalStatus.Approved,
          acknowledgeOutOfDate: true,
        },
      }),
    );
  });

  it("marks the originating conversation stale after reject", async () => {
    renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
      />,
    );

    expect(captured.create).toBeDefined();
    await captured.create!.onReject("prop-1", "nope");

    expect(mockReject).toHaveBeenCalledTimes(1);
    expect(mockInvalidateReview).toHaveBeenCalledWith("org-1", "proj-1");
    expect(mockInvalidateConversation).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(mockRefetch).toHaveBeenCalledTimes(1);
  });
});

describe("ProposalDetail ungrouped compatibility", () => {
  it("uses the shared CREATE review path for a custom work-item type", () => {
    currentTargetEntityType = TargetEntityType.WorkItemType;
    setProposalState(ProposalStatus.Draft, ProposalAction.Create, {
      key: "RESEARCH_FINDING",
      name: "Research Finding",
      role: "work-item",
      sections: [{ key: "finding", label: "Finding" }],
      allowedStatuses: ["BACKLOG"],
    });

    renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
      />,
    );

    expect(captured.create?.proposals).toEqual([
      expect.objectContaining({
        targetEntityType: TargetEntityType.WorkItemType,
        updates: expect.objectContaining({ key: "RESEARCH_FINDING" }),
      }),
    ]);
    expect(captured.update).toBeUndefined();
  });

  it.each([
    [ProposalAction.Create, "create-proposal"],
    [ProposalAction.Update, "update-proposal"],
    [ProposalAction.Delete, "delete-proposal"],
  ] as const)(
    "keeps the %s renderer when group membership is absent",
    (action, testId) => {
      setProposalState(ProposalStatus.Draft, action);
      renderWithProviders(
        <ProposalDetail
          proposalId="prop-1"
          organizationId="org-1"
          projectId="proj-1"
        />,
      );

      expect(screen.getByTestId(testId)).toBeInTheDocument();
      expect(
        captured[
          action === ProposalAction.Create
            ? "create"
            : action === ProposalAction.Update
              ? "update"
              : "delete"
        ]?.proposals[0].groupMembership,
      ).toBeUndefined();
    },
  );

  it("renders the canonical group and exposes no draft editing when membership exists", () => {
    currentGroupMembership = {
      groupId: "group-1",
      memberId: "member-1",
      memberOrder: 0,
      revision: 2,
      lifecycle: ProposalGroupLifecycle.Reviewable,
    };

    const { getLatestActions } = renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
        initialEditing
      />,
    );

    expect(screen.getByTestId("proposal-group-review")).toHaveAttribute(
      "data-group-id",
      "group-1",
    );
    expect(
      screen.queryByTestId("proposal-refiner-chat"),
    ).not.toBeInTheDocument();
    expect(findModeToggle(getLatestActions())).toBeUndefined();
  });
});

describe("ProposalDetail graph completion", () => {
  it("passes the complete mixed graph update intact to proposal detail review", () => {
    const updates = {
      root: { refType: "existing", id: "tgt" },
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
    };
    setGraphProposalState(ProposalStatus.Draft, undefined, updates);

    renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
      />,
    );

    expect(captured.update?.proposals[0]?.updates).toEqual(updates);
  });

  it("notifies exactly once after the approval response reports complete materialization", async () => {
    setGraphProposalState(ProposalStatus.Draft);
    mockPatch.mockResolvedValue({
      data: {
        data: {
          ...buildProposal(ProposalAction.Update, ProposalStatus.Approved),
          materialization: {
            state: WorkItemChangeSetMaterializationState.Published,
            attemptCount: 1,
            operations: [],
          },
        },
      },
    });
    const onApplied = vi.fn();

    renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
        onApplied={onApplied}
      />,
    );

    expect(captured.update?.onApplied).toBeDefined();
    await captured.update!.onApply("prop-1");
    await captured.update!.onApplied?.("prop-1");
    await captured.update!.onApplied?.("prop-1");

    expect(onApplied).toHaveBeenCalledTimes(1);
    expect(onApplied).toHaveBeenCalledWith("prop-1");
  });

  it("does not notify for an incomplete or failed approval response", async () => {
    setGraphProposalState(ProposalStatus.Draft);
    mockPatch.mockResolvedValue({
      data: {
        data: {
          ...buildProposal(ProposalAction.Update, ProposalStatus.Draft),
          materialization: {
            state: WorkItemChangeSetMaterializationState.RecoverableFailure,
            attemptCount: 1,
            lastError: "Graph write failed",
            operations: [],
          },
        },
      },
    });
    const onApplied = vi.fn();

    renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
        onApplied={onApplied}
      />,
    );

    await expect(captured.update!.onApply("prop-1")).resolves.toMatchObject({
      materialization: {
        state: WorkItemChangeSetMaterializationState.RecoverableFailure,
        lastError: "Graph write failed",
      },
    });
    expect(onApplied).not.toHaveBeenCalled();
  });

  it("resumes from published server state after refresh without notifying twice", async () => {
    setGraphProposalState(ProposalStatus.Approved, {
      state: WorkItemChangeSetMaterializationState.Published,
      attemptCount: 2,
      operations: [],
    });
    const onApplied = vi.fn();

    renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
        onApplied={onApplied}
      />,
    );

    await act(async () => undefined);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("does not retry a published-state completion notification after it rejects", async () => {
    setGraphProposalState(ProposalStatus.Approved, {
      state: WorkItemChangeSetMaterializationState.Published,
      attemptCount: 2,
      operations: [],
    });
    const onApplied = vi.fn().mockRejectedValue(new Error("navigation failed"));

    const { rerender } = renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
        onApplied={onApplied}
      />,
    );

    await act(async () => undefined);
    rerender(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
        onApplied={onApplied}
      />,
    );
    await act(async () => undefined);

    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("polls an interrupted active attempt without reporting completion", async () => {
    vi.useFakeTimers();
    try {
      setGraphProposalState(ProposalStatus.Draft, {
        state: WorkItemChangeSetMaterializationState.Applying,
        attemptCount: 1,
        operations: [],
      });
      const onApplied = vi.fn();

      renderWithProviders(
        <ProposalDetail
          proposalId="prop-1"
          organizationId="org-1"
          projectId="proj-1"
          onApplied={onApplied}
        />,
      );

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });

      expect(mockRefetch).toHaveBeenCalledTimes(1);
      expect(onApplied).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("never reports a rejected graph review as applied", async () => {
    setGraphProposalState(ProposalStatus.Rejected, {
      state: WorkItemChangeSetMaterializationState.Published,
      attemptCount: 1,
      operations: [],
    });
    const onApplied = vi.fn();

    renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
        onApplied={onApplied}
      />,
    );

    await act(async () => undefined);
    expect(onApplied).not.toHaveBeenCalled();
  });
});

describe("ProposalDetail mode toggle", () => {
  it("defaults to Read mode when status is DRAFT", () => {
    setProposalState(ProposalStatus.Draft);

    const { getLatestActions } = renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
      />,
    );

    expect(
      screen.queryByTestId("proposal-refiner-chat"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("conversation-viewer")).not.toBeInTheDocument();

    const toggle = findModeToggle(getLatestActions());
    expect(toggle).toBeDefined();
    expect(toggle?.label).toBe("Edit");
  });

  it("defaults to Read mode when status is APPROVED", () => {
    setProposalState(ProposalStatus.Approved);

    const { getLatestActions } = renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
      />,
    );

    expect(screen.queryByTestId("conversation-viewer")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("proposal-refiner-chat"),
    ).not.toBeInTheDocument();

    const toggle = findModeToggle(getLatestActions());
    expect(toggle).toBeDefined();
    expect(toggle?.label).toBe("Edit");
  });

  it("defaults to Read mode when status is REJECTED", () => {
    setProposalState(ProposalStatus.Rejected);

    const { getLatestActions } = renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
      />,
    );

    expect(screen.queryByTestId("conversation-viewer")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("proposal-refiner-chat"),
    ).not.toBeInTheDocument();

    const toggle = findModeToggle(getLatestActions());
    expect(toggle?.label).toBe("Edit");
  });

  it("swaps the right pane to the refiner chat when Edit is clicked from Read mode", async () => {
    setProposalState(ProposalStatus.Approved);

    const { getLatestActions } = renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
      />,
    );

    expect(screen.queryByTestId("conversation-viewer")).not.toBeInTheDocument();
    expect(screen.getByTestId("create-proposal")).toBeInTheDocument();

    const toggle = findModeToggle(getLatestActions());
    expect(toggle?.label).toBe("Edit");

    await act(async () => {
      toggle?.onClick?.();
    });

    expect(screen.getByTestId("proposal-refiner-chat")).toBeInTheDocument();
    expect(screen.queryByTestId("conversation-viewer")).not.toBeInTheDocument();
    // Left pane is untouched — proposal dispatcher remains
    expect(screen.getByTestId("create-proposal")).toBeInTheDocument();

    const toggleAfter = findModeToggle(getLatestActions());
    expect(toggleAfter?.label).toBe("Done");
  });

  it.each([
    ProposalStatus.Draft,
    ProposalStatus.Approved,
    ProposalStatus.Rejected,
  ])(
    "renders ProposalRefinerChat in edit mode for proposal status %s",
    async (status) => {
      setProposalState(status);

      const { getLatestActions } = renderWithProviders(
        <ProposalDetail
          proposalId="prop-1"
          organizationId="org-1"
          projectId="proj-1"
        />,
      );

      const toggle = findModeToggle(getLatestActions());
      expect(toggle?.label).toBe("Edit");
      await act(async () => {
        toggle?.onClick?.();
      });

      expect(screen.getByTestId("proposal-refiner-chat")).toBeInTheDocument();
      expect(
        screen.queryByTestId("conversation-viewer"),
      ).not.toBeInTheDocument();
    },
  );

  it("opens in Read mode when initialEditing is true", () => {
    setProposalState(ProposalStatus.Approved);

    const { getLatestActions } = renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
        initialEditing
      />,
    );

    expect(
      screen.queryByTestId("proposal-refiner-chat"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("conversation-viewer")).not.toBeInTheDocument();

    const toggle = findModeToggle(getLatestActions());
    expect(toggle?.label).toBe("Edit");
  });

  it("opens in Read mode when initialEditing is false", () => {
    setProposalState(ProposalStatus.Approved);

    const { getLatestActions } = renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
        initialEditing={false}
      />,
    );

    expect(screen.queryByTestId("conversation-viewer")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("proposal-refiner-chat"),
    ).not.toBeInTheDocument();

    const toggle = findModeToggle(getLatestActions());
    expect(toggle?.label).toBe("Edit");
  });

  it("returns to Read mode when Done is clicked from Edit mode", async () => {
    setProposalState(ProposalStatus.Draft);

    const { getLatestActions } = renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
      />,
    );

    expect(
      screen.queryByTestId("proposal-refiner-chat"),
    ).not.toBeInTheDocument();

    const toggle = findModeToggle(getLatestActions());
    expect(toggle?.label).toBe("Edit");

    await act(async () => {
      toggle?.onClick?.();
    });

    expect(screen.getByTestId("proposal-refiner-chat")).toBeInTheDocument();

    const doneToggle = findModeToggle(getLatestActions());
    expect(doneToggle?.label).toBe("Done");
    await act(async () => {
      doneToggle?.onClick?.();
    });

    expect(screen.queryByTestId("conversation-viewer")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("proposal-refiner-chat"),
    ).not.toBeInTheDocument();

    const toggleAfter = findModeToggle(getLatestActions());
    expect(toggleAfter?.label).toBe("Edit");
  });

  it("resets to Read when the proposal identity changes", async () => {
    setProposalState(ProposalStatus.Approved);

    const { getLatestActions, rerender } = renderWithProviders(
      <ProposalDetail
        proposalId="prop-1"
        organizationId="org-1"
        projectId="proj-1"
      />,
    );

    await act(async () => {
      findModeToggle(getLatestActions())?.onClick?.();
    });
    expect(screen.getByTestId("proposal-refiner-chat")).toBeInTheDocument();
    expect(findModeToggle(getLatestActions())?.label).toBe("Done");

    rerender(
      <ProposalDetail
        proposalId="prop-2"
        organizationId="org-1"
        projectId="proj-1"
      />,
    );

    expect(
      screen.queryByTestId("proposal-refiner-chat"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("conversation-viewer")).not.toBeInTheDocument();
    expect(findModeToggle(getLatestActions())?.label).toBe("Edit");
  });
});

describe("ProposalDetail full-width read mode", () => {
  it.each([ProposalAction.Create, ProposalAction.Update])(
    "removes placement and influences for %s proposals",
    (action) => {
      setProposalState(ProposalStatus.Approved, action);
      renderWithProviders(
        <ProposalDetail
          proposalId="prop-1"
          organizationId="org-1"
          projectId="proj-1"
        />,
      );
      expect(
        screen.queryByTestId("proposal-placement-block"),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("proposal-influences-block"),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId("right-pane")).toBeEmptyDOMElement();
    },
  );
});
