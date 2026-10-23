import { proposalsClient } from "../../../clients/serviceClients";
import React from "react";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ProposalAction,
  ProposalApprovalType,
  ProposalGroupBlockedReason,
  ProposalGroupLifecycle,
  ProposalGroupDecisionOutcome,
  ProposalGroupMemberExecutionState,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  WorkItemTypeRole,
  type ProposalGroupMemberSnapshot,
  type ProposalGroupSnapshot,
  type ProposalResponseDto,
} from "../../../api";
import { ProposalGroupReview } from "../ProposalGroupReview";
import type { WorkflowGraphPresentationState } from "../../shared/WorkflowMentionInlineRenderer";

vi.mock("../../ProposalDispatchers/ProposalTitle", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../ProposalDispatchers/ProposalTitle")
    >();
  return {
    ...actual,
    ProposalTitle: (
      props: import("../../ProposalDispatchers/ProposalTitle").ProposalTitleProps,
    ) => (
      <div
        data-testid="shared-title-boundary"
        data-title={props.resolvedTargetName ?? props.proposal.title}
      >
        <actual.ProposalTitle {...props} />
      </div>
    ),
  };
});

vi.mock("../../InteractionComponent", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../InteractionComponent")>();
  return {
    ...actual,
    InteractionComponent: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
  };
});

const proposal = (
  id: string,
  title: string,
  action: ProposalAction,
): ProposalResponseDto => ({
  id,
  organizationId: "org-1",
  projectId: "project-1",
  type: ProposalType.Single,
  action,
  status: ProposalStatus.Draft,
  targetEntityId: `target-${id}`,
  targetEntityType: TargetEntityType.Task,
  title,
  updates: {},
  requestorId: "user-1",
  requiredApprovals: 2,
  approvals: [],
  createdAt: "2026-07-27T00:00:00Z",
  updatedAt: "2026-07-27T00:00:00Z",
});

const member = (
  memberId: string,
  memberOrder: number,
  memberProposal: ProposalResponseDto,
): ProposalGroupMemberSnapshot => ({
  memberId,
  memberOrder,
  proposal: memberProposal,
  approvalProgress: {
    receivedApprovals: memberOrder,
    requiredApprovals: 2,
    approvalSatisfied: memberOrder === 2,
  },
  executionState:
    memberOrder === 1
      ? ProposalGroupMemberExecutionState.WaitingOnDependencies
      : ProposalGroupMemberExecutionState.Ready,
  dependencies:
    memberOrder === 1
      ? [
          {
            dependentMemberId: memberId,
            prerequisiteMemberId: "member-create",
          },
        ]
      : [],
  blockedReason:
    memberOrder === 1
      ? ProposalGroupBlockedReason.DependenciesPending
      : undefined,
  attempt:
    memberOrder === 2
      ? {
          attemptCount: 2,
          lastError: "Write failed",
          diagnostic: {
            issues: [
              {
                field: "operations[0].name",
                code: "required",
                reason: "Name is required",
                layer: "structural",
              },
            ],
            issueCount: 1,
            truncated: false,
            correlationId: "member-correlation-1",
          },
        }
      : undefined,
  terminalTimestamps: {
    appliedAt: memberOrder === 2 ? "2026-07-27T01:00:00Z" : null,
    rejectedAt: null,
    invalidatedAt: null,
    failedAt: null,
  },
});

const group: ProposalGroupSnapshot = {
  groupId: "group-1",
  organizationId: "org-1",
  projectId: "project-1",
  lifecycle: ProposalGroupLifecycle.Reviewable,
  currentRevision: 4,
  frozenRevision: 4,
  members: [
    member(
      "member-update",
      1,
      proposal("proposal-update", "Update second", ProposalAction.Update),
    ),
    member(
      "member-create",
      0,
      proposal("proposal-create", "Create first", ProposalAction.Create),
    ),
    member(
      "member-delete",
      2,
      proposal("proposal-delete", "Delete third", ProposalAction.Delete),
    ),
  ],
  dependencies: [
    {
      dependentMemberId: "member-update",
      prerequisiteMemberId: "member-create",
    },
  ],
  createdAt: "2026-07-27T00:00:00Z",
  updatedAt: "2026-07-27T00:00:00Z",
};

let renderedGroup = group;
let approveAllResult:
  import("../../../api").ProposalGroupApproveAllResult | null = null;
let workItemTypeMetadataAvailable = true;
let workItemRegistryError: Error | null = null;
let decisionProposals = new Map<string, ProposalResponseDto>();
const approveMember = vi.fn().mockResolvedValue(undefined);
const rejectMember = vi.fn().mockResolvedValue(undefined);
const approveAll = vi.fn().mockResolvedValue(undefined);

type DispatcherProps = {
  renderMode?: "standalone" | "group-member";
};

interface EntityLinkMockStyle {
  color?: string;
}

type EntityLinkMockSx = EntityLinkMockStyle | EntityLinkMockStyle[];

const resolveEntityLinkMockColor = (
  sx: EntityLinkMockSx | undefined,
): string | undefined => {
  if (!Array.isArray(sx)) return sx?.color;

  return sx.reduce<string | undefined>(
    (color, style) => style.color ?? color,
    undefined,
  );
};

vi.mock("../../../data/hooks/useProposalGroup", () => ({
  useProposalGroup: () => ({
    proposalGroup: renderedGroup,
    isLoading: false,
    error: null,
    refetch: vi.fn().mockResolvedValue(renderedGroup),
  }),
}));

vi.mock("../../../data/hooks/useProposalGroupDecisions", () => ({
  useProposalGroupDecisions: () => ({
    approveMember,
    rejectMember,
    approveAll,
    decidingProposalIds: new Set(),
    isApprovingAll: false,
    approveAllResult,
    decisionProposals,
    error: null,
    clearApproveAllResult: vi.fn(),
  }),
}));

vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: (
    _organizationId: string,
    _entityType: string,
    workItemId: string,
    options: { enabled?: boolean },
  ) => ({
    workItem: options.enabled
      ? { id: workItemId, name: `Target ${workItemId}`, type: "STANDARD" }
      : null,
    isLoading: false,
  }),
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypes: () => ({
    workItemTypes: [
      {
        definition: {
          key: "DIAGRAM",
          name: "Diagram",
          role: WorkItemTypeRole.ProjectInfo,
          sections: [
            {
              key: "layout",
              kind: "json",
              schemaRef: "work-item-graph-layout.v1",
            },
          ],
          allowedStatuses: [],
          capabilities: {
            graph: {
              nodeChildType: "DIAGRAM_ELEMENT",
              layout: {
                sectionKey: "layout",
                schemaRef: "work-item-graph-layout.v1",
              },
              layoutPreference: {
                sectionKey: "layoutPreference",
                schemaRef: "work-item-graph-layout-preference.v1",
              },
              readableRelationships: [],
              editableRelationships: [],
              rendererKey: "work-item-graph",
              editorKey: "work-item-graph-editor",
              supportedActions: [],
            },
          },
        },
        status: "ACTIVE",
        projectId: "project-1",
      },
    ],
    isLoading: false,
    error: workItemRegistryError,
  }),
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: true,
    isReady: true,
    isLoading: false,
    error: null,
  }),
  useWorkItemTypeByKey: (
    _organizationId: string,
    _projectId: string,
    typeKey: string | undefined,
  ) => ({
    workItemTypeDefinition: workItemTypeMetadataAvailable
      ? [
          { key: "STANDARD", name: "Task", iconKey: "task" },
          { key: "CONTRACT", name: "Contract", iconKey: "contract" },
        ].find((definition) => definition.key === typeKey)
      : undefined,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../shared/WorkflowMentionInlineRenderer", () => ({
  WorkflowGraphSurface: ({
    projection,
    presentationState,
  }: {
    projection: {
      children: Array<{ name: string }>;
      incidentRelationships: unknown[];
    };
    presentationState?: WorkflowGraphPresentationState;
  }) => (
    <div
      data-testid="shared-work-item-graph"
      data-edge-count={projection.incidentRelationships.length}
      data-presentation-state={presentationState}
    >
      {projection.children.map(({ name }) => (
        <span key={name}>{name}</span>
      ))}
    </div>
  ),
  buildCanonicalProjectedGraphPositions: () => new Map(),
}));

vi.mock("../../../contexts/PathServiceContext", () => ({
  usePathService: () => ({
    task: ({ taskId }: { taskId: string }) => `/tasks/${taskId}`,
    feature: ({ featureId }: { featureId: string }) => `/features/${featureId}`,
    designDoc: ({ designDocId }: { designDocId: string }) =>
      `/design-docs/${designDocId}`,
  }),
}));

vi.mock("../../Entity", () => ({
  EntityLinkWithPreview: ({
    label,
    href,
    sx,
  }: {
    label: string;
    href?: string;
    sx?: EntityLinkMockSx;
  }) => (
    <a href={href} data-color={resolveEntityLinkMockColor(sx)}>
      {label}
    </a>
  ),
}));

vi.mock("../../ProposalDispatchers", () => ({
  getProposalDisplayTitle: (value: ProposalResponseDto) => value.title,
  CreateProposal: ({ renderMode }: DispatcherProps) => (
    <div data-testid="create-member-content" data-render-mode={renderMode} />
  ),
  UpdateProposal: ({ renderMode }: DispatcherProps) => (
    <div data-testid="update-member-content" data-render-mode={renderMode} />
  ),
  DeleteProposal: ({ renderMode }: DispatcherProps) => (
    <div data-testid="delete-member-content" data-render-mode={renderMode} />
  ),
}));

afterEach(cleanup);

describe("ProposalGroupReview", () => {
  beforeEach(() => {
    renderedGroup = group;
    approveAllResult = null;
    decisionProposals = new Map();
    workItemTypeMetadataAvailable = true;
    workItemRegistryError = null;
    vi.clearAllMocks();
  });

  it("preserves API member order and renders mixed action content", () => {
    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    expect(
      screen
        .getAllByTestId("shared-title-boundary")
        .map((title) => title.dataset.title),
    ).toEqual(["Update second", "Create first", "Delete third"]);
    const reviews = screen.getAllByTestId("proposal-group-member-review");
    expect(reviews.map((review) => review.dataset.memberOrder)).toEqual([
      "1",
      "0",
      "2",
    ]);
    expect(screen.getByTestId("create-member-content")).toBeInTheDocument();
    expect(screen.getByTestId("update-member-content")).toBeInTheDocument();
    expect(screen.getByTestId("delete-member-content")).toBeInTheDocument();
  });

  it("renders the frozen three-member Diagram as one disconnected graph", () => {
    const rootMember = member(
      "diagram-root-member",
      0,
      proposal(
        "diagram-root-proposal",
        "Disposable Two-Element Test Diagram",
        ProposalAction.Create,
      ),
    );
    rootMember.reservedEntityId = "diagram-id";
    rootMember.proposal.updates = {
      name: "Disposable Two-Element Test Diagram",
      type: "DIAGRAM",
    };
    const firstElement = member(
      "diagram-element-a-member",
      1,
      proposal(
        "diagram-element-a-proposal",
        "Test Element A",
        ProposalAction.Create,
      ),
    );
    firstElement.reservedEntityId = "element-a-id";
    firstElement.proposal.updates = {
      name: "Test Element A",
      type: "DIAGRAM_ELEMENT",
      parentTaskId: "diagram-id",
    };
    const secondElement = member(
      "diagram-element-b-member",
      2,
      proposal(
        "diagram-element-b-proposal",
        "Test Element B",
        ProposalAction.Create,
      ),
    );
    secondElement.reservedEntityId = "element-b-id";
    secondElement.proposal.updates = {
      name: "Test Element B",
      type: "DIAGRAM_ELEMENT",
      parentTaskId: "diagram-id",
    };
    renderedGroup = {
      ...group,
      members: [rootMember, firstElement, secondElement],
      dependencies: [
        {
          dependentMemberId: firstElement.memberId,
          prerequisiteMemberId: rootMember.memberId,
        },
        {
          dependentMemberId: secondElement.memberId,
          prerequisiteMemberId: rootMember.memberId,
        },
      ],
    };

    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    const graphPreview = screen.getByTestId("proposal-group-graph-preview");
    expect(graphPreview).toBeInTheDocument();
    expect(
      within(graphPreview).getByText("Test Element A"),
    ).toBeInTheDocument();
    expect(
      within(graphPreview).getByText("Test Element B"),
    ).toBeInTheDocument();
    expect(
      within(graphPreview).getByTestId("shared-work-item-graph"),
    ).toHaveAttribute("data-edge-count", "0");
    expect(
      within(graphPreview).getByTestId("shared-work-item-graph"),
    ).toHaveAttribute("data-presentation-state", "authored");
  });

  it("renders the explicit unavailable state when graph registry authority fails", () => {
    const rootMember = member(
      "diagram-root-member",
      0,
      proposal(
        "diagram-root-proposal",
        "Disposable Diagram",
        ProposalAction.Create,
      ),
    );
    rootMember.reservedEntityId = "diagram-id";
    rootMember.proposal.updates = {
      name: "Disposable Diagram",
      type: "DIAGRAM",
    };
    const childMember = member(
      "diagram-child-member",
      1,
      proposal("diagram-child-proposal", "Child", ProposalAction.Create),
    );
    childMember.reservedEntityId = "child-id";
    childMember.proposal.updates = {
      name: "Child",
      type: "DIAGRAM_ELEMENT",
      parentTaskId: "diagram-id",
    };
    renderedGroup = {
      ...group,
      members: [rootMember, childMember],
      dependencies: [
        {
          dependentMemberId: childMember.memberId,
          prerequisiteMemberId: rootMember.memberId,
        },
      ],
    };
    workItemRegistryError = new Error("registry failed");

    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    expect(
      screen.getByTestId("proposal-group-graph-unavailable"),
    ).toHaveTextContent("The work-item type registry is unavailable.");
    expect(
      screen.queryByTestId("shared-work-item-graph"),
    ).not.toBeInTheDocument();
  });

  it("explains the fixed review snapshot without exposing its revision", () => {
    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    expect(screen.getByTestId("proposal-group-lifecycle")).toHaveTextContent(
      "Ready for review",
    );
    expect(
      screen.getByTestId("proposal-group-review-snapshot"),
    ).toHaveTextContent("Review uses a fixed snapshot");
    expect(screen.queryByText(/Frozen revision/i)).not.toBeInTheDocument();
  });

  it("embeds each member renderer beneath the member-owned review shell", () => {
    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    expect(
      screen
        .getAllByTestId("create-member-content")
        .map((content) => content.dataset.renderMode),
    ).toEqual(["group-member"]);
    expect(
      screen
        .getAllByTestId("update-member-content")
        .map((content) => content.dataset.renderMode),
    ).toEqual(["group-member"]);
    expect(
      screen
        .getAllByTestId("delete-member-content")
        .map((content) => content.dataset.renderMode),
    ).toEqual(["group-member"]);
    expect(screen.getAllByTestId("proposal-group-member-review")).toHaveLength(
      3,
    );
    expect(screen.getAllByTestId("proposal-group-approve-all")).toHaveLength(1);
  });

  it("links an existing UPDATE target and uses registry-backed type metadata", () => {
    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    expect(screen.getByRole("link", { name: "Update second" })).toHaveAttribute(
      "href",
      "/tasks/target-proposal-update",
    );
    expect(screen.getByRole("link", { name: "Update second" })).toHaveAttribute(
      "data-color",
      "primary.main",
    );
    const updateMember = screen
      .getByRole("link", { name: "Update second" })
      .closest('[data-testid="proposal-group-member-review"]');
    expect(updateMember).not.toBeNull();
    expect(
      within(updateMember!).getByTestId("proposal-group-member-type"),
    ).toHaveTextContent("Task");
    expect(within(updateMember!).queryByText("TASK")).not.toBeInTheDocument();
  });

  it("uses the proposed work-item type and links an applied CREATE target", () => {
    const createMember = {
      ...group.members[1],
      proposal: {
        ...group.members[1].proposal,
        status: ProposalStatus.Approved,
        title: "Task Monitor judgment response boundary",
        updates: {
          name: "Task Monitor judgment response boundary",
          type: "CONTRACT",
        },
      },
      executionState: ProposalGroupMemberExecutionState.Applied,
    };
    renderedGroup = { ...group, members: [createMember] };

    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    expect(
      screen.getByRole("link", {
        name: "Task Monitor judgment response boundary",
      }),
    ).toHaveAttribute("href", "/tasks/target-proposal-create");
    expect(screen.getByTestId("proposal-group-member-type")).toHaveTextContent(
      "Contract",
    );
    expect(screen.queryByText("TASK")).not.toBeInTheDocument();
  });

  it("colors a grouped Work Item Type header from its proposed key", () => {
    renderedGroup = {
      ...group,
      members: [
        {
          ...group.members[1],
          proposal: {
            ...group.members[1].proposal,
            targetEntityType: TargetEntityType.WorkItemType,
            updates: { key: "BUG" },
          },
        },
      ],
    };

    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    expect(screen.getByTestId("proposal-group-member-type")).toHaveClass(
      "MuiChip-filled",
    );
  });

  it("never substitutes the TASK storage family for a known CREATE subtype", () => {
    workItemTypeMetadataAvailable = false;
    renderedGroup = {
      ...group,
      members: [
        {
          ...group.members[1],
          proposal: {
            ...group.members[1].proposal,
            updates: {
              name: "Task Monitor judgment response boundary",
              type: "CONTRACT",
            },
          },
        },
      ],
    };

    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    expect(screen.getByTestId("proposal-group-member-type")).toHaveTextContent(
      "Contract",
    );
    expect(screen.queryByText("Task")).not.toBeInTheDocument();
  });

  it("falls back to the known entity type when subtype metadata is missing", () => {
    workItemTypeMetadataAvailable = false;
    renderedGroup = { ...group, members: [group.members[0]] };

    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    expect(screen.getByTestId("proposal-group-member-type")).toHaveTextContent(
      "Task",
    );
    expect(screen.queryByText("Type unavailable")).not.toBeInTheDocument();
  });

  it("renders member decision controls after proposal content", () => {
    renderedGroup = { ...group, members: [group.members[0]] };
    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    const content = screen.getByTestId("update-member-content");
    const actions = screen.getByTestId("proposal-group-member-actions");
    expect(
      content.compareDocumentPosition(actions) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("keeps lifecycle detail in a tooltip and surfaces execution errors", async () => {
    const user = userEvent.setup();
    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    const updateMember = screen
      .getByText("Update second")
      .closest('[data-testid="proposal-group-member-review"]');
    expect(updateMember).not.toBeNull();
    expect(
      within(updateMember!).getByTestId("proposal-group-member-status"),
    ).toHaveTextContent("Waiting for prerequisites");
    expect(
      within(updateMember!).queryByText(/WAITING_ON_DEPENDENCIES/),
    ).not.toBeInTheDocument();
    expect(
      within(updateMember!).queryByText(/DEPENDENCIES_PENDING/),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Attempts: 2")).not.toBeInTheDocument();
    expect(screen.getByText("Write failed")).toBeInTheDocument();
    expect(
      screen.getByText("Correlation: member-correlation-1"),
    ).toBeInTheDocument();

    const appliedMember = screen
      .getByText("Delete third")
      .closest('[data-testid="proposal-group-member-review"]');
    expect(appliedMember).not.toBeNull();
    await user.hover(
      within(appliedMember!).getByTestId("proposal-group-member-status"),
    );
    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Attempts: 2");
    expect(tooltip).toHaveTextContent("Applied");
  });

  it("renders a compact awaiting-approval state", () => {
    renderedGroup = {
      ...group,
      members: [
        {
          ...group.members[0],
          approvalProgress: {
            receivedApprovals: 0,
            requiredApprovals: 2,
            approvalSatisfied: false,
          },
          executionState: ProposalGroupMemberExecutionState.PendingApproval,
          blockedReason: ProposalGroupBlockedReason.ApprovalsPending,
        },
      ],
    };

    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    const state = screen.getByTestId("proposal-group-member-state");
    expect(
      within(state).getByTestId("proposal-group-member-status"),
    ).toHaveTextContent("Awaiting approval");
    expect(
      within(state).queryByText(/required approvals received/),
    ).not.toBeInTheDocument();
  });

  it("shows approve-all progress and keeps member failures visible", () => {
    approveAllResult = {
      groupId: "group-1",
      revision: 4,
      results: [
        {
          memberId: "member-update",
          proposalId: "proposal-update",
          outcome: ProposalGroupDecisionOutcome.ApprovalRecorded,
          receivedApprovals: 2,
          requiredApprovals: 2,
          approvalSatisfied: true,
          dependencyReady: false,
          executionState:
            ProposalGroupMemberExecutionState.WaitingOnDependencies,
          blockedReason: ProposalGroupBlockedReason.DependenciesPending,
          diagnostic: {
            issues: [
              {
                field: "operations[1].target",
                code: "missing_reference",
                reason: "Target does not exist",
                layer: "referential",
              },
            ],
            issueCount: 1,
            truncated: false,
            correlationId: "approve-all-correlation-1",
          },
        },
        {
          memberId: "member-create",
          proposalId: "proposal-create",
          outcome: ProposalGroupDecisionOutcome.NotEligible,
          receivedApprovals: 0,
          requiredApprovals: 1,
          approvalSatisfied: false,
          dependencyReady: true,
          executionState: ProposalGroupMemberExecutionState.PendingApproval,
          message: "Requestor cannot self-approve",
        },
      ],
    };

    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    const progress = screen.getByTestId("proposal-group-approve-all-progress");
    expect(progress).toHaveAttribute("aria-valuenow", "33");
    expect(progress).toHaveAttribute("aria-label", "1 of 3 members approved");
    const summary = screen.getByTestId("proposal-group-approve-all-summary");
    expect(within(summary).queryByText(/Outcome:/)).not.toBeInTheDocument();
    expect(
      within(summary).queryByText(/Prerequisites:/),
    ).not.toBeInTheDocument();
    expect(
      screen.getAllByTestId("proposal-group-approve-all-member-result"),
    ).toHaveLength(2);
    expect(
      screen.getByText("Requestor cannot self-approve"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Correlation: approve-all-correlation-1"),
    ).toBeInTheDocument();
  });

  it("shows no approve-all summary when the group has no members", () => {
    renderedGroup = { ...group, members: [] };
    approveAllResult = { groupId: "group-1", revision: 4, results: [] };

    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    expect(
      screen.queryByTestId("proposal-group-approve-all-summary"),
    ).not.toBeInTheDocument();
  });

  it("fails every member closed from a successful approve-all result", async () => {
    approveAllResult = {
      groupId: "group-1",
      revision: 4,
      results: group.members.map((candidate) => ({
        memberId: candidate.memberId,
        proposalId: candidate.proposal.id,
        outcome: ProposalGroupDecisionOutcome.ApprovalRecorded,
        receivedApprovals: 2,
        requiredApprovals: 2,
        approvalSatisfied: true,
        dependencyReady: true,
        executionState: ProposalGroupMemberExecutionState.Ready,
      })),
    };

    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    expect(screen.getByTestId("proposal-group-approve-all")).toBeDisabled();
    expect(screen.getByTestId("proposal-group-approve-all")).toHaveTextContent(
      "All approved",
    );
    for (const button of screen.getAllByTestId(
      "proposal-group-member-approve",
    )) {
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute("data-selected", "true");
    }
    for (const button of screen.getAllByTestId(
      "proposal-group-member-reject",
    )) {
      expect(button).toBeDisabled();
    }
    await waitFor(() => {
      expect(
        screen.queryByTestId("update-member-content"),
      ).not.toBeInTheDocument();
    });
  });

  it("offers individual approval only for API pending-approval members", async () => {
    const pendingMember = {
      ...group.members[0],
      approvalProgress: {
        receivedApprovals: 0,
        requiredApprovals: 2,
        approvalSatisfied: false,
      },
      executionState: ProposalGroupMemberExecutionState.PendingApproval,
      blockedReason: ProposalGroupBlockedReason.ApprovalsPending,
    };
    renderedGroup = { ...group, members: [pendingMember] };
    const user = userEvent.setup();

    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );
    await user.click(screen.getByTestId("proposal-group-member-approve"));

    expect(approveMember).toHaveBeenCalledWith(pendingMember.proposal.id);
  });

  it("highlights the current user's approval and collapses the UPDATE content", async () => {
    const pendingMember = {
      ...group.members[0],
      approvalProgress: {
        receivedApprovals: 0,
        requiredApprovals: 2,
        approvalSatisfied: false,
      },
      executionState: ProposalGroupMemberExecutionState.PendingApproval,
      blockedReason: ProposalGroupBlockedReason.ApprovalsPending,
    };
    renderedGroup = { ...group, members: [pendingMember] };
    const user = userEvent.setup();
    const view = render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    expect(screen.getByTestId("update-member-content")).toBeInTheDocument();
    await user.click(screen.getByTestId("proposal-group-member-approve"));

    decisionProposals = new Map([
      [
        pendingMember.proposal.id,
        {
          ...pendingMember.proposal,
          status: ProposalStatus.Draft,
          approvals: [
            {
              userId: "user-1",
              type: ProposalApprovalType.Approval,
              createdAt: "2026-07-27T00:30:00Z",
            },
          ],
          updatedAt: "2026-07-27T00:30:00Z",
        },
      ],
    ]);
    view.rerender(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    const approve = screen.getByTestId("proposal-group-member-approve");
    expect(approve).toBeDisabled();
    expect(approve).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId("proposal-group-member-reject")).toBeDisabled();
    await waitFor(() => {
      expect(
        screen.queryByTestId("update-member-content"),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByTestId("proposal-group-member-content-toggle"),
    ).toBeInTheDocument();
  });

  it("keeps terminal members readable without decision controls", () => {
    renderedGroup = {
      ...group,
      lifecycle: ProposalGroupLifecycle.Settled,
      members: [
        {
          ...group.members[0],
          executionState: ProposalGroupMemberExecutionState.Invalidated,
          terminalTimestamps: {
            appliedAt: null,
            rejectedAt: null,
            invalidatedAt: "2026-07-27T03:00:00Z",
            failedAt: null,
          },
        },
      ],
    };

    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    expect(screen.getByText("Cannot apply")).toBeInTheDocument();
    expect(
      screen.queryByTestId("proposal-group-member-actions"),
    ).not.toBeInTheDocument();
  });

  it("keeps both controls disabled and highlights an accepted UPDATE", async () => {
    renderedGroup = {
      ...group,
      members: [
        {
          ...group.members[0],
          proposal: {
            ...group.members[0].proposal,
            status: ProposalStatus.Approved,
            approvals: [
              {
                userId: "user-1",
                type: ProposalApprovalType.Approval,
                createdAt: "2026-07-27T00:30:00Z",
              },
            ],
          },
          executionState: ProposalGroupMemberExecutionState.Applied,
        },
      ],
    };
    const user = userEvent.setup();

    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    const approve = screen.getByTestId("proposal-group-member-approve");
    const reject = screen.getByTestId("proposal-group-member-reject");
    expect(approve).toBeDisabled();
    expect(reject).toBeDisabled();
    expect(approve).toHaveAttribute("data-selected", "true");
    expect(reject).toHaveAttribute("data-selected", "false");
    expect(
      screen.queryByTestId("update-member-content"),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByTestId("proposal-group-member-content-toggle"),
    );
    expect(screen.getByTestId("update-member-content")).toBeInTheDocument();
  });

  it("keeps both controls disabled and highlights a rejected member", () => {
    renderedGroup = {
      ...group,
      members: [
        {
          ...group.members[0],
          proposal: {
            ...group.members[0].proposal,
            status: ProposalStatus.Rejected,
            approvals: [
              {
                userId: "user-1",
                type: ProposalApprovalType.Rejection,
                createdAt: "2026-07-27T00:30:00Z",
              },
            ],
          },
          executionState: ProposalGroupMemberExecutionState.Rejected,
        },
      ],
    };

    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );

    const approve = screen.getByTestId("proposal-group-member-approve");
    const reject = screen.getByTestId("proposal-group-member-reject");
    expect(approve).toBeDisabled();
    expect(reject).toBeDisabled();
    expect(approve).toHaveAttribute("data-selected", "false");
    expect(reject).toHaveAttribute("data-selected", "true");
  });
});

beforeEach(() => {
  vi.mocked(proposalsClient.getProposalReconciliation).mockResolvedValue({
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
  } as never);
});

vi.mock("../../../clients/serviceClients", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../clients/serviceClients")>()),
  proposalsClient: {
    getProposalReconciliation: vi.fn(),
    createProposalReconciliationCandidate: vi.fn(),
  },
}));
