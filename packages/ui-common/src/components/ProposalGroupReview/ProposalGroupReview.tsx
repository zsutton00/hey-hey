import { WorkItemGraphChangeSummary } from "../ProposalDispatchers/WorkItemGraphChangeSummary";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  Paper,
  Stack,
  Typography,
} from "@mui/material";
import React, { useMemo } from "react";
import {
  ProposalGroupDecisionOutcome,
  ProposalGroupLifecycle,
  type ProposalGroupApproveAllResult,
  type ProposalGroupSnapshot,
} from "../../api";
import { useProposalGroup } from "../../data/hooks/useProposalGroup";
import { useProposalGroupDecisions } from "../../data/hooks/useProposalGroupDecisions";
import { ProposalGroupJourneyReview } from "./ProposalGroupJourneyReview";
import { isWorkItemGraphProposal } from "../ProposalDispatchers/types";
import { ProposalGroupMemberReview } from "./ProposalGroupMemberReview";
import {
  extractProposalApprovalFailureDiagnostic,
  ProposalFailureDiagnostic,
} from "../ProposalDispatchers/ProposalFailureDiagnostic";
import { formatProposalGroupLifecycle } from "./proposalGroupStatusText";
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
import {
  getDiagramMetadata,
  WorkflowGraphSurface,
} from "../shared/WorkflowMentionInlineRenderer";
import {
  projectCanonicalProposalGroupGraph,
  resolveCanonicalProposalGroupRootDefinition,
} from "./canonicalProposalGroupGraph";

export interface ProposalGroupReviewProps {
  organizationId: string;
  projectId: string;
  groupId: string;
}

export interface ProposalGroupReviewViewProps {
  organizationId: string;
  projectId: string;
  proposalGroup: ProposalGroupSnapshot;
  onApproveMember: (proposalId: string) => Promise<unknown>;
  onRejectMember: (proposalId: string, reason: string) => Promise<unknown>;
  onApproveAll: () => Promise<unknown>;
  decidingProposalIds: ReadonlySet<string>;
  isApprovingAll: boolean;
  approveAllResult: ProposalGroupApproveAllResult | null;
  decisionProposals: ReadonlyMap<
    string,
    ProposalGroupSnapshot["members"][number]["proposal"]
  >;
  decisionError: Error | null;
}

const decisionFromApproveAllOutcome = (
  outcome: ProposalGroupDecisionOutcome | undefined,
): "approved" | "rejected" | undefined => {
  switch (outcome) {
    case ProposalGroupDecisionOutcome.ApprovalRecorded:
    case ProposalGroupDecisionOutcome.AlreadyApproved:
      return "approved";
    case ProposalGroupDecisionOutcome.AlreadyRejected:
      return "rejected";
    case ProposalGroupDecisionOutcome.NotEligible:
    case ProposalGroupDecisionOutcome.AlreadyTerminal:
    case ProposalGroupDecisionOutcome.Failed:
    case undefined:
      return undefined;
  }
};

const ApproveAllSummary: React.FC<{
  result: ProposalGroupApproveAllResult;
  members: ProposalGroupSnapshot["members"];
}> = ({ result, members }) => {
  const total = members.length;
  if (total === 0) return null;
  const approved = result.results.filter(
    ({ outcome }) => decisionFromApproveAllOutcome(outcome) === "approved",
  ).length;
  const failures = result.results.filter(
    ({ message, diagnostic }) => message || diagnostic,
  );
  return (
    <Stack spacing={1} data-testid="proposal-group-approve-all-summary">
      <LinearProgress
        variant="determinate"
        value={(approved / total) * 100}
        aria-label={`${approved} of ${total} members approved`}
        data-testid="proposal-group-approve-all-progress"
      />
      {failures.map((memberResult) => (
        <Box
          key={memberResult.memberId}
          data-testid="proposal-group-approve-all-member-result"
          data-member-id={memberResult.memberId}
        >
          {memberResult.message ? (
            <Typography
              variant="caption"
              color="text.secondary"
              display="block"
            >
              {memberResult.message}
            </Typography>
          ) : null}
          <ProposalFailureDiagnostic diagnostic={memberResult.diagnostic} />
        </Box>
      ))}
    </Stack>
  );
};

export const ProposalGroupReviewView: React.FC<
  ProposalGroupReviewViewProps
> = ({
  organizationId,
  projectId,
  proposalGroup,
  onApproveMember,
  onRejectMember,
  onApproveAll,
  decidingProposalIds,
  isApprovingAll,
  approveAllResult,
  decisionProposals,
  decisionError,
}) => {
  const registry = useWorkItemTypes(organizationId, { projectId });
  const structuralGraphShape = useMemo(
    () =>
      resolveCanonicalProposalGroupRootDefinition(proposalGroup, []).kind ===
      "unavailable",
    [proposalGroup],
  );
  const groupGraph = useMemo(() => {
    if (registry.isLoading || registry.error) return null;
    const rootResolution = resolveCanonicalProposalGroupRootDefinition(
      proposalGroup,
      registry.workItemTypes.map(({ definition }) => definition),
    );
    if (rootResolution.kind !== "resolved") return rootResolution;
    return projectCanonicalProposalGroupGraph(
      proposalGroup,
      rootResolution.definition,
    );
  }, [
    proposalGroup,
    registry.error,
    registry.isLoading,
    registry.workItemTypes,
  ]);
  const journeys =
    groupGraph?.kind === "ready" &&
    getDiagramMetadata(groupGraph.projection.projectedRoot)?.kind === "UX_FLOW"
      ? proposalGroup.members.filter(
          ({ memberId, proposal }) =>
            memberId === groupGraph.rootMemberId &&
            isWorkItemGraphProposal(proposal),
        )
      : [];
  const allMembersApproved =
    proposalGroup.members.length > 0 &&
    proposalGroup.members.every(
      ({ approvalProgress }) => approvalProgress.approvalSatisfied,
    );
  const approveAllResultComplete =
    approveAllResult?.results.length === proposalGroup.members.length &&
    approveAllResult.results.every(
      ({ approvalSatisfied }) => approvalSatisfied,
    );
  const approveAllComplete = allMembersApproved || approveAllResultComplete;

  return (
    <Paper
      variant="outlined"
      data-testid="proposal-group-review"
      data-group-lifecycle={proposalGroup.lifecycle}
      sx={{ borderWidth: 2, p: 2 }}
    >
      <Stack spacing={2}>
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          <Typography variant="h6">Proposal group review</Typography>
          <Chip
            size="small"
            label={formatProposalGroupLifecycle(proposalGroup.lifecycle)}
            data-testid="proposal-group-lifecycle"
          />
          <Chip
            size="small"
            variant="outlined"
            label="Review uses a fixed snapshot"
            data-testid="proposal-group-review-snapshot"
          />
          {proposalGroup.lifecycle === ProposalGroupLifecycle.Reviewable ? (
            <Button
              variant="contained"
              color="success"
              size="small"
              onClick={() => void onApproveAll().catch(() => null)}
              disabled={isApprovingAll || approveAllComplete}
              data-testid="proposal-group-approve-all"
            >
              {isApprovingAll
                ? "Approving…"
                : approveAllComplete
                  ? "All approved"
                  : "Approve all"}
            </Button>
          ) : null}
        </Stack>
        {decisionError ? (
          <Alert severity="error" data-testid="proposal-group-decision-error">
            {decisionError.message}
          </Alert>
        ) : null}
        {decisionError ? (
          <ProposalFailureDiagnostic
            diagnostic={extractProposalApprovalFailureDiagnostic(decisionError)}
          />
        ) : null}
        {approveAllResult ? (
          <ApproveAllSummary
            result={approveAllResult}
            members={proposalGroup.members}
          />
        ) : null}
        {journeys.map((journey) =>
          isWorkItemGraphProposal(journey.proposal) ? (
            <ProposalGroupJourneyReview
              key={journey.memberId}
              group={proposalGroup}
              journey={journey}
              onApprove={onApproveMember}
              onReject={onRejectMember}
              decidingProposalIds={decidingProposalIds}
              decisionProposals={decisionProposals}
            />
          ) : null,
        )}
        {structuralGraphShape && registry.isLoading ? (
          <Box
            data-testid="proposal-group-graph-loading"
            sx={{ display: "flex", justifyContent: "center", py: 3 }}
          >
            <CircularProgress size={24} />
          </Box>
        ) : null}
        {structuralGraphShape && registry.error ? (
          <Alert
            severity="warning"
            data-testid="proposal-group-graph-unavailable"
          >
            The work-item type registry is unavailable.
          </Alert>
        ) : null}
        {groupGraph?.kind === "unavailable" ? (
          <Alert
            severity="warning"
            data-testid="proposal-group-graph-unavailable"
          >
            {groupGraph.reason}
          </Alert>
        ) : null}
        {groupGraph?.kind === "ready" && journeys.length === 0 ? (
          <Box data-testid="proposal-group-graph-preview">
            <WorkflowGraphSurface
              mode="view"
              projection={groupGraph.projection}
              createdElements={groupGraph.createdElements}
              presentationState={
                groupGraph.projection.projectedRoot.type.toUpperCase() ===
                "DIAGRAM"
                  ? "authored"
                  : "added"
              }
              organizationId={organizationId}
              projectId={projectId}
              participation={null}
              disableLinks
              allowFullscreen
            />
          </Box>
        ) : null}
        {proposalGroup.members.map((member) => (
          <ProposalGroupMemberReview
            key={member.memberId}
            member={member}
            members={proposalGroup.members}
            content={
              journeys.some(({ memberId }) => memberId === member.memberId) &&
              isWorkItemGraphProposal(member.proposal) ? (
                groupGraph?.kind === "ready" ? (
                  <WorkItemGraphChangeSummary
                    operations={member.proposal.updates.operations}
                    projection={groupGraph.projection}
                  />
                ) : (
                  <Alert severity="info">
                    The frozen journey preview is unavailable.
                  </Alert>
                )
              ) : undefined
            }
            organizationId={organizationId}
            projectId={projectId}
            onApprove={onApproveMember}
            onReject={onRejectMember}
            isDeciding={decidingProposalIds.has(member.proposal.id)}
            decisionProposal={decisionProposals.get(member.proposal.id)}
            decisionOverride={decisionFromApproveAllOutcome(
              approveAllResult?.results.find(
                ({ memberId }) => memberId === member.memberId,
              )?.outcome,
            )}
          />
        ))}
      </Stack>
    </Paper>
  );
};

export const ProposalGroupReview: React.FC<ProposalGroupReviewProps> = ({
  organizationId,
  projectId,
  groupId,
}) => {
  const { proposalGroup, isLoading, error, refetch } = useProposalGroup(
    organizationId,
    projectId,
    groupId,
  );
  const decisions = useProposalGroupDecisions({
    organizationId,
    projectId,
    groupId,
    refetch,
  });

  if (isLoading) {
    return (
      <Box
        data-testid="proposal-group-review-loading"
        sx={{ display: "flex", justifyContent: "center", py: 4 }}
      >
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (error || !proposalGroup) {
    return (
      <Alert severity="error" data-testid="proposal-group-review-error">
        {error?.message ?? "Proposal group not found"}
      </Alert>
    );
  }

  return (
    <ProposalGroupReviewView
      organizationId={organizationId}
      projectId={projectId}
      proposalGroup={proposalGroup}
      onApproveMember={decisions.approveMember}
      onRejectMember={decisions.rejectMember}
      onApproveAll={decisions.approveAll}
      decidingProposalIds={decisions.decidingProposalIds}
      isApprovingAll={decisions.isApprovingAll}
      approveAllResult={decisions.approveAllResult}
      decisionProposals={decisions.decisionProposals}
      decisionError={decisions.error}
    />
  );
};
