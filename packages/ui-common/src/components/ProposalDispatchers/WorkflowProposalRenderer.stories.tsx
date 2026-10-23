import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/react";
import {
  AgentEdgeCategory,
  AgentEdgeDirection,
  AgentEdgeType,
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  TaskSource,
  WorkStatus,
  type MaterializedWorkItemSection,
  type ProposalResponseDto,
  type TaskResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../api";
import { WorkflowProposalRenderer } from "./WorkflowProposalRenderer";
import type {
  CreateWorkflowProposalUpdates,
  CreateWorkflowStepProposalUpdates,
  UpdateWorkflowProposalUpdates,
  WorkflowCreateProposalUpdates,
  WorkflowUpdateProposalUpdates,
} from "./types";

const NOW = "2026-07-05T00:00:00.000Z";
const ORGANIZATION_ID = "storybook-org";
const PROJECT_ID = "storybook-project";
const WORKFLOW_ID = "workflow-launch";

const section = (
  key: TaskSectionKey,
  content: string,
  order: number,
): MaterializedWorkItemSection => ({
  id: `${key}-${order}`,
  key,
  order,
  materializedMarkdown: content,
});

const proposalSection = (
  key: TaskSectionKey,
  content: string,
  order: number,
): { key: TaskSectionKey; content: string; order: number } => ({
  key,
  content,
  order,
});

const buildProposal = (
  action: ProposalAction,
  updates: WorkflowCreateProposalUpdates | WorkflowUpdateProposalUpdates,
): ProposalResponseDto & {
  updates: WorkflowCreateProposalUpdates | WorkflowUpdateProposalUpdates;
} =>
  ({
    id: `story-workflow-${action.toLowerCase()}`,
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    type: ProposalType.Single,
    action,
    status: ProposalStatus.Pending,
    targetEntityId: WORKFLOW_ID,
    targetEntityType: TargetEntityType.Task,
    updates,
    requestorId: "user-1",
    createdAt: NOW,
    updatedAt: NOW,
  }) as ProposalResponseDto & {
    updates: WorkflowCreateProposalUpdates | WorkflowUpdateProposalUpdates;
  };

const existingWorkflow: TaskResponseDto = {
  id: WORKFLOW_ID,
  name: "Existing launch workflow",
  type: "workflow",
  sections: [
    section(
      "description",
      "The current workflow coordinates release readiness across design, engineering, and support.",
      0,
    ),
  ],
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  status: WorkStatus.Backlog,
  source: TaskSource.Agent,
  createdAt: NOW,
  updatedAt: NOW,
};

const workflowTypeDefinition: WorkItemTypeDefinitionDto = {
  key: "workflow",
  name: "Workflow",
  sections: [],
  allowedStatuses: [],
};

const containerOnlyUpdates: CreateWorkflowProposalUpdates = {
  type: "workflow",
  name: "Launch readiness workflow",
  sections: [
    proposalSection(
      "description",
      "Create the top-level workflow container before the authoring pass adds individual states and handoffs.",
      0,
    ),
  ],
};

const workflowStepUpdates: CreateWorkflowStepProposalUpdates = {
  type: "workflow_step",
  name: "Review release risks",
  parentTaskId: WORKFLOW_ID,
  sections: [
    proposalSection(
      "description",
      "Review known launch risks and decide whether any item blocks the release.",
      0,
    ),
    proposalSection(
      "acceptanceCriteria",
      "- Risk list is reviewed\n- Blocking issues are assigned\n- Release decision is recorded",
      1,
    ),
  ],
};

const embeddedGraphUpdates: CreateWorkflowProposalUpdates = {
  type: "workflow",
  name: "Launch readiness workflow",
  sections: [
    proposalSection(
      "description",
      "A proposed workflow that starts with release planning, branches on risk review, loops when revisions are needed, and ends with announcement prep.",
      0,
    ),
  ],
  workflowSteps: [
    {
      tempId: "temp-workflow-step-draft-plan",
      name: "Draft release plan",
      description:
        "Prepare the release plan, target date, checklist, and owner assignments.",
    },
    {
      tempId: "temp-workflow-step-review-risks",
      name: "Review risks",
      description:
        "Inspect open risks and decide whether the launch can proceed.",
    },
    {
      tempId: "temp-workflow-step-approve-launch",
      name: "Approve launch",
      description:
        "Record approval when risks are accepted and launch criteria are met.",
    },
    {
      tempId: "temp-workflow-step-publish-announcement",
      name: "Publish announcement",
      description:
        "Prepare and publish the user-facing announcement after approval.",
    },
  ],
  workflowLinks: [
    {
      id: "edge-draft-review",
      sourceStepTempId: "temp-workflow-step-draft-plan",
      targetStepTempId: "temp-workflow-step-review-risks",
      type: AgentEdgeType.Standard,
      category: AgentEdgeCategory.Flow,
      direction: AgentEdgeDirection.Forward,
    },
    {
      id: "edge-review-approve",
      sourceStepTempId: "temp-workflow-step-review-risks",
      targetStepTempId: "temp-workflow-step-approve-launch",
      type: AgentEdgeType.Conditional,
      category: AgentEdgeCategory.Flow,
      direction: AgentEdgeDirection.Forward,
      predicate: "Risks accepted",
    },
    {
      id: "edge-review-draft-loop",
      sourceStepTempId: "temp-workflow-step-review-risks",
      targetStepTempId: "temp-workflow-step-draft-plan",
      type: AgentEdgeType.Loop,
      category: AgentEdgeCategory.Flow,
    },
    {
      id: "edge-approve-announce",
      sourceStepTempId: "temp-workflow-step-approve-launch",
      targetStepTempId: "temp-workflow-step-publish-announcement",
      type: AgentEdgeType.Standard,
      category: AgentEdgeCategory.Flow,
      direction: AgentEdgeDirection.Forward,
    },
    {
      id: "edge-draft-fulfillment",
      sourceStepTempId: "temp-workflow-step-draft-plan",
      targetTaskId: "task-release-plan",
      type: AgentEdgeType.FulfilledBy,
      category: AgentEdgeCategory.Meta,
    },
    {
      id: "edge-approval-fulfillment",
      sourceStepTempId: "temp-workflow-step-approve-launch",
      targetTaskId: "task-approval",
      type: AgentEdgeType.FulfilledBy,
      category: AgentEdgeCategory.Meta,
    },
  ],
};

const updateGraphUpdates: UpdateWorkflowProposalUpdates = {
  type: "workflow",
  name: "Launch readiness workflow",
  sections: [
    proposalSection(
      "description",
      "Update the launch workflow to make the review branch and announcement handoff visible before approval.",
      0,
    ),
  ],
  workflowSteps: embeddedGraphUpdates.workflowSteps,
  workflowLinks: embeddedGraphUpdates.workflowLinks,
};

const meta: Meta<typeof WorkflowProposalRenderer> = {
  title: "Components/ProposalDispatchers/WorkflowProposalRenderer",
  component: WorkflowProposalRenderer,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <Box sx={{ width: 820, maxWidth: "100%" }}>
        <Story />
      </Box>
    ),
  ],
  args: {
    status: { state: "pending" },
    onApply: () => {},
    onReject: async () => {},
  },
};

export default meta;

type Story = StoryObj<typeof WorkflowProposalRenderer>;

export const WorkflowContainerOnly: Story = {
  args: {
    mode: "create",
    typeLabel: "Workflow",
    proposal: buildProposal(ProposalAction.Create, containerOnlyUpdates),
  },
};

export const WorkflowStepCard: Story = {
  args: {
    mode: "create",
    typeLabel: "Workflow Step",
    proposal: buildProposal(ProposalAction.Create, workflowStepUpdates),
  },
};

export const EmbeddedWorkflowGraph: Story = {
  args: {
    mode: "create",
    typeLabel: "Workflow",
    proposal: buildProposal(ProposalAction.Create, embeddedGraphUpdates),
  },
};

export const UpdateWithEmbeddedGraph: Story = {
  args: {
    mode: "update",
    proposal: buildProposal(ProposalAction.Update, updateGraphUpdates),
    existing: existingWorkflow,
    workItemTypeDefinition: workflowTypeDefinition,
  },
};
