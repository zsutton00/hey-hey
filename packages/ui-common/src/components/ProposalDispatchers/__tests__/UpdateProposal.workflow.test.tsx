import type { ReactElement, PropsWithChildren } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render as testingLibraryRender, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentEdgeCategory,
  AgentEdgeType,
  ProposalAction,
  ProposalApprovalType,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  TaskSource,
  WorkStatus,
  type ProposalResponseDto,
  type ProjectedWorkItemChangeSetResponse,
  type TaskResponseDto,
} from "../../../api";
import { unifiedApiClient } from "../../../clients/serviceClients";
import { UpdateProposal } from "../UpdateProposal";
import type {
  UpdateWorkflowProposalUpdates,
  UpdateWorkflowStepProposalUpdates,
} from "../types";

function render(ui: ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  return testingLibraryRender(ui, { wrapper: Wrapper });
}

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: true,
    isReady: true,
    isLoading: false,
    error: null,
  }),
  useWorkItemTypes: () => ({
    workItemTypes: [
      {
        definition: {
          key: "workflow",
          name: "Workflow",
          sections: [{ key: "description", label: "Description" }],
          allowedStatuses: [],
          capabilities: {
            graph: {
              nodeChildType: "workflow_step",
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
        projectId: null,
      },
      {
        definition: {
          key: "workflow_step",
          name: "Workflow Step",
          sections: [{ key: "description", label: "Description" }],
          allowedStatuses: [],
        },
        status: "ACTIVE",
        projectId: null,
      },
    ],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: () => ({
    workItem: { id: WORKFLOW_ID, name: "Existing workflow", type: "workflow" },
    isLoading: false,
    error: null,
  }),
}));

const featureLookup = {
  isReady: true,
  isLoading: false,
  get: () => undefined,
};

vi.mock("../../../data/hooks/useFeatureHierarchy", () => ({
  useFeatureLookup: () => featureLookup,
}));

vi.mock("../../shared/WorkflowMentionInlineRenderer", () => ({
  WorkflowGraphSurface: ({
    graphData,
    projection,
  }: {
    graphData?: { steps: Array<{ id: string; name: string }> };
    projection?: ProjectedWorkItemChangeSetResponse;
  }) => (
    <div data-testid="mock-workflow-graph">
      {graphData?.steps.map((step) => (
        <span key={step.id}>{step.name}</span>
      ))}
      {projection?.children.map((child) => (
        <span
          key={
            child.identity.refType === "existing"
              ? child.identity.id
              : child.identity.tempId
          }
        >
          {child.name}
          {child.sections.map((section) => (
            <span key={section.key}>{String(section.content)}</span>
          ))}
        </span>
      ))}
    </div>
  ),
  buildCanonicalProjectedGraphPositions: () => new Map(),
}));

vi.mock("../../shared/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: string }) => (
    <span data-testid="markdown">{children}</span>
  ),
}));

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getTask: vi.fn(),
    getDesignDoc: vi.fn(),
  },
  proposalsClient: {
    validateProposal: (...args: unknown[]) => mockValidate(...args),
  },
}));

const mockValidate = vi.fn();

const ORG_ID = "org-1";
const PROJ_ID = "proj-1";
const WORKFLOW_ID = "workflow-1";
const continueStep = { refType: "existing" as const, id: "continue-step" };
const mixedGraphUpdates = {
  root: { refType: "existing" as const, id: WORKFLOW_ID },
  operations: [
    {
      op: "section.replace" as const,
      ref: continueStep,
      key: "description",
      content: "Launch exactly one ready task after completion.",
    },
    {
      op: "relationship.delete" as const,
      ref: { refType: "existing" as const, id: "old-fulfillment" },
    },
    {
      op: "relationship.create" as const,
      ref: { refType: "temporary" as const, tempId: "new-fulfillment" },
      source: continueStep,
      target: { refType: "existing" as const, id: "continuation-bug" },
      edgeType: AgentEdgeType.FulfilledBy,
      category: AgentEdgeCategory.Meta,
    },
  ],
};

const existingWorkflow: TaskResponseDto = {
  id: WORKFLOW_ID,
  name: "Existing workflow",
  type: "workflow",
  sections: [
    {
      key: "description",
      content: "Existing workflow body.",
      order: 0,
    },
  ],
  organizationId: ORG_ID,
  projectId: PROJ_ID,
  status: WorkStatus.Backlog,
  source: TaskSource.Agent,
  createdAt: "2026-07-05T00:00:00Z",
  updatedAt: "2026-07-05T00:00:00Z",
};

const updates: UpdateWorkflowProposalUpdates = {
  type: "workflow",
  name: "Updated workflow",
  sections: [
    {
      key: "description",
      content: "Updated workflow body.",
    },
  ],
  steps: [
    {
      id: "step-1",
      name: "Review update",
      description: "Review the change.",
    },
  ],
};

function makeProposal(): ProposalResponseDto & {
  updates: UpdateWorkflowProposalUpdates;
} {
  return {
    id: "proposal-workflow-update",
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    type: ProposalType.Single,
    action: ProposalAction.Update,
    status: ProposalStatus.Pending,
    targetEntityId: WORKFLOW_ID,
    targetEntityType: TargetEntityType.Task,
    updates,
    requestorId: "user-1",
    requiredApprovals: 1,
    approvals: [],
    createdAt: "2026-07-05T00:00:00Z",
    updatedAt: "2026-07-05T00:00:00Z",
  } as ProposalResponseDto & { updates: UpdateWorkflowProposalUpdates };
}

function makeApprovedProposal(
  updates: UpdateWorkflowProposalUpdates | UpdateWorkflowStepProposalUpdates,
  targetEntityId: string,
  id: string,
): ProposalResponseDto & {
  updates: UpdateWorkflowProposalUpdates | UpdateWorkflowStepProposalUpdates;
} {
  return {
    ...makeProposal(),
    id,
    status: ProposalStatus.Approved,
    targetEntityId,
    updates,
  } as ProposalResponseDto & {
    updates: UpdateWorkflowProposalUpdates | UpdateWorkflowStepProposalUpdates;
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(unifiedApiClient.getTask).mockResolvedValue({
    data: { data: existingWorkflow },
  } as never);
  mockValidate.mockResolvedValue({
    data: {
      data: {
        valid: true,
        projectedRoot: {
          identity: { refType: "existing", id: WORKFLOW_ID },
          label: "Shopping workflow",
          type: "workflow",
          name: "Shopping workflow",
          sections: [],
          deleted: false,
        },
        children: [
          {
            identity: { refType: "existing", id: "continue-step" },
            label: "Continue selected work",
            type: "workflow_step",
            name: "Continue selected work",
            parent: { refType: "existing", id: WORKFLOW_ID },
            sections: [
              {
                key: "description",
                content: "Launch exactly one ready task after completion.",
              },
            ],
            deleted: false,
          },
        ],
        sections: [],
        incidentRelationships: [
          {
            identity: { refType: "temporary", tempId: "new-fulfillment" },
            label: AgentEdgeType.FulfilledBy,
            source: { refType: "existing", id: "continue-step" },
            target: { refType: "existing", id: "continuation-bug" },
            edgeType: AgentEdgeType.FulfilledBy,
            category: AgentEdgeCategory.Meta,
            deleted: false,
          },
        ],
        identityLabels: {
          "existing:continue-step": "Continue selected work",
        },
        issues: [],
        warnings: [],
      },
    },
  });
});

describe("UpdateProposal — workflow routing", () => {
  it("routes a generic mixed graph change set without loading the legacy task diff", async () => {
    const graphProposal = {
      ...makeProposal(),
      id: "proposal-workflow-graph-update",
      type: ProposalType.Single,
      updates: mixedGraphUpdates,
    } as ProposalResponseDto;

    render(
      <MemoryRouter>
        <UpdateProposal
          proposals={[graphProposal]}
          onApply={async () => {}}
          organizationId={ORG_ID}
          projectId={PROJ_ID}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findAllByText(
        "Launch exactly one ready task after completion.",
      ),
    ).not.toHaveLength(0);
    expect(screen.getByTestId("mock-workflow-graph")).toBeInTheDocument();
    expect(screen.getByText("Shopping workflow")).toBeInTheDocument();
    expect(screen.queryByText("Task Update")).not.toBeInTheDocument();
    expect(unifiedApiClient.getTask).toHaveBeenCalledTimes(1);
    expect(unifiedApiClient.getTask).toHaveBeenCalledWith({
      organizationId: ORG_ID,
      projectId: PROJ_ID,
      taskId: "continuation-bug",
    });
    expect(mockValidate).toHaveBeenCalledWith(
      expect.objectContaining({
        proposalId: "proposal-workflow-graph-update",
        workItemChangeSetValidationRequest: graphProposal.updates,
      }),
    );
  });

  it("renders graph review independently while an ordinary task update is still loading", async () => {
    vi.mocked(unifiedApiClient.getTask).mockReturnValue(
      new Promise(() => undefined) as never,
    );
    const graphProposal = {
      ...makeProposal(),
      id: "proposal-workflow-graph-update",
      updates: mixedGraphUpdates,
    } as ProposalResponseDto;
    const ordinaryProposal = {
      ...makeProposal(),
      id: "proposal-ordinary-update",
      targetEntityId: "ordinary-task",
      updates: { name: "Updated ordinary task" },
    } as ProposalResponseDto;

    render(
      <MemoryRouter>
        <UpdateProposal
          proposals={[graphProposal, ordinaryProposal]}
          onApply={async () => {}}
          organizationId={ORG_ID}
          projectId={PROJ_ID}
        />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Shopping workflow")).toBeInTheDocument();
    expect(
      await screen.findAllByText(
        "Launch exactly one ready task after completion.",
      ),
    ).not.toHaveLength(0);
    expect(screen.queryByText("Task Update")).not.toBeInTheDocument();
  });

  it("routes workflow task updates to the workflow renderer", async () => {
    const proposal = makeProposal();
    proposal.requiredApprovals = 3;
    proposal.approvals = [
      {
        userId: "approver-1",
        type: ProposalApprovalType.Approval,
        reason: null,
        createdAt: "2026-07-05T01:00:00Z",
      },
      {
        userId: "reviewer-1",
        type: ProposalApprovalType.Rejection,
        reason: "Needs changes",
        createdAt: "2026-07-05T02:00:00Z",
      },
    ];

    render(
      <MemoryRouter>
        <UpdateProposal
          proposals={[proposal]}
          onApply={async () => {}}
          organizationId={ORG_ID}
          projectId={PROJ_ID}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByTestId("proposal-header-action"),
    ).toHaveTextContent("Update");
    expect(screen.getByTestId("proposal-header-type")).toHaveTextContent(
      "Workflow",
    );
    expect(screen.getByText("Updated workflow")).toBeInTheDocument();
    expect(screen.getByText("Updated workflow body.")).toBeInTheDocument();
    expect(screen.getByTestId("mock-workflow-graph")).toBeInTheDocument();
    expect(screen.getByText("Review update")).toBeInTheDocument();
    expect(screen.queryByText("Task Update")).not.toBeInTheDocument();
    expect(screen.getByTestId("proposal-approval-progress")).toHaveTextContent(
      "1 of 3 approvals",
    );
    expect(screen.getByRole("button", { name: "Add approval" })).toBeVisible();
  });

  it("links approved workflow and workflow_step update titles through the shared dispatcher", async () => {
    const workflowProposal = makeApprovedProposal(
      updates,
      WORKFLOW_ID,
      "proposal-approved-workflow-update",
    );
    const workflowStepUpdates: UpdateWorkflowStepProposalUpdates = {
      type: "workflow_step",
      name: "Approved step update",
      sections: [
        {
          key: "description",
          content: "Review the approved step update.",
        },
      ],
    };
    const workflowStepProposal = makeApprovedProposal(
      workflowStepUpdates,
      "workflow-step-1",
      "proposal-approved-workflow-step-update",
    );

    render(
      <MemoryRouter>
        <UpdateProposal
          proposals={[workflowProposal, workflowStepProposal]}
          onApply={async () => {}}
          organizationId={ORG_ID}
          projectId={PROJ_ID}
        />
      </MemoryRouter>,
    );

    expect(
      await screen.findByRole("link", { name: "Updated workflow" }),
    ).toHaveAttribute("href", `/projects/${PROJ_ID}/tasks/${WORKFLOW_ID}`);
    expect(
      await screen.findByRole("link", { name: "Approved step update" }),
    ).toHaveAttribute("href", `/projects/${PROJ_ID}/tasks/workflow-step-1`);
  });
});
