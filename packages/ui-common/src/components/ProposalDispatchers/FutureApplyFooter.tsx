import { Alert, Button, Stack, Typography } from "@mui/material";
import { useContext, type ReactNode } from "react";
import type {
  FutureDependencyPresentation,
  ProposalResponseDto,
} from "../../api";
import { useProposal } from "../../data/hooks/useProposal";
import { MentionCopyBoundary } from "../shared/MentionCopyBoundary";
import { invalidateProposalReconciliation } from "../ProposalReconciliation/reconciliationInvalidation";
import { ProposalReconciliationContext } from "../ProposalReconciliation/ProposalReconciliationReview";
import { FutureApplication } from "../ProposalDetail/FutureApplication";
import { FutureDependency } from "../ProposalDetail/FutureDependency";
import {
  FutureRevisionSteps,
  FutureStepDone,
} from "../ProposalDetail/FutureRevisionSteps";

/** Linked work stays on one line; each mention truncates, never scrolls. */
function LinkedWork({
  organizationId,
  projectId,
  linked,
  showStatus,
}: {
  organizationId: string;
  projectId: string;
  linked: readonly FutureDependencyPresentation[];
  showStatus: boolean;
}) {
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        minWidth: 0,
        flex: "0 1 auto",
        overflow: "hidden",
        "& > *": { flex: "0 1 auto", minWidth: 0 },
      }}
      data-testid="future-linked-work"
    >
      {linked.map((dependency) => (
        <FutureDependency
          key={dependency.targetEntityId}
          {...{ organizationId, projectId, dependency, showStatus }}
        />
      ))}
    </Stack>
  );
}

/**
 * A future revision's footer: the numbered Approve / Condition / Apply list,
 * shown in every state. Before approval, `approveControl` (the ordinary Approve/Reject) fills
 * the first step, linked work is a preview from the proposal (no status
 * checks) and Apply is disabled. After approval, linked work shows live status
 * and Apply follows the API (completion eligibility and applicability); this
 * footer never infers readiness.
 */
interface FutureApplyFooterProps {
  proposal: ProposalResponseDto;
  onApplied?: (id: string) => Promise<void> | void;
  /** Present until approval; replaces the Approved step. */
  approveControl?: ReactNode;
}

export function FutureApplyFooter(props: FutureApplyFooterProps) {
  return (
    <MentionCopyBoundary>
      <FutureApplyFooterContent {...props} />
    </MentionCopyBoundary>
  );
}

function FutureApplyFooterContent({
  proposal: initial,
  onApplied,
  approveControl,
}: FutureApplyFooterProps) {
  const reconciliation = useContext(ProposalReconciliationContext);
  const { organizationId, projectId } = initial;
  const { proposal, refetch, isReady, error } = useProposal(
    organizationId,
    projectId,
    initial.id,
  );
  const current = proposal ?? initial;
  const linkedWorkUnavailable = (
    <Alert
      severity="error"
      data-testid="future-linked-work-unavailable"
      action={<Button onClick={() => void refetch()}>Refresh</Button>}
    >
      Linked work details are unavailable. Refresh before reviewing or applying
      this future.
    </Alert>
  );
  if (approveControl && current.status !== "APPROVED") {
    const previous = current.reviewedFuture;
    const linked = previous
      ? previous.dependencyPresentation
      : current.dependencyPresentation;
    if (!linked) return linkedWorkUnavailable;
    return (
      <Stack spacing={1} data-testid="future-apply-footer" data-state="preview">
        <FutureRevisionSteps
          approve={
            previous && !reconciliation?.staged ? (
              <FutureStepDone>Approved</FutureStepDone>
            ) : (
              approveControl
            )
          }
          conditionCount={linked.length}
          conditions={
            <LinkedWork
              {...{ organizationId, projectId, linked }}
              showStatus={!!previous}
            />
          }
          apply={
            <Button
              size="small"
              variant="contained"
              color="success"
              disabled
              data-testid="future-apply"
            >
              Apply
            </Button>
          }
        />
        {previous && !reconciliation?.staged && approveControl}
        {previous ? (
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid="future-waiting"
          >
            Review this revised result. Approval stores the same future and
            leaves live content unchanged; then choose Apply separately.
          </Typography>
        ) : (
          linked.length === 0 && (
            <Typography
              variant="body2"
              color="text.secondary"
              data-testid="future-waiting"
            >
              Once approved, you can apply this change.
            </Typography>
          )
        )}
      </Stack>
    );
  }
  const future = current.reviewedFuture;
  if (!future && (isReady || error))
    return (
      <Alert
        severity="error"
        action={<Button onClick={() => void refetch()}>Refresh</Button>}
      >
        The approved future is unavailable. Refresh before reviewing or applying
        it.
      </Alert>
    );
  if (!future)
    return (
      <Typography variant="body2" color="text.secondary">
        Approved. Loading linked work…
      </Typography>
    );
  if (future.outcome === "CANCELLED")
    return <Alert severity="info">This approved change was cancelled.</Alert>;

  // Required response data can be absent when the running API violates its
  // contract. Keep that failure local; absence never means no dependencies.
  const linked = future.dependencyPresentation;
  if (!linked) return linkedWorkUnavailable;

  return (
    <Stack spacing={1} data-testid="future-apply-footer">
      <FutureApplication
        key={future.id}
        future={future}
        onRefresh={async () => {
          invalidateProposalReconciliation(initial.id);
          await refetch();
        }}
        approveStep={
          reconciliation?.staged ? null : (
            <FutureStepDone>Approved</FutureStepDone>
          )
        }
        conditionCount={linked.length}
        conditions={
          <LinkedWork {...{ organizationId, projectId, linked }} showStatus />
        }
        onApplied={async () => {
          await refetch();
          await onApplied?.(current.id);
        }}
      />
    </Stack>
  );
}
