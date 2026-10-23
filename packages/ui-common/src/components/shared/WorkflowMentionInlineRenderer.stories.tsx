import { Box } from "@mui/material";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { createHeyTheme } from "../../contexts/ThemeContext";
import {
  DIAGRAM_GROUP_FIXTURE_PAIRS,
  diagramGroupFixtureSection,
} from "./__fixtures__/diagramGroupFixtures";
import type { Meta, StoryObj } from "@storybook/react";
import {
  AgentEdgeCategory,
  AgentEdgeDirection,
  AgentEdgeType,
  TaskSource,
  WorkStatus,
  type AgentEdgeResponseDto,
  type TaskResponseDto,
} from "../../api";
import {
  WorkflowGraphSurface,
  type WorkflowGraphSurfaceData,
} from "./WorkflowMentionInlineRenderer";

const NOW = "2026-07-02T00:00:00.000Z";
const ORGANIZATION_ID = "storybook-org";
const PROJECT_ID = "storybook-project";

const makeTask = (
  overrides: Partial<TaskResponseDto> & Pick<TaskResponseDto, "id" | "name">
): TaskResponseDto => ({
  id: overrides.id,
  name: overrides.name,
  type: overrides.type ?? "STANDARD",
  sections: overrides.sections ?? [],
  organizationId: overrides.organizationId ?? ORGANIZATION_ID,
  projectId: overrides.projectId ?? PROJECT_ID,
  status: overrides.status ?? WorkStatus.Backlog,
  source: overrides.source ?? TaskSource.System,
  parentTaskId: overrides.parentTaskId,
  edges: overrides.edges,
  createdAt: overrides.createdAt ?? NOW,
  updatedAt: overrides.updatedAt ?? NOW,
});

const makeWorkflow = (
  overrides: Omit<Partial<TaskResponseDto>, "type"> &
    Pick<TaskResponseDto, "id" | "name">
): TaskResponseDto & { type: "workflow" } => ({
  ...makeTask(overrides),
  type: "workflow",
});

const makeWorkflowStep = (
  overrides: Omit<Partial<TaskResponseDto>, "type"> &
    Pick<TaskResponseDto, "id" | "name">
): TaskResponseDto & { type: "workflow_step" } => ({
  ...makeTask(overrides),
  type: "workflow_step",
});

const makeEdge = (
  overrides: Pick<
    AgentEdgeResponseDto,
    "id" | "sourceNodeId" | "targetNodeId" | "type"
  > &
    Partial<AgentEdgeResponseDto> & {
      sourceNodeName?: string;
      targetNodeName?: string;
    }
): AgentEdgeResponseDto => ({
  id: overrides.id,
  sourceNodeId: overrides.sourceNodeId,
  sourceNodeName: overrides.sourceNodeName,
  targetNodeId: overrides.targetNodeId,
  targetNodeName: overrides.targetNodeName,
  type: overrides.type,
  category: overrides.category,
  direction: overrides.direction,
  predicate: overrides.predicate,
  reasoning: overrides.reasoning ?? "",
  createdAt: overrides.createdAt ?? NOW,
  updatedAt: overrides.updatedAt ?? NOW,
});

const launchWorkflow = makeWorkflow({
  id: "workflow-launch",
  name: "Launch workflow",
});

const draftStep = makeWorkflowStep({
  id: "workflow-step-draft",
  name: "Draft release plan",
  parentTaskId: launchWorkflow.id,
});

const reviewStep = makeWorkflowStep({
  id: "workflow-step-review",
  name: "Review launch risks",
  parentTaskId: launchWorkflow.id,
});

const approvalStep = makeWorkflowStep({
  id: "workflow-step-approval",
  name: "Approve launch",
  parentTaskId: launchWorkflow.id,
});

const announceStep = makeWorkflowStep({
  id: "workflow-step-announce",
  name: "Publish announcement",
  parentTaskId: launchWorkflow.id,
});

const draftStepEdges = [
  makeEdge({
    id: "workflow-edge-draft-review",
    sourceNodeId: draftStep.id,
    targetNodeId: reviewStep.id,
    type: AgentEdgeType.Standard,
    category: AgentEdgeCategory.Flow,
    direction: AgentEdgeDirection.Forward,
  }),
  makeEdge({
    id: "workflow-edge-draft-fulfillment",
    sourceNodeId: draftStep.id,
    targetNodeId: "task-release-plan",
    type: AgentEdgeType.FulfilledBy,
    sourceNodeName: draftStep.name,
    targetNodeName: "Write release plan",
  }),
  makeEdge({
    id: "workflow-edge-draft-content-review",
    sourceNodeId: draftStep.id,
    targetNodeId: "task-content-review",
    type: AgentEdgeType.FulfilledBy,
    sourceNodeName: draftStep.name,
    targetNodeName: "Review launch content",
  }),
];

const reviewStepEdges = [
  makeEdge({
    id: "workflow-edge-review-approval",
    sourceNodeId: reviewStep.id,
    targetNodeId: approvalStep.id,
    type: AgentEdgeType.Conditional,
    category: AgentEdgeCategory.Flow,
    direction: AgentEdgeDirection.Forward,
    predicate: "Risks accepted",
  }),
  makeEdge({
    id: "workflow-edge-review-draft",
    sourceNodeId: reviewStep.id,
    targetNodeId: draftStep.id,
    type: AgentEdgeType.Loop,
    category: AgentEdgeCategory.Flow,
  }),
];

const approvalStepEdges = [
  makeEdge({
    id: "workflow-edge-approval-announce",
    sourceNodeId: approvalStep.id,
    targetNodeId: announceStep.id,
    type: AgentEdgeType.Standard,
    category: AgentEdgeCategory.Flow,
    direction: AgentEdgeDirection.Forward,
  }),
  makeEdge({
    id: "workflow-edge-approval-fulfillment",
    sourceNodeId: approvalStep.id,
    targetNodeId: "task-approval",
    type: AgentEdgeType.FulfilledBy,
    sourceNodeName: approvalStep.name,
    targetNodeName: "Get final approval",
  }),
];

const connectedWorkflowEdges = [
  ...draftStepEdges,
  ...reviewStepEdges,
  ...approvalStepEdges,
  makeEdge({
    id: "workflow-edge-template-contract",
    sourceNodeId: draftStep.id,
    targetNodeId: "contract-effective-template",
    targetNodeName: "Effective template boundary",
    type: AgentEdgeType.DependsOn,
  }),
];

const connectedWorkflowData: WorkflowGraphSurfaceData = {
  workflow: launchWorkflow,
  steps: [
    {
      ...draftStep,
      edges: draftStepEdges,
    },
    {
      ...reviewStep,
      edges: reviewStepEdges,
    },
    {
      ...approvalStep,
      edges: approvalStepEdges,
    },
    announceStep,
  ],
  edges: connectedWorkflowEdges,
  workflowTypeDefinition: {
    key: "workflow",
    name: "Workflow",
    sections: [],
    allowedStatuses: [],
    iconKey: "workflow",
  },
};

const emptyWorkflowData: WorkflowGraphSurfaceData = {
  workflow: makeWorkflow({
    id: "workflow-empty",
    name: "Empty workflow",
  }),
  steps: [],
  edges: [],
};

const meta: Meta<typeof WorkflowGraphSurface> = {
  title: "Components/shared/WorkflowGraphSurface",
  component: WorkflowGraphSurface,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <Box sx={{ width: "100%", minWidth: 0 }}>
        <Story />
      </Box>
    ),
  ],
};

export default meta;

type Story = StoryObj<typeof WorkflowGraphSurface>;

export const ConnectedWorkflow: Story = {
  args: {
    graphData: connectedWorkflowData,
    allowFullscreen: true,
  },
};

export const EmptyWorkflow: Story = {
  args: {
    graphData: emptyWorkflowData,
    allowFullscreen: true,
  },
};

const deploymentFixture = DIAGRAM_GROUP_FIXTURE_PAIRS.find(
  (pair) => pair.key === "aws-gcp-deployment"
)!.grouped;
const groupIdentityData: WorkflowGraphSurfaceData = {
  workflow: makeTask({
    id: "diagram-group-identities",
    name: deploymentFixture.title,
    type: "DIAGRAM",
    sections: [
      {
        id: "groups",
        key: "diagramGroups",
        order: 0,
        materializedMarkdown: JSON.stringify(
          diagramGroupFixtureSection(deploymentFixture)
        ),
      },
    ],
  }),
  steps: deploymentFixture.elements.map((element) =>
    makeTask({
      id: element.id,
      name: element.title,
      type: "DIAGRAM_ELEMENT",
      parentTaskId: "diagram-group-identities",
    })
  ),
  edges: [],
  layout: {
    schemaVersion: "work-item-graph-layout.v1",
    nodes: deploymentFixture.elements.map((element, index) => ({
      node: { kind: "persistedWorkItem", workItemId: element.id },
      position: { x: index * 250, y: (index % 2) * 250 },
    })),
  },
};

export const GroupIdentityLight: Story = {
  args: { graphData: groupIdentityData, allowFullscreen: true },
  decorators: [
    (Story) => (
      <ThemeProvider theme={createTheme({ palette: createHeyTheme("light").palette })}>
        <Story />
      </ThemeProvider>
    ),
  ],
};

export const GroupIdentityDark: Story = {
  ...GroupIdentityLight,
  decorators: [
    (Story) => (
      <ThemeProvider theme={createTheme({ palette: createHeyTheme("dark").palette })}>
        <Story />
      </ThemeProvider>
    ),
  ],
};
