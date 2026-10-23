import { render, screen } from "@testing-library/react";
import type React from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentEdgeCategory,
  AgentEdgeDirection,
  AgentEdgeType,
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../../api";
import { ProjectContext } from "../../../contexts";
import { proposalsClient } from "../../../clients/serviceClients";
import type { WorkflowGraphSurfaceData } from "../../shared/WorkflowMentionInlineRenderer";
import { WorkflowProposalRenderer } from "../WorkflowProposalRenderer";
import { __resetForTests, setNewEntityId } from "../proposalSelectedStateCache";
import type {
  CreateWorkflowProposalUpdates,
  ProposalItemStatus,
} from "../types";
import { PLACEHOLDER_ENTITY_ID } from "../types";

const workflowGraphSurfaceMock = vi.hoisted(() =>
  vi.fn(
    ({
      graphData,
      disableLinks,
    }: {
      graphData: WorkflowGraphSurfaceData;
      disableLinks?: boolean;
    }) => (
      <div
        data-testid="mock-workflow-graph"
        data-disable-links={String(disableLinks)}
      >
        <span>{graphData.workflow.name}</span>
        {graphData.steps.map((step) => (
          <span key={step.id}>{step.name}</span>
        ))}
        {graphData.edges.map((edge) => (
          <span key={edge.id}>{edge.id}</span>
        ))}
      </div>
    ),
  ),
);

vi.mock("../../shared/WorkflowMentionInlineRenderer", () => ({
  WorkflowGraphSurface: workflowGraphSurfaceMock,
}));

vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: {
    getProposal: vi.fn(),
  },
}));

const workflowRegistry = vi.hoisted(() => ({
  definitions: {} as Record<string, WorkItemTypeDefinitionDto>,
  isLoading: false,
  error: null as Error | null,
}));

vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeByKey: (
    _organizationId: string,
    _projectId: string,
    typeKey: string,
  ) => ({
    workItemTypeDefinition: workflowRegistry.definitions[typeKey],
    isLoading: workflowRegistry.isLoading,
    error: workflowRegistry.error,
  }),
}));

vi.mock("../../shared/MarkdownRenderer", () => ({
  MarkdownRenderer: ({
    children,
    disableMentionLinks,
  }: {
    children: string;
    disableMentionLinks?: boolean;
  }) => (
    <span
      data-testid="markdown"
      data-disable-mention-links={String(disableMentionLinks)}
    >
      {children}
    </span>
  ),
}));

const ORG_ID = "org-1";
const PROJ_ID = "proj-1";
const WORKFLOW_ID = "workflow-1";

const projectWrapper: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => (
  <MemoryRouter>
    <ProjectContext.Provider
      value={{
        organizationId: ORG_ID,
        projectId: PROJ_ID,
        navigate: vi.fn(),
      }}
    >
      {children}
    </ProjectContext.Provider>
  </MemoryRouter>
);

const workflowUpdates: CreateWorkflowProposalUpdates = {
  type: "workflow",
  name: "Release workflow",
  sections: [
    {
      key: "description",
      content: "Coordinate release review.",
    },
  ],
  workflowSteps: [
    {
      tempId: "temp-step-draft",
      name: "Draft release notes",
      description: "Write the notes.",
    },
    {
      tempId: "temp-step-approve",
      title: "Approve release",
      sections: [
        {
          key: "description",
          content: "Check launch readiness.",
        },
      ],
    },
  ],
  workflowLinks: [
    {
      id: "edge-draft-approve",
      sourceStepTempId: "temp-step-draft",
      targetStepTempId: "temp-step-approve",
      type: AgentEdgeType.Standard,
      category: AgentEdgeCategory.Flow,
      direction: AgentEdgeDirection.Forward,
    },
    {
      id: "edge-approval-task",
      sourceStepTempId: "temp-step-approve",
      targetTaskId: "task-approval",
      type: AgentEdgeType.FulfilledBy,
    },
  ],
};

function makeProposal(
  updates: CreateWorkflowProposalUpdates,
  targetEntityId = WORKFLOW_ID,
): ProposalResponseDto & { updates: CreateWorkflowProposalUpdates } {
  return {
    id: "proposal-workflow-1",
    organizationId: ORG_ID,
    projectId: PROJ_ID,
    type: ProposalType.Single,
    action: ProposalAction.Create,
    status: ProposalStatus.Pending,
    targetEntityId,
    targetEntityType: TargetEntityType.Task,
    updates,
    requestorId: "user-1",
    createdAt: "2026-07-05T00:00:00Z",
    updatedAt: "2026-07-05T00:00:00Z",
  } as ProposalResponseDto & { updates: CreateWorkflowProposalUpdates };
}

describe("WorkflowProposalRenderer", () => {
  beforeEach(() => {
    workflowRegistry.definitions = {
      workflow: {
        key: "workflow",
        name: "Workflow",
        sections: [
          { key: "description", label: "Description" },
          { key: "acceptanceCriteria", label: "Acceptance criteria" },
          { key: "operatorNotes", label: "Operator Notes" },
        ],
        allowedStatuses: [],
      } as unknown as WorkItemTypeDefinitionDto,
      workflow_step: {
        key: "workflow_step",
        name: "Workflow Step",
        sections: [{ key: "description", label: "Description" }],
        allowedStatuses: [],
      } as unknown as WorkItemTypeDefinitionDto,
    };
    workflowRegistry.isLoading = false;
    workflowRegistry.error = null;
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.clearAllMocks();
    __resetForTests();
  });

  it("renders an applied proposal title as a link to the workflow entity route", () => {
    render(
      <WorkflowProposalRenderer
        mode="create"
        proposal={makeProposal(workflowUpdates)}
        status={{ state: "applied" }}
        onApply={() => {}}
      />,
      { wrapper: projectWrapper },
    );

    expect(
      screen.getByRole("link", { name: "Release workflow" }),
    ).toHaveAttribute("href", `/projects/${PROJ_ID}/tasks/${WORKFLOW_ID}`);
    expect(screen.getByTestId("mock-workflow-graph")).toHaveAttribute(
      "data-disable-links",
      "true",
    );
  });

  it.each<ProposalItemStatus["state"]>(["pending", "applying", "rejected"])(
    "renders a %s proposal title as plain text",
    (state) => {
      render(
        <WorkflowProposalRenderer
          mode="create"
          proposal={makeProposal(workflowUpdates)}
          status={{ state }}
          onApply={() => {}}
        />,
        { wrapper: projectWrapper },
      );

      expect(
        screen.queryByRole("link", { name: "Release workflow" }),
      ).not.toBeInTheDocument();
      expect(screen.getAllByText("Release workflow")).toHaveLength(2);
    },
  );

  it("keeps the applied proposal title plain while the target id is still a placeholder", () => {
    render(
      <WorkflowProposalRenderer
        mode="create"
        proposal={makeProposal(workflowUpdates, PLACEHOLDER_ENTITY_ID)}
        status={{ state: "applied" }}
        onApply={() => {}}
      />,
      { wrapper: projectWrapper },
    );

    expect(
      screen.queryByRole("link", { name: "Release workflow" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByText("Release workflow")).toHaveLength(2);
  });

  it("links when a refreshed applied proposal supplies its materialized target", () => {
    const proposal = makeProposal(workflowUpdates, PLACEHOLDER_ENTITY_ID);
    const { rerender } = render(
      <WorkflowProposalRenderer
        mode="create"
        proposal={proposal}
        status={{ state: "applied" }}
        onApply={() => {}}
      />,
      { wrapper: projectWrapper },
    );

    expect(
      screen.queryByRole("link", { name: "Release workflow" }),
    ).not.toBeInTheDocument();

    rerender(
      <WorkflowProposalRenderer
        mode="create"
        proposal={{ ...proposal, targetEntityId: WORKFLOW_ID }}
        status={{ state: "applied" }}
        onApply={() => {}}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Release workflow" }),
    ).toHaveAttribute("href", `/projects/${PROJ_ID}/tasks/${WORKFLOW_ID}`);
  });

  it("does not reload an applied workflow when its target id is already materialized", () => {
    render(
      <WorkflowProposalRenderer
        mode="create"
        proposal={makeProposal(workflowUpdates, WORKFLOW_ID)}
        status={{ state: "applied" }}
        onApply={() => {}}
      />,
      { wrapper: projectWrapper },
    );

    expect(proposalsClient.getProposal).not.toHaveBeenCalled();
  });

  it("uses the cached materialized target for an applied workflow_step title link", () => {
    const proposal = makeProposal(
      {
        type: "workflow_step",
        name: "Review release",
        sections: [
          {
            key: "description",
            content: "Review the release.",
          },
        ],
        parentTaskId: WORKFLOW_ID,
      },
      PLACEHOLDER_ENTITY_ID,
    );
    setNewEntityId(proposal.id, "workflow-step-1");

    render(
      <WorkflowProposalRenderer
        mode="create"
        proposal={proposal}
        status={{ state: "applied" }}
        onApply={() => {}}
      />,
      { wrapper: projectWrapper },
    );

    expect(
      screen.getByRole("link", { name: "Review release" }),
    ).toHaveAttribute("href", `/projects/${PROJ_ID}/tasks/workflow-step-1`);
  });

  it("renders embedded proposed steps and links through the workflow graph surface", () => {
    render(
      <WorkflowProposalRenderer
        mode="create"
        proposal={makeProposal(workflowUpdates)}
        status={{ state: "pending" }}
        onApply={() => {}}
      />,
    );

    expect(screen.getByTestId("workflow-proposal-card")).toHaveAttribute(
      "data-workflow-proposal-type",
      "workflow",
    );
    expect(screen.getByTestId("proposal-header-action")).toHaveTextContent(
      "Create",
    );
    expect(screen.getByTestId("proposal-header-type")).toHaveTextContent(
      "Workflow",
    );
    expect(screen.getByTestId("proposal-header-type")).toHaveClass(
      "MuiChip-filled",
    );
    expect(screen.getAllByText("Release workflow")).toHaveLength(2);
    expect(screen.getByTestId("mock-workflow-graph")).toBeInTheDocument();
    expect(screen.getByTestId("mock-workflow-graph")).toHaveAttribute(
      "data-disable-links",
      "true",
    );
    expect(screen.getByText("Draft release notes")).toBeInTheDocument();
    expect(screen.getByText("Approve release")).toBeInTheDocument();
    expect(screen.getByText("edge-draft-approve")).toBeInTheDocument();
    expect(screen.getByText("edge-approval-task")).toBeInTheDocument();

    expect(workflowGraphSurfaceMock).toHaveBeenCalledWith(
      {
        disableLinks: true,
        graphData: expect.objectContaining({
          workflow: expect.objectContaining({
            id: WORKFLOW_ID,
            name: "Release workflow",
            type: "workflow",
          }),
          steps: expect.arrayContaining([
            expect.objectContaining({
              id: "temp-step-draft",
              type: "workflow_step",
              parentTaskId: WORKFLOW_ID,
            }),
          ]),
          edges: expect.arrayContaining([
            expect.objectContaining({
              id: "edge-draft-approve",
              sourceNodeId: "temp-step-draft",
              targetNodeId: "temp-step-approve",
              type: AgentEdgeType.Standard,
              category: AgentEdgeCategory.Flow,
            }),
            expect.objectContaining({
              id: "edge-approval-task",
              sourceNodeId: "temp-step-approve",
              targetNodeId: "task-approval",
              type: AgentEdgeType.FulfilledBy,
            }),
          ]),
        }),
      },
      undefined,
    );
  });

  it("falls back to a workflow card when no embedded graph is present", () => {
    workflowGraphSurfaceMock.mockClear();
    render(
      <WorkflowProposalRenderer
        mode="create"
        proposal={makeProposal({
          type: "workflow",
          name: "Container only workflow",
          sections: [
            {
              key: "description",
              content: "Create the container first.",
            },
          ],
        })}
        status={{ state: "pending" }}
        onApply={() => {}}
      />,
    );

    expect(screen.getByText("Container only workflow")).toBeInTheDocument();
    expect(screen.getByText("Create the container first.")).toBeInTheDocument();
    expect(screen.queryByTestId("mock-workflow-graph")).not.toBeInTheDocument();
    expect(workflowGraphSurfaceMock).not.toHaveBeenCalled();
  });

  it("renders workflow proposal descriptions as truncated plain mention text", () => {
    const longDescription = `Review @[feature:feature-mention-nodes|Mention Nodes] ${"before launch ".repeat(
      20,
    )}`;

    render(
      <WorkflowProposalRenderer
        mode="create"
        proposal={makeProposal({
          type: "workflow",
          name: "Mention workflow",
          sections: [
            {
              key: "description",
              content: longDescription,
            },
          ],
        })}
        status={{ state: "pending" }}
        onApply={() => {}}
      />,
      { wrapper: projectWrapper },
    );

    const description = screen.getByTestId("workflow-proposal-description");
    expect(description).toHaveTextContent(/^Review Mention Nodes/);
    expect(description.textContent).not.toContain("@[feature:");
    expect(description.textContent?.length).toBeLessThanOrEqual(180);
    expect(description.textContent?.endsWith("...")).toBe(true);
    expect(
      screen.queryByRole("link", { name: "Mention Nodes" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("markdown")).not.toBeInTheDocument();
  });

  it("keeps an explicitly emptied workflow description reviewable", () => {
    render(
      <WorkflowProposalRenderer
        mode="create"
        proposal={makeProposal({
          type: "workflow",
          name: "Workflow without a description",
          sections: [
            {
              key: "description",
              content: "",
            },
          ],
        })}
        status={{ state: "pending" }}
        onApply={() => {}}
      />,
      { wrapper: projectWrapper },
    );

    expect(
      screen.getByTestId("workflow-proposal-description"),
    ).toHaveTextContent("(empty)");
    expect(screen.getByText("Description")).toBeInTheDocument();
  });

  it("renders workflow proposal acceptance criteria without mention links", () => {
    render(
      <WorkflowProposalRenderer
        mode="create"
        proposal={makeProposal({
          type: "workflow",
          name: "Criteria workflow",
          sections: [
            {
              key: "acceptanceCriteria",
              content: "- Coordinate with @[task:review-task|Review Task]",
            },
          ],
        })}
        status={{ state: "pending" }}
        onApply={() => {}}
      />,
      { wrapper: projectWrapper },
    );

    expect(screen.getByTestId("markdown")).toHaveAttribute(
      "data-disable-mention-links",
      "true",
    );
  });

  it("renders arbitrary sections in registry order with registry labels", () => {
    render(
      <WorkflowProposalRenderer
        mode="create"
        proposal={makeProposal({
          type: "workflow",
          name: "Operational workflow",
          sections: [
            { key: "operatorNotes", content: "Escalate after ten minutes." },
            { key: "acceptanceCriteria", content: "The run completes." },
          ],
        })}
        status={{ state: "pending" }}
        onApply={() => {}}
      />,
      { wrapper: projectWrapper },
    );

    const sections = screen.getAllByTestId("workflow-proposal-section");
    expect(sections.map((section) => section.dataset.sectionKey)).toEqual([
      "acceptanceCriteria",
      "operatorNotes",
    ]);
    expect(sections[0]).toHaveTextContent(
      "Acceptance criteriaThe run completes.",
    );
    expect(sections[1]).toHaveTextContent(
      "Operator NotesEscalate after ten minutes.",
    );
  });

  it("fails closed when the workflow type definition is unavailable", () => {
    delete workflowRegistry.definitions.workflow;

    render(
      <WorkflowProposalRenderer
        mode="create"
        proposal={makeProposal(workflowUpdates)}
        status={{ state: "pending" }}
        onApply={() => {}}
      />,
      { wrapper: projectWrapper },
    );

    expect(
      screen.getByTestId("workflow-create-work-item-type-unavailable"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("workflow-proposal-card"),
    ).not.toBeInTheDocument();
  });

  it("fails closed while workflow type definitions are loading or errored", () => {
    workflowRegistry.isLoading = true;
    const { rerender } = render(
      <WorkflowProposalRenderer
        mode="create"
        proposal={makeProposal(workflowUpdates)}
        status={{ state: "pending" }}
        onApply={() => {}}
      />,
      { wrapper: projectWrapper },
    );

    expect(
      screen.getByTestId("workflow-create-work-item-type-loading"),
    ).toBeInTheDocument();

    workflowRegistry.isLoading = false;
    workflowRegistry.error = new Error("Registry offline");
    rerender(
      <WorkflowProposalRenderer
        mode="create"
        proposal={makeProposal(workflowUpdates)}
        status={{ state: "pending" }}
        onApply={() => {}}
      />,
    );

    expect(
      screen.getByTestId("workflow-create-work-item-type-error"),
    ).toHaveTextContent("Registry offline");
    expect(
      screen.queryByTestId("workflow-proposal-card"),
    ).not.toBeInTheDocument();
  });
});
