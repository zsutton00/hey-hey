import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentEdgeCategory,
  AgentEdgeDirection,
  AgentEdgeType,
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type CreateTaskDto,
  type ProposalResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import { CreateProposal } from "../CreateProposal";
import type {
  CreateWorkflowProposalUpdates,
  CreateWorkflowStepProposalUpdates,
} from "../types";

vi.mock("../../shared/WorkflowMentionInlineRenderer", () => ({
  WorkflowGraphSurface: ({
    graphData,
  }: {
    graphData: { steps: Array<{ id: string; name: string }> };
  }) => (
    <div data-testid="mock-workflow-graph">
      {graphData.steps.map((step) => (
        <span key={step.id}>{step.name}</span>
      ))}
    </div>
  ),
}));

vi.mock("../../shared/MarkdownRenderer", () => ({
  MarkdownRenderer: ({ children }: { children: string }) => (
    <span data-testid="markdown">{children}</span>
  ),
}));

vi.mock("../../../clients/serviceClients", () => ({
  tasksClient: {
    organizationsOrganizationIdProjectsProjectIdTasksTaskIdPatch: vi.fn(),
  },
  proposalsClient: {
    getProposal: vi.fn(),
    updateProposal: vi.fn(),
  },
}));

vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: () => ({
    isAuthenticated: true,
    user: { id: "test-user", email: "test@example.com" },
    loading: false,
    login: vi.fn(),
    completeChangePassword: vi.fn(),
    logout: vi.fn(),
    toggleDevAdminMode: vi.fn(),
  }),
}));

const workflowDefinitions: Record<string, WorkItemTypeDefinitionDto> = {
  workflow: {
    key: "workflow",
    name: "Workflow",
    sections: [{ key: "description", label: "Description" }],
    allowedStatuses: [],
  } as unknown as WorkItemTypeDefinitionDto,
  workflow_step: {
    key: "workflow_step",
    name: "Workflow Step",
    sections: [{ key: "description", label: "Description" }],
    allowedStatuses: [],
  } as unknown as WorkItemTypeDefinitionDto,
};

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypes: () => ({ workItemTypes: [], isLoading: false, error: null }),
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: true,
    isReady: true,
    isLoading: false,
    error: null,
  }),
  useWorkItemTypeByKey: (
    _organizationId: string,
    _projectId: string,
    typeKey: string,
  ) => ({
    workItemTypeDefinition: workflowDefinitions[typeKey],
    isLoading: false,
    error: null,
  }),
}));

vi.mock("../../Selectors/TaskTreePicker", () => ({
  TaskTreePicker: () => <div data-testid="task-tree-picker" />,
}));

const ORG_ID = "org-1";
const PROJ_ID = "proj-1";

function makeCreateProposal(
  updates: CreateTaskDto,
): ProposalResponseDto & { updates: CreateTaskDto } {
  return {
    id: "proposal-workflow-create",
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    type: ProposalType.Single,
    action: ProposalAction.Create,
    status: ProposalStatus.Pending,
    targetEntityId: "workflow-1",
    targetEntityType: TargetEntityType.Task,
    updates,
    requestorId: "user-1",
    requiredApprovals: 1,
    approvals: [],
    createdAt: "2026-07-05T00:00:00Z",
    updatedAt: "2026-07-05T00:00:00Z",
  } as ProposalResponseDto & { updates: CreateTaskDto };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("CreateProposal — workflow routing", () => {
  it("routes workflow create proposals to the workflow renderer", () => {
    const updates: CreateWorkflowProposalUpdates = {
      type: "workflow",
      name: "Launch workflow",
      sections: [
        {
          key: "description",
          content: "Coordinate launch.",
        },
      ],
      workflowSteps: [
        {
          tempId: "temp-step-1",
          name: "Draft notes",
          description: "Write notes.",
        },
      ],
      workflowLinks: [
        {
          id: "edge-step-1-loop",
          sourceStepTempId: "temp-step-1",
          targetStepTempId: "temp-step-1",
          type: AgentEdgeType.Loop,
          category: AgentEdgeCategory.Flow,
          direction: AgentEdgeDirection.Forward,
        },
      ],
    };

    render(
      <MemoryRouter>
        <CreateProposal
          proposals={[makeCreateProposal(updates)]}
          onApply={async () => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("proposal-header-action")).toHaveTextContent(
      "Create",
    );
    expect(screen.getByTestId("proposal-header-type")).toHaveTextContent(
      "Workflow",
    );
    expect(screen.getByText("Launch workflow")).toBeInTheDocument();
    expect(screen.getByTestId("mock-workflow-graph")).toBeInTheDocument();
    expect(screen.getByText("Draft notes")).toBeInTheDocument();
    expect(screen.queryByTestId("task-tree-picker")).not.toBeInTheDocument();
  });

  it("routes workflow_step create proposals to the workflow step card", () => {
    const updates: CreateWorkflowStepProposalUpdates = {
      type: "workflow_step",
      name: "Review risks",
      sections: [
        {
          key: "description",
          content: "Decide whether launch risk is acceptable.",
        },
      ],
      parentTaskId: "workflow-1",
    };

    render(
      <MemoryRouter>
        <CreateProposal
          proposals={[makeCreateProposal(updates)]}
          onApply={async () => {}}
        />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("proposal-header-action")).toHaveTextContent(
      "Create",
    );
    expect(screen.getByTestId("proposal-header-type")).toHaveTextContent(
      "Workflow Step",
    );
    expect(screen.getByText("Review risks")).toBeInTheDocument();
    expect(
      screen.getByText("Decide whether launch risk is acceptable."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("mock-workflow-graph")).not.toBeInTheDocument();
    expect(screen.queryByTestId("task-tree-picker")).not.toBeInTheDocument();
  });

  it("links approved workflow and workflow_step create titles through the shared dispatcher", () => {
    const workflowProposal = makeCreateProposal({
      type: "workflow",
      name: "Approved launch workflow",
      sections: [],
    });
    workflowProposal.status = ProposalStatus.Approved;

    const workflowStepProposal = {
      ...makeCreateProposal({
        type: "workflow_step",
        name: "Approved launch step",
        sections: [],
        parentTaskId: "workflow-1",
      }),
      id: "proposal-workflow-step-create",
      targetEntityId: "workflow-step-1",
      status: ProposalStatus.Approved,
    };

    render(
      <MemoryRouter>
        <CreateProposal
          proposals={[workflowProposal, workflowStepProposal]}
          onApply={async () => {}}
        />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("link", { name: "Approved launch workflow" }),
    ).toHaveAttribute("href", `/projects/${PROJ_ID}/tasks/workflow-1`);
    expect(
      screen.getByRole("link", { name: "Approved launch step" }),
    ).toHaveAttribute("href", `/projects/${PROJ_ID}/tasks/workflow-step-1`);
  });
});
