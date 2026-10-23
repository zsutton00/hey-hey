import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Stack, Typography } from "@mui/material";
import {
  ProposalAction,
  type FutureCompletionDependency,
  type FutureRevisionMutation,
  type ProposalResponseDto,
} from "../../api";
import { useProposal } from "../../data/hooks/useProposal";
import { unifiedApiClient } from "../../clients/serviceClients";
import { useProposalState } from "../ProposalDispatchers/useProposalState";
import { ProposalStateIndicator } from "../ProposalDispatchers/ProposalStateIndicator";
import { getApprovalProgress } from "../../permissions";
import { FutureContentComparison } from "./FutureContentComparison";
import { FutureApplication } from "./FutureApplication";
import { FutureDependency } from "./FutureDependency";
import { FutureProposalLink } from "./FutureProposalLink";

// VERSIONED_UPDATE is the API-owned discriminator for FutureRevisionMutation.
function isFutureProposal(
  proposal: ProposalResponseDto,
): proposal is ProposalResponseDto & { updates: FutureRevisionMutation } {
  return proposal.action === ProposalAction.VersionedUpdate;
}

function compareDependencies(
  proposedDependencies: Iterable<FutureCompletionDependency>,
  approvedDependencies: Iterable<FutureCompletionDependency>,
) {
  const proposed = Array.from(proposedDependencies);
  const approved = Array.from(approvedDependencies);
  const proposedIds = new Set(
    proposed.map((dependency) => dependency.targetEntityId),
  );
  const approvedIds = new Set(
    approved.map((dependency) => dependency.targetEntityId),
  );

  return {
    added: proposed.filter(
      (dependency) => !approvedIds.has(dependency.targetEntityId),
    ),
    removed: approved.filter(
      (dependency) => !proposedIds.has(dependency.targetEntityId),
    ),
  };
}

export function FutureProposalReview({
  proposal: initial,
  onApprove,
  onReject,
  disabled = false,
  onApplied,
  renderMode = "standalone",
}: {
  proposal: ProposalResponseDto;
  onApprove: (id: string) => Promise<unknown>;
  onReject: ((id: string, reason: string) => Promise<unknown>) | undefined;
  disabled?: boolean;
  onApplied?: (id: string) => Promise<void> | void;
  renderMode?: "standalone" | "group-member";
}) {
  const { organizationId, projectId } = initial;
  const { proposal, isLoading, error, refetch } = useProposal(
    organizationId,
    projectId,
    initial.id,
  );
  const proposals = useMemo(() => [proposal ?? initial], [proposal, initial]);
  const state = useProposalState(proposals);
  const live = useQuery({
    queryKey: [
      "future-review-current",
      organizationId,
      projectId,
      initial.targetEntityType,
      initial.targetEntityId,
    ],
    queryFn: async () => {
      const result =
        initial.targetEntityType === "TASK"
          ? await unifiedApiClient.getTask({
              organizationId,
              projectId,
              taskId: initial.targetEntityId,
            })
          : await unifiedApiClient.getDesignDoc({
              organizationId,
              designDocId: initial.targetEntityId,
            });
      if (!result.data.data) throw new Error("Current content unavailable");
      return result.data.data;
    },
    staleTime: 0,
  });
  if ((!proposal && isLoading) || live.isPending)
    return <Typography>Loading future review…</Typography>;
  if (error || live.error || !proposal)
    return (
      <Alert severity="error">
        {error?.message ?? live.error?.message ?? "Future review unavailable"}
      </Alert>
    );
  if (!isFutureProposal(proposal))
    return (
      <Alert severity="error">
        Future review requires a versioned proposal.
      </Alert>
    );
  const current = live.data;
  if (!current?.sections)
    return <Alert severity="error">Complete current content unavailable</Alert>;
  const currentContent =
    "type" in current
      ? { ...current, sections: current.sections }
      : { ...current, sections: current.sections };
  const future = proposal.reviewedFuture;
  const updates = proposal.updates;
  const pendingDependencyChanges =
    proposal.status !== "APPROVED" && updates.operation === "REVISE"
      ? compareDependencies(updates.dependencies, future?.dependencies ?? [])
      : undefined;
  const approve = async (id: string) => {
    await onApprove(id);
    await refetch();
  };
  const reject = async (id: string, reason: string) => {
    await onReject?.(id, reason);
    await refetch();
  };
  return (
    <Stack
      spacing={2}
      data-testid="future-proposal-review"
      data-future-id={updates.futureId}
    >
      {future && (
        <>
          <Typography variant="h6">
            {future.outcome === "APPLIED" ? "Applied" : "Approved future"} ·
            Version {future.revision}
          </Typography>
          <Typography>
            Current content compared with the complete approved result
          </Typography>
          <FutureContentComparison
            current={currentContent}
            result={future.result}
          />
          <Typography variant="subtitle2">Completion dependencies</Typography>
          {future.dependencies.length === 0 && (
            <Typography>No completion dependencies</Typography>
          )}
          {future.dependencies.map((dependency) => (
            <FutureDependency
              key={dependency.targetEntityId}
              {...{ organizationId, projectId }}
              taskId={dependency.targetEntityId}
              blocker={future.completionEligibility.blockers.find(
                (item) =>
                  item.dependency.targetEntityId === dependency.targetEntityId,
              )}
            />
          ))}
          <FutureApplication
            key={future.id}
            future={future}
            reconciliationProposal={proposal}
            onApplied={async () => {
              await Promise.all([refetch(), live.refetch()]);
              await onApplied?.(proposal.id);
            }}
          />
          {Array.from(future.outstandingRefinementProposalIds).length > 0 && (
            <Stack spacing={1}>
              <Typography variant="subtitle2">
                Pending refinements — approved content remains unchanged until
                review
              </Typography>
              {Array.from(future.outstandingRefinementProposalIds).map(
                (proposalId) => (
                  <FutureProposalLink
                    key={proposalId}
                    {...{ organizationId, projectId, proposalId }}
                  />
                ),
              )}
            </Stack>
          )}
        </>
      )}
      {proposal.status !== "APPROVED" && (
        <>
          <Typography variant="h6">
            {proposal.status === "REJECTED"
              ? "Rejected revision"
              : "Proposed revision"}
          </Typography>
          {updates.operation === "CANCEL" ? (
            <Alert severity="info">Proposes cancelling this future.</Alert>
          ) : (
            <FutureContentComparison
              current={future?.result ?? currentContent}
              result={updates.result}
            />
          )}
          {pendingDependencyChanges && (
            <Stack spacing={1} data-testid="future-dependency-changes">
              <Typography variant="subtitle2">
                Proposed dependency changes
              </Typography>
              {pendingDependencyChanges.added.length === 0 &&
              pendingDependencyChanges.removed.length === 0 ? (
                <Typography>No completion dependency changes</Typography>
              ) : (
                <>
                  {pendingDependencyChanges.added.length > 0 && (
                    <Stack spacing={1}>
                      <Typography>Added completion dependencies</Typography>
                      {pendingDependencyChanges.added.map((dependency) => (
                        <FutureDependency
                          key={`added-${dependency.targetEntityId}`}
                          {...{ organizationId, projectId }}
                          taskId={dependency.targetEntityId}
                          blocker={undefined}
                        />
                      ))}
                    </Stack>
                  )}
                  {pendingDependencyChanges.removed.length > 0 && (
                    <Stack spacing={1}>
                      <Typography>Removed completion dependencies</Typography>
                      {pendingDependencyChanges.removed.map((dependency) => (
                        <FutureDependency
                          key={`removed-${dependency.targetEntityId}`}
                          {...{ organizationId, projectId }}
                          taskId={dependency.targetEntityId}
                          blocker={undefined}
                        />
                      ))}
                    </Stack>
                  )}
                </>
              )}
            </Stack>
          )}
          <Typography>
            Approval retains this future without applying it. Rejection leaves
            the approved result unchanged.
          </Typography>
        </>
      )}
      {renderMode === "standalone" && (
        <ProposalStateIndicator
          status={state.getState(proposal.id)}
          action={ProposalAction.VersionedUpdate}
          onApply={() => state.applyItem(proposal.id, approve)}
          onReject={
            onReject
              ? (reason) => state.rejectItem(proposal.id, reject, reason)
              : undefined
          }
          disabled={disabled}
          approvalProgress={getApprovalProgress(
            proposal.requiredApprovals,
            proposal.approvals,
          )}
        />
      )}
    </Stack>
  );
}
