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
import { RunBrowserProvider } from "../../AgentSession/runtime/RunBrowserContext";
import { ProposalGroupReview } from "../ProposalGroupReview";
import type { WorkflowGraphPresentationState } from "../../shared/WorkflowMentionInlineRenderer";

const openRunBrowserTab = vi.fn().mockResolvedValue(undefined);
vi.mock(
  "../../AgentSession/runtime/directoryBindingApi",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../AgentSession/runtime/directoryBindingApi")
      >();
    return {
      ...actual,
      resolveLocalDirectoryRuntimeBaseUrl: () => "http://localhost:3847",
      createDirectoryBindingApi: () => ({
        listRepos: () =>
          Promise.resolve({ machineId: "machine-1", bindings: [] }),
        openRunBrowserTab,
      }),
    };
  },
);

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
    workItem:
      workItemId === "saved-screen"
        ? {
            id: workItemId,
            name: "Saved cart",
            type: "mockup",
            status: "BACKLOG",
            sections: [
              {
                key: "mockup",
                materializedMarkdown: JSON.stringify({
                  schemaVersion: "work-item-structured-mockup.v1",
                  content: [],
                }),
              },
            ],
          }
        : workItemId === "archived-screen"
          ? {
              id: workItemId,
              name: "Archived screen",
              type: "mockup",
              status: "ARCHIVED",
              sections: [],
            }
          : workItemId === "other-task"
            ? {
                id: workItemId,
                name: "Ship order",
                type: "STANDARD",
                status: "BACKLOG",
                sections: [],
              }
            : options.enabled
              ? {
                  id: workItemId,
                  name: `Target ${workItemId}`,
                  type: "STANDARD",
                }
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
          {
            key: "mockup",
            name: "Mockup",
            sections: [
              {
                key: "mockup",
                label: "Mockup",
                kind: "structured-mockup",
                defaultSizeKey: "panel",
                sizeProfiles: [
                  {
                    key: "panel",
                    label: "Panel",
                    breakpoints: [
                      {
                        minContainerWidth: 0,
                        inline: { width: 400, height: 260 },
                        page: { width: 800, height: 600 },
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ].find((definition) => definition.key === typeKey)
      : undefined,
    isLoading: false,
    error: null,
  }),
}));

vi.mock(
  "../../shared/WorkflowMentionInlineRenderer",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../shared/WorkflowMentionInlineRenderer")
      >();
    return {
      ...actual,
      WorkflowGraphSurface: ({
        projection,
        presentationState,
      }: {
        projection: {
          children: Array<{ name: string }>;
          incidentRelationships: unknown[];
          referenceReviewControls?: Readonly<Record<string, React.ReactNode>>;
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
          {Object.entries(projection.referenceReviewControls ?? {}).map(
            ([key, content]) => (
              <div key={key}>{content}</div>
            ),
          )}
        </div>
      ),
      buildCanonicalProjectedGraphPositions: () => new Map(),
    };
  },
);

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

  it("reviews a branching UX journey with new screens and an accepted live screen", async () => {
    const journey = member("journey-member", 0, {
      ...proposal(
        "journey-proposal",
        "Checkout journey",
        ProposalAction.Create,
      ),
      updates: {
        root: { refType: "temporary", tempId: "journey" },
        operations: [
          {
            op: "workItem.create",
            ref: { refType: "temporary", tempId: "journey" },
            type: "DIAGRAM",
            name: "Checkout journey",
          },
          {
            op: "section.replace",
            ref: { refType: "temporary", tempId: "journey" },
            key: "diagramMetadata",
            content: { kind: "UX_FLOW", level: "OVERVIEW" },
          },
          ...["saved-screen", "new-screen", "alternate-screen"].flatMap(
            (entityId) => [
              {
                op: "workItem.create",
                ref: { refType: "temporary", tempId: entityId },
                parent: { refType: "temporary", tempId: "journey" },
                type: "DIAGRAM_ELEMENT",
                name:
                  entityId === "saved-screen"
                    ? "Cart"
                    : entityId === "new-screen"
                      ? "Payment"
                      : "Payment declined",
              },
              {
                op: "section.replace",
                ref: { refType: "temporary", tempId: entityId },
                key: "diagramElementMetadata",
                content: {
                  role: "GENERIC",
                  canonicalReference: { entityType: "TASK", entityId },
                },
              },
            ],
          ),
          {
            op: "relationship.create",
            ref: { refType: "temporary", tempId: "checkout" },
            source: { refType: "temporary", tempId: "saved-screen" },
            target: { refType: "temporary", tempId: "new-screen" },
            category: "flow",
            edgeType: "STANDARD",
            direction: "forward",
            actionLabel: "Checkout",
          },
          {
            op: "relationship.create",
            ref: { refType: "temporary", tempId: "declined" },
            source: { refType: "temporary", tempId: "saved-screen" },
            target: { refType: "temporary", tempId: "alternate-screen" },
            category: "flow",
            edgeType: "CONDITIONAL",
            direction: "forward",
            predicate: "Payment declined",
            actionLabel: "Pay",
          },
        ],
      },
    });
    const payment = {
      ...member("payment-member", 1, {
        ...proposal("payment-proposal", "Payment", ProposalAction.Create),
        updates: {
          name: "Payment",
          type: "mockup",
          sections: [
            { key: "purpose", content: "Choose how to pay" },
            {
              key: "mockup",
              content: {
                schemaVersion: "work-item-structured-mockup.v1",
                content: [],
              },
            },
          ],
        },
      }),
      reservedEntityId: "new-screen",
      executionState: ProposalGroupMemberExecutionState.PendingApproval,
      approvalProgress: {
        receivedApprovals: 0,
        requiredApprovals: 2,
        approvalSatisfied: false,
      },
      dependencies: [],
    };
    const declined = {
      ...member("declined-member", 2, {
        ...proposal(
          "declined-proposal",
          "Payment declined",
          ProposalAction.Create,
        ),
        updates: { name: "Payment declined", type: "mockup", sections: [] },
      }),
      reservedEntityId: "alternate-screen",
      executionState: ProposalGroupMemberExecutionState.PendingApproval,
      approvalProgress: {
        receivedApprovals: 0,
        requiredApprovals: 2,
        approvalSatisfied: false,
      },
      dependencies: [],
    };
    renderedGroup = {
      ...group,
      members: [
        { ...journey, reservedEntityId: "journey-id" },
        payment,
        declined,
      ],
      dependencies: [],
    };
    render(
      <RunBrowserProvider
        value={{ runId: "run-1", sessionMachineId: "machine-1" }}
      >
        <ProposalGroupReview
          organizationId="org-1"
          projectId="project-1"
          groupId="group-1"
        />
      </RunBrowserProvider>,
    );
    const review = screen.getByTestId("proposal-group-journey-review");
    expect(within(review).getAllByTestId("journey-screen")).toHaveLength(3);
    expect(within(review).getAllByTestId("journey-transition")).toHaveLength(2);
    expect(within(review).getByText("Checkout")).toBeInTheDocument();
    expect(within(review).getByText("Pay")).toBeInTheDocument();
    expect(within(review).getByText("Choose how to pay")).toBeInTheDocument();
    expect(
      within(review).getAllByTestId("structured-mockup-static-preview"),
    ).toHaveLength(2);
    expect(
      within(review).queryByTestId("shared-work-item-graph"),
    ).not.toBeInTheDocument();
    expect(
      within(review).queryByRole("button", { name: /layout|fullscreen|zoom/i }),
    ).not.toBeInTheDocument();
    const saved = within(review).getByTestId("journey-saved-screen-review");
    expect(
      within(saved).queryByTestId("proposal-group-member-approve"),
    ).not.toBeInTheDocument();
    expect(
      within(saved).getByRole("link", { name: "Open saved screen Saved cart" }),
    ).toHaveAttribute("href", "/tasks/saved-screen");
    const proposed = within(review).getAllByTestId(
      "journey-proposed-screen-review",
    );
    expect(proposed).toHaveLength(2);
    const user = userEvent.setup();
    const paymentControls = proposed.find(
      (element) => element.dataset.proposalId === "payment-proposal",
    )!;
    const declinedControls = proposed.find(
      (element) => element.dataset.proposalId === "declined-proposal",
    )!;
    expect(
      within(review).queryByText("Inspect and annotate"),
    ).not.toBeInTheDocument();
    const paymentScreen = within(review).getByRole("button", {
      name: "View Payment full size",
    });
    const annotate = within(paymentScreen.parentElement!).getByRole("button", {
      name: "Open mockup in Run browser",
    });
    expect(annotate).toHaveTextContent("Annotate");
    await waitFor(() => expect(annotate).toBeEnabled());
    await user.click(annotate);
    expect(openRunBrowserTab).toHaveBeenCalledWith("run-1", {
      machineId: "machine-1",
      url: "http://localhost:3847/mockups/proposals/payment-proposal?organizationId=org-1&projectId=project-1&section=mockup&size=panel",
    });
    expect(
      screen.queryByTestId("journey-screen-full-size"),
    ).not.toBeInTheDocument();
    await user.click(paymentScreen);
    expect(
      within(screen.getByTestId("journey-screen-full-size")).getByTestId(
        "structured-mockup-section-renderer",
      ),
    ).toHaveAttribute("data-rendering-context", "page");
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(
      within(review).getByRole("button", { name: "View Saved cart full size" }),
    );
    expect(
      within(screen.getByTestId("journey-screen-full-size")).getByTestId(
        "structured-mockup-section-renderer",
      ),
    ).toHaveAttribute("data-rendering-context", "page");
    await user.click(screen.getByRole("button", { name: "Close" }));
    paymentScreen.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByTestId("journey-screen-full-size")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await user.click(
      within(paymentControls).getByTestId("proposal-group-member-approve"),
    );
    expect(approveMember).toHaveBeenCalledWith("payment-proposal");
    await user.click(
      within(declinedControls).getByTestId("proposal-group-member-reject"),
    );
    await user.type(
      screen.getByTestId("proposal-group-member-reject-reason"),
      "Explain how to retry payment",
    );
    await user.click(screen.getByTestId("proposal-group-member-reject-submit"));
    expect(rejectMember).toHaveBeenCalledWith(
      "declined-proposal",
      "Explain how to retry payment",
    );
    expect(
      screen.queryByTestId("journey-review-send-feedback"),
    ).not.toBeInTheDocument();
    expect(
      within(review).getByTestId("journey-saved-screen-review"),
    ).toBeInTheDocument();
    expect(within(review).getByText("Payment declined")).toBeInTheDocument();
    const flatCards = screen.getAllByTestId("proposal-group-member-review");
    expect(flatCards.map((card) => card.dataset.memberId)).toEqual([
      "journey-member",
    ]);
    cleanup();
    renderedGroup = {
      ...renderedGroup,
      members: renderedGroup.members.map((entry) =>
        entry.memberId === payment.memberId
          ? {
              ...entry,
              proposal: { ...entry.proposal, status: ProposalStatus.Rejected },
              executionState: ProposalGroupMemberExecutionState.Rejected,
            }
          : entry,
      ),
    };
    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );
    const rejectedScreen = screen
      .getAllByTestId("journey-screen")
      .find((element) => within(element).queryByText("Choose how to pay"))!;
    expect(within(rejectedScreen).getByText("Rejected")).toBeInTheDocument();
    expect(
      within(rejectedScreen).getByTestId("structured-mockup-static-preview"),
    ).toBeInTheDocument();
  });

  it("renders a non-UX_FLOW Diagram's sibling Mockup references as cohesive nodes", () => {
    const journey = member("journey-member", 0, {
      ...proposal("journey-proposal", "System diagram", ProposalAction.Create),
      updates: {
        root: { refType: "temporary", tempId: "journey" },
        operations: [
          {
            op: "workItem.create",
            ref: { refType: "temporary", tempId: "journey" },
            type: "DIAGRAM",
            name: "System diagram",
          },
          {
            op: "section.replace",
            ref: { refType: "temporary", tempId: "journey" },
            key: "diagramMetadata",
            content: { kind: "GENERAL", level: "OVERVIEW" },
          },
          ...["new-screen"].flatMap((entityId) => [
            {
              op: "workItem.create",
              ref: { refType: "temporary", tempId: entityId },
              parent: { refType: "temporary", tempId: "journey" },
              type: "DIAGRAM_ELEMENT",
              name: "Payment",
            },
            {
              op: "section.replace",
              ref: { refType: "temporary", tempId: entityId },
              key: "diagramElementMetadata",
              content: {
                role: "GENERIC",
                canonicalReference: { entityType: "TASK", entityId },
              },
            },
          ]),
        ],
      },
    });
    const payment = {
      ...member("payment-member", 1, {
        ...proposal("payment-proposal", "Payment", ProposalAction.Create),
        updates: { name: "Payment", type: "mockup", sections: [] },
      }),
      reservedEntityId: "new-screen",
      dependencies: [],
    };
    renderedGroup = {
      ...group,
      members: [{ ...journey, reservedEntityId: "journey-id" }, payment],
      dependencies: [],
    };
    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );
    expect(
      screen.getByTestId("proposal-group-journey-review"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("proposal-group-graph-preview"),
    ).not.toBeInTheDocument();
    const flatCards = screen.getAllByTestId("proposal-group-member-review");
    expect(flatCards.map((card) => card.dataset.memberId)).toEqual([
      "journey-member",
    ]);
  });

  it("does not flag a non-Mockup sibling reference as an unavailable screen", () => {
    const journey = member("journey-member", 0, {
      ...proposal("journey-proposal", "System diagram", ProposalAction.Create),
      updates: {
        root: { refType: "temporary", tempId: "journey" },
        operations: [
          {
            op: "workItem.create",
            ref: { refType: "temporary", tempId: "journey" },
            type: "DIAGRAM",
            name: "System diagram",
          },
          {
            op: "section.replace",
            ref: { refType: "temporary", tempId: "journey" },
            key: "diagramMetadata",
            content: { kind: "GENERAL", level: "OVERVIEW" },
          },
          {
            op: "workItem.create",
            ref: { refType: "temporary", tempId: "new-screen" },
            parent: { refType: "temporary", tempId: "journey" },
            type: "DIAGRAM_ELEMENT",
            name: "Payment",
          },
          {
            op: "section.replace",
            ref: { refType: "temporary", tempId: "new-screen" },
            key: "diagramElementMetadata",
            content: {
              role: "GENERIC",
              canonicalReference: {
                entityType: "TASK",
                entityId: "new-screen",
              },
            },
          },
          {
            op: "workItem.create",
            ref: { refType: "temporary", tempId: "other-task" },
            parent: { refType: "temporary", tempId: "journey" },
            type: "DIAGRAM_ELEMENT",
            name: "Ship order",
          },
          {
            op: "section.replace",
            ref: { refType: "temporary", tempId: "other-task" },
            key: "diagramElementMetadata",
            content: {
              role: "GENERIC",
              canonicalReference: {
                entityType: "TASK",
                entityId: "other-task",
              },
            },
          },
        ],
      },
    });
    const payment = {
      ...member("payment-member", 1, {
        ...proposal("payment-proposal", "Payment", ProposalAction.Create),
        updates: { name: "Payment", type: "mockup", sections: [] },
      }),
      reservedEntityId: "new-screen",
      dependencies: [],
    };
    renderedGroup = {
      ...group,
      members: [{ ...journey, reservedEntityId: "journey-id" }, payment],
      dependencies: [],
    };
    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );
    const review = screen.getByTestId("proposal-group-journey-review");
    expect(
      within(review).queryByText("Screen unavailable"),
    ).not.toBeInTheDocument();
  });

  it.each(["missing-screen", "archived-screen"])(
    "keeps an unavailable slot and connector for %s",
    (unavailableId) => {
      renderedGroup = {
        ...group,
        members: [
          {
            ...member("journey-member", 0, {
              ...proposal(
                "journey-proposal",
                "Sign-in journey",
                ProposalAction.Create,
              ),
              updates: {
                root: { refType: "temporary", tempId: "journey" },
                operations: [
                  {
                    op: "workItem.create",
                    ref: { refType: "temporary", tempId: "journey" },
                    type: "DIAGRAM",
                    name: "Sign-in journey",
                  },
                  {
                    op: "section.replace",
                    ref: { refType: "temporary", tempId: "journey" },
                    key: "diagramMetadata",
                    content: { kind: "UX_FLOW", level: "OVERVIEW" },
                  },
                  ...["saved-screen", unavailableId].flatMap((entityId) => [
                    {
                      op: "workItem.create",
                      ref: { refType: "temporary", tempId: entityId },
                      parent: { refType: "temporary", tempId: "journey" },
                      type: "DIAGRAM_ELEMENT",
                      name:
                        entityId === "saved-screen" ? "Cart" : "Next screen",
                    },
                    {
                      op: "section.replace",
                      ref: { refType: "temporary", tempId: entityId },
                      key: "diagramElementMetadata",
                      content: {
                        role: "GENERIC",
                        canonicalReference: { entityType: "TASK", entityId },
                      },
                    },
                  ]),
                  {
                    op: "relationship.create",
                    ref: { refType: "temporary", tempId: "continue" },
                    source: { refType: "temporary", tempId: "saved-screen" },
                    target: { refType: "temporary", tempId: unavailableId },
                    category: "flow",
                    edgeType: "STANDARD",
                    direction: "forward",
                    actionLabel: "Continue",
                  },
                ],
              },
            }),
            reservedEntityId: "journey-id",
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
      const review = screen.getByTestId("proposal-group-journey-review");
      expect(
        within(review).getByText("Screen unavailable"),
      ).toBeInTheDocument();
      expect(within(review).getAllByTestId("journey-screen")).toHaveLength(2);
      expect(
        within(review).getByTestId("journey-transition"),
      ).toHaveTextContent("Continue");
    },
  );

  it("keeps the journey view for a UX_FLOW revision whose screens are already accepted", () => {
    const journey = member("journey-member", 0, {
      ...proposal(
        "journey-proposal",
        "Checkout journey",
        ProposalAction.Create,
      ),
      updates: {
        root: { refType: "temporary", tempId: "journey" },
        operations: [
          {
            op: "workItem.create",
            ref: { refType: "temporary", tempId: "journey" },
            type: "DIAGRAM",
            name: "Checkout journey",
          },
          {
            op: "section.replace",
            ref: { refType: "temporary", tempId: "journey" },
            key: "diagramMetadata",
            content: { kind: "UX_FLOW", level: "OVERVIEW" },
          },
          {
            op: "workItem.create",
            ref: { refType: "temporary", tempId: "saved-screen" },
            parent: { refType: "temporary", tempId: "journey" },
            type: "DIAGRAM_ELEMENT",
            name: "Cart",
          },
          {
            op: "section.replace",
            ref: { refType: "temporary", tempId: "saved-screen" },
            key: "diagramElementMetadata",
            content: {
              role: "GENERIC",
              canonicalReference: {
                entityType: "TASK",
                entityId: "saved-screen",
              },
            },
          },
        ],
      },
    });
    renderedGroup = {
      ...group,
      members: [{ ...journey, reservedEntityId: "journey-id" }],
      dependencies: [],
    };
    render(
      <ProposalGroupReview
        organizationId="org-1"
        projectId="project-1"
        groupId="group-1"
      />,
    );
    const review = screen.getByTestId("proposal-group-journey-review");
    expect(
      screen.queryByTestId("proposal-group-graph-preview"),
    ).not.toBeInTheDocument();
    expect(
      within(review).getByTestId("journey-saved-screen-review"),
    ).toBeInTheDocument();
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
