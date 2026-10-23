import type { Meta, StoryObj } from "@storybook/react";
import {
  AgentEdgeType,
  EntityType,
  ProposalAction,
  ProposalStatus,
  ProposalType,
  ReportType,
  TargetEntityType,
  WorkItemTypeScalarField,
  WorkStatus,
  type ProposalResponseDto,
  type WorkItemTypeDefinitionDto,
} from "../../api";
import { WorkItemTypeCreateRenderer } from "./WorkItemTypeCreateRenderer";
import { PLACEHOLDER_ENTITY_ID } from "./types";

const buildProposal = (
  updates: WorkItemTypeDefinitionDto
): ProposalResponseDto & { updates: WorkItemTypeDefinitionDto } =>
  ({
    id: "story-work-item-type-create",
    organizationId: "org-1",
    projectId: "proj-1",
    type: ProposalType.Single,
    action: ProposalAction.Create,
    status: ProposalStatus.Draft,
    targetEntityId: PLACEHOLDER_ENTITY_ID,
    targetEntityType: TargetEntityType.WorkItemType,
    updates,
    requestorId: "user-1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  } as unknown as ProposalResponseDto & {
    updates: WorkItemTypeDefinitionDto;
  });

const fullDefinition: WorkItemTypeDefinitionDto = {
  key: "MARKETING",
  name: "Marketing Campaign",
  description: "Captures a marketing campaign and its launch plan.",
  sections: [
    {
      key: "audience",
      label: "Audience",
      writingStandard: "Describe the target audience precisely.",
    },
    {
      key: "channels",
      label: "Channels",
      writingStandard: "List the distribution channels.",
    },
  ],
  requiredScalars: [WorkItemTypeScalarField.DueDate],
  forbiddenScalars: [WorkItemTypeScalarField.Tag],
  allowedStatuses: [
    WorkStatus.Backlog,
    WorkStatus.Active,
    WorkStatus.Completed,
  ],
  agentSettableStatuses: [WorkStatus.Backlog, WorkStatus.Active],
  allowedParentTypes: ["FEATURE"],
  allowedParentEntityTypes: [EntityType.Initiative],
  edgeTargets: [
    { edgeType: AgentEdgeType.DependsOn, targetTypeKeys: ["FEATURE"] },
    { edgeType: AgentEdgeType.RelatedTo, targetTypeKeys: [] },
  ],
  tracking: {
    allowedSourceEntityTypes: [EntityType.Task, EntityType.Initiative],
    allowedSourceTaskTypes: ["GOAL"],
  },
  anchorableReportTypes: [ReportType.Plan, ReportType.Implement],
  writingStandards: {
    create:
      "Lead with the campaign objective, then the audience and the launch window.",
    edit: "Preserve the original objective; revise channels and timing in place.",
  },
  capabilities: {
    trackableByGoals: true,
    participatesInFeatureHierarchy: false,
  },
};

const minimalDefinition: WorkItemTypeDefinitionDto = {
  key: "MINIMAL",
  name: "Minimal Type",
  sections: [],
  allowedStatuses: [],
};

const meta: Meta<typeof WorkItemTypeCreateRenderer> = {
  title: "Components/ProposalDispatchers/WorkItemTypeCreateRenderer",
  component: WorkItemTypeCreateRenderer,
  args: {
    onApply: () => {},
    onReject: async () => {},
  },
};

export default meta;

type Story = StoryObj<typeof WorkItemTypeCreateRenderer>;

export const FullDefinition: Story = {
  args: {
    proposal: buildProposal(fullDefinition),
    status: { state: "pending" },
  },
};

export const MinimalDefinition: Story = {
  args: {
    proposal: buildProposal(minimalDefinition),
    status: { state: "pending" },
  },
};

export const Applied: Story = {
  args: {
    proposal: buildProposal(fullDefinition),
    status: { state: "applied" },
  },
};
