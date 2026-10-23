import { Box } from "@mui/material";
import type { Meta, StoryObj } from "@storybook/react";
import {
  ProposalAction,
  ProposalGroupBlockedReason,
  ProposalGroupDecisionOutcome,
  ProposalGroupLifecycle,
  ProposalGroupMemberExecutionState,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type ProposalGroupApproveAllResult,
  type ProposalGroupMemberSnapshot,
  type ProposalGroupSnapshot,
  type ProposalResponseDto,
} from "../../api";
import { ProposalGroupReviewView } from "./ProposalGroupReview";

const ORGANIZATION_ID = "storybook-org";
const PROJECT_ID = "storybook-project";
const GROUP_ID = "storybook-proposal-group";
const CREATED_AT = "2026-07-27T16:00:00.000Z";
const APPLIED_AT = "2026-07-27T16:08:00.000Z";
const SETTLED_AT = "2026-07-27T16:14:00.000Z";

const proposal = (
  id: string,
  title: string,
  summary: string
): ProposalResponseDto => ({
  id,
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  type: ProposalType.Single,
  action: ProposalAction.Create,
  status: ProposalStatus.Draft,
  targetEntityId: `target-${id}`,
  targetEntityType: TargetEntityType.Conversation,
  title,
  updates: { summary },
  requestorId: "storybook-agent",
  requiredApprovals: 2,
  approvals: [],
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
});

interface MemberOptions {
  id: string;
  order: number;
  title: string;
  summary: string;
  receivedApprovals: number;
  approvalSatisfied: boolean;
  executionState: ProposalGroupMemberExecutionState;
  prerequisiteMemberId?: string;
  blockedReason?: ProposalGroupBlockedReason;
  attempt?: ProposalGroupMemberSnapshot["attempt"];
  terminalTimestamps?: Partial<
    ProposalGroupMemberSnapshot["terminalTimestamps"]
  >;
}

const member = ({
  id,
  order,
  title,
  summary,
  receivedApprovals,
  approvalSatisfied,
  executionState,
  prerequisiteMemberId,
  blockedReason,
  attempt,
  terminalTimestamps,
}: MemberOptions): ProposalGroupMemberSnapshot => ({
  memberId: id,
  memberOrder: order,
  proposal: proposal(`proposal-${id}`, title, summary),
  approvalProgress: {
    receivedApprovals,
    requiredApprovals: 2,
    approvalSatisfied,
    approvalSatisfiedAt: approvalSatisfied ? APPLIED_AT : undefined,
  },
  executionState,
  dependencies: prerequisiteMemberId
    ? [
        {
          dependentMemberId: id,
          prerequisiteMemberId,
        },
      ]
    : [],
  blockedReason,
  attempt,
  terminalTimestamps: {
    appliedAt: null,
    rejectedAt: null,
    invalidatedAt: null,
    failedAt: null,
    ...terminalTimestamps,
  },
});

const createMember = member({
  id: "create-onboarding",
  order: 0,
  title: "Create onboarding flow",
  summary: "Add the guided onboarding flow and its first-run entry point.",
  receivedApprovals: 1,
  approvalSatisfied: false,
  executionState: ProposalGroupMemberExecutionState.PendingApproval,
  blockedReason: ProposalGroupBlockedReason.ApprovalsPending,
});

const updateMember = member({
  id: "publish-guidance",
  order: 1,
  title: "Publish onboarding guidance",
  summary: "Publish guidance after the onboarding flow has been applied.",
  receivedApprovals: 2,
  approvalSatisfied: true,
  executionState: ProposalGroupMemberExecutionState.WaitingOnDependencies,
  prerequisiteMemberId: createMember.memberId,
  blockedReason: ProposalGroupBlockedReason.DependenciesPending,
});

const retryableMember = member({
  id: "notify-owners",
  order: 2,
  title: "Notify project owners",
  summary: "Notify project owners when the new onboarding flow is available.",
  receivedApprovals: 2,
  approvalSatisfied: true,
  executionState: ProposalGroupMemberExecutionState.RetryableFailure,
  prerequisiteMemberId: updateMember.memberId,
  blockedReason: ProposalGroupBlockedReason.RetryableFailure,
  attempt: {
    attemptCount: 2,
    lastAttemptedAt: "2026-07-27T16:10:00.000Z",
    lastError: "Notification delivery timed out; retry remains available.",
  },
});

const reviewableGroup: ProposalGroupSnapshot = {
  groupId: GROUP_ID,
  organizationId: ORGANIZATION_ID,
  projectId: PROJECT_ID,
  lifecycle: ProposalGroupLifecycle.Reviewable,
  currentRevision: 4,
  frozenRevision: 4,
  frozenAt: CREATED_AT,
  members: [createMember, updateMember, retryableMember],
  dependencies: [
    {
      dependentMemberId: updateMember.memberId,
      prerequisiteMemberId: createMember.memberId,
    },
    {
      dependentMemberId: retryableMember.memberId,
      prerequisiteMemberId: updateMember.memberId,
    },
  ],
  createdAt: CREATED_AT,
  updatedAt: "2026-07-27T16:10:00.000Z",
};

const partialApproveAllResult: ProposalGroupApproveAllResult = {
  groupId: GROUP_ID,
  revision: 4,
  results: [
    {
      memberId: createMember.memberId,
      proposalId: createMember.proposal.id,
      outcome: ProposalGroupDecisionOutcome.ApprovalRecorded,
      receivedApprovals: 2,
      requiredApprovals: 2,
      approvalSatisfied: true,
      dependencyReady: true,
      executionState: ProposalGroupMemberExecutionState.Ready,
    },
    {
      memberId: updateMember.memberId,
      proposalId: updateMember.proposal.id,
      outcome: ProposalGroupDecisionOutcome.AlreadyApproved,
      receivedApprovals: 2,
      requiredApprovals: 2,
      approvalSatisfied: true,
      dependencyReady: false,
      executionState:
        ProposalGroupMemberExecutionState.WaitingOnDependencies,
      blockedReason: ProposalGroupBlockedReason.DependenciesPending,
      message: "Approval is satisfied; the prerequisite has not applied yet.",
    },
    {
      memberId: retryableMember.memberId,
      proposalId: retryableMember.proposal.id,
      outcome: ProposalGroupDecisionOutcome.Failed,
      receivedApprovals: 2,
      requiredApprovals: 2,
      approvalSatisfied: true,
      dependencyReady: false,
      executionState: ProposalGroupMemberExecutionState.RetryableFailure,
      blockedReason: ProposalGroupBlockedReason.RetryableFailure,
      message: "The prior execution attempt failed and remains retryable.",
    },
  ],
};

const settledGroup: ProposalGroupSnapshot = {
  ...reviewableGroup,
  lifecycle: ProposalGroupLifecycle.Settled,
  currentRevision: 7,
  settledAt: SETTLED_AT,
  updatedAt: SETTLED_AT,
  members: [
    member({
      id: createMember.memberId,
      order: 0,
      title: "Create onboarding flow",
      summary: "Add the guided onboarding flow and its first-run entry point.",
      receivedApprovals: 2,
      approvalSatisfied: true,
      executionState: ProposalGroupMemberExecutionState.Applied,
      attempt: {
        attemptCount: 1,
        startedAt: "2026-07-27T16:06:00.000Z",
        completedAt: APPLIED_AT,
        lastAttemptedAt: "2026-07-27T16:06:00.000Z",
      },
      terminalTimestamps: { appliedAt: APPLIED_AT },
    }),
    member({
      id: updateMember.memberId,
      order: 1,
      title: "Publish onboarding guidance",
      summary: "Publish guidance after the onboarding flow has been applied.",
      receivedApprovals: 1,
      approvalSatisfied: false,
      executionState: ProposalGroupMemberExecutionState.Rejected,
      prerequisiteMemberId: createMember.memberId,
      terminalTimestamps: {
        rejectedAt: "2026-07-27T16:11:00.000Z",
      },
    }),
    member({
      id: retryableMember.memberId,
      order: 2,
      title: "Notify project owners",
      summary: "Notify project owners when the new onboarding flow is available.",
      receivedApprovals: 2,
      approvalSatisfied: true,
      executionState: ProposalGroupMemberExecutionState.Invalidated,
      prerequisiteMemberId: updateMember.memberId,
      blockedReason: ProposalGroupBlockedReason.PrerequisiteRejected,
      terminalTimestamps: {
        invalidatedAt: SETTLED_AT,
      },
    }),
  ],
};

const meta: Meta<typeof ProposalGroupReviewView> = {
  title: "Components/ProposalGroupReview",
  component: ProposalGroupReviewView,
  parameters: {
    layout: "padded",
  },
  decorators: [
    (Story) => (
      <Box sx={{ width: 920, maxWidth: "100%" }}>
        <Story />
      </Box>
    ),
  ],
  args: {
    organizationId: ORGANIZATION_ID,
    projectId: PROJECT_ID,
    proposalGroup: reviewableGroup,
    onApproveMember: async () => undefined,
    onRejectMember: async () => undefined,
    onApproveAll: async () => undefined,
    decidingProposalIds: new Set(),
    isApprovingAll: false,
    approveAllResult: null,
    decisionProposals: new Map(),
    decisionError: null,
  },
};

export default meta;

type Story = StoryObj<typeof ProposalGroupReviewView>;

export const ReviewableMixedPolicy: Story = {};

export const PartialApproveAllOutcome: Story = {
  args: {
    approveAllResult: partialApproveAllResult,
  },
};

export const DecisionInProgress: Story = {
  args: {
    decidingProposalIds: new Set([createMember.proposal.id]),
    isApprovingAll: true,
  },
};

export const SettledAudit: Story = {
  args: {
    proposalGroup: settledGroup,
  },
};
