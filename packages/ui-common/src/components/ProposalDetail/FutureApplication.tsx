import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useContext, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { proposalKeys } from "../../data/collections/proposals";
import {
  Alert,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import {
  ProposalStatus,
  type FutureApplyConfirmation,
  type FutureApplyResponse,
  type FutureRevisionResponse,
  type ProposalResponseDto,
} from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import { useApplyProposalFuture } from "../../data/hooks/useApplyProposalFuture";
import { useCancelProposalFuture } from "../../data/hooks/useCancelProposalFuture";
import { ProposalReconciliationContext } from "../ProposalReconciliation/ProposalReconciliationReview";
import { FutureProposalLink } from "./FutureProposalLink";
import { FutureRevisionSteps, FutureStepDone } from "./FutureRevisionSteps";

import {
  extractProposalApprovalFailureDiagnostic,
  ProposalFailureDiagnostic,
  toProposalApprovalFailureError,
} from "../ProposalDispatchers/ProposalFailureDiagnostic";

const blockerLabels = {
  APPROVAL_REQUIRED: "The approved revision requires review.",
  PERMISSION_DENIED:
    "Application permission or approval requirements are not satisfied.",
  COMPLETION_INCOMPLETE:
    "Waiting for linked work to reach Verifying (or a linked Plan to complete). You'll be asked to apply this then.",
  BASELINE_CHANGED:
    "Current content has changed. Reviewed reconciliation is required before Apply.",
  BASELINE_UNAVAILABLE:
    "The selected baseline is unavailable. Reviewed reconciliation is required before Apply.",
  CANCELLED: "This future was cancelled.",
  APPLIED: "This future has been applied.",
  REVISION_CHANGED:
    "The approved version changed. Review the current version before applying.",
  REVIEW_CHANGED:
    "Current content changed after review. Review the refreshed preview and choose Apply again.",
} as const;

function reviewedRefinementsOf(updates: unknown): string[] | undefined {
  return (updates as { reviewedRefinementProposalIds?: string[] } | undefined)
    ?.reviewedRefinementProposalIds;
}

function sameIds(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id) => b.includes(id));
}

function isCancellationOf(updates: unknown, futureId: string): boolean {
  const candidate = updates as { operation?: string; futureId?: string };
  return candidate.operation === "CANCEL" && candidate.futureId === futureId;
}

export function FutureApplication({
  future,
  onApplied,
  approveStep,
  conditions,
  conditionCount = 0,
  onRefresh,
}: {
  future: FutureRevisionResponse;
  onApplied: () => Promise<void>;
  /**
   * When present, Apply renders as the last stage of the numbered
   * Approve / Condition / Apply list; the list's explainer replaces the
   * generic waiting-on-linked-work message.
   */
  approveStep?: ReactNode;
  /** Linked work shown in the Condition stage, beside Refresh. */
  conditions?: ReactNode;
  conditionCount?: number;
  onRefresh?: () => Promise<void>;
}) {
  const reconciliation = useContext(ProposalReconciliationContext);
  const { organizationId, projectId, id: futureId } = future;
  const [response, setResponse] = useState<FutureApplyResponse | null>(null);
  const [confirmation, setConfirmation] = useState<{
    details: FutureApplyConfirmation;
    basisVersion?: string;
  } | null>(null);
  const [invalidated, setInvalidated] = useState<string[]>([]);
  const apply = useApplyProposalFuture();
  const cancel = useCancelProposalFuture();
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const applicability = useQuery({
    queryKey: [
      "proposal-future-applicability",
      organizationId,
      projectId,
      futureId,
      future.revision,
      future.outcome,
      future.completionEligibility.eligible,
    ],
    queryFn: async () => {
      const result = await proposalsClient.getProposalFutureApplicability({
        organizationId,
        projectId,
        futureId,
      });
      if (!result.data.data)
        throw new Error("Application readiness unavailable");
      return result.data.data;
    },
    staleTime: 0,
  });
  const reviewState = reconciliation?.state;
  const reviewedBasisVersion =
    reviewState?.futureRevision === future.revision
      ? reviewState.currentBases.find(
          (basis) => basis.entityId === future.targetEntityId,
        )?.version
      : undefined;
  const submit = async (confirmed?: NonNullable<typeof confirmation>) => {
    const basisVersion = confirmed
      ? confirmed.basisVersion
      : reviewedBasisVersion;
    setConfirmation(null);
    let appliedSuccessfully = false;
    try {
      const result = await apply.mutate({
        organizationId,
        projectId,
        futureId,
        futureApplyRequest: {
          expectedRevision: confirmed?.details.revision ?? future.revision,
          ...(basisVersion ? { reviewedBasisVersion: basisVersion } : {}),
          ...(confirmed ? { confirmation: confirmed.details } : {}),
        },
      });
      setResponse(result);
      if (result.status === "CONFIRMATION_REQUIRED" && result.confirmation)
        setConfirmation({ details: result.confirmation, basisVersion });
      if (result.status === "APPLIED") {
        setInvalidated(
          confirmed?.details.refinements.map((item) => item.proposalId) ?? [],
        );
        await onApplied();
        appliedSuccessfully = true;
      }
    } catch {
      // The mutation retains the error; retry starts a fresh confirmation exchange.
    } finally {
      if (!appliedSuccessfully) await onRefresh?.();
      await applicability.refetch();
    }
  };
  // The cancellation is found by the future's own pending-proposal list, so it
  // is current after another reviewer's decision and on reopening, however many
  // other proposals the project has.
  const outstandingIds = Array.from(future.outstandingRefinementProposalIds);
  const pendingCancellation = useQuery({
    queryKey: [
      ...proposalKeys.project(organizationId, projectId),
      "future-pending-cancellation",
      futureId,
      outstandingIds.join(","),
    ],
    queryFn: async (): Promise<{ proposal: ProposalResponseDto | null }> => {
      const proposals = await Promise.all(
        outstandingIds.map(async (proposalId) => {
          const result = await proposalsClient.getProposal({
            organizationId,
            projectId,
            proposalId,
          });
          return result.data.data;
        }),
      );
      const proposal = proposals.find(
        (candidate) =>
          candidate?.status === ProposalStatus.Draft &&
          isCancellationOf(candidate.updates, futureId),
      );
      return { proposal: proposal ?? null };
    },
    enabled: future.outcome === "STAGED",
    staleTime: 0,
  });
  const pending = pendingCancellation.data?.proposal ?? null;
  const pendingRefinements = outstandingIds.filter((id) => id !== pending?.id);
  const reviewedByPending = reviewedRefinementsOf(pending?.updates);
  const cancellationStale =
    !!pending &&
    !!reviewedByPending &&
    !sameIds(reviewedByPending, pendingRefinements);
  const cancelFuture = async () => {
    setConfirmingCancel(false);
    try {
      await cancel.mutate({
        future,
        reviewedRefinementProposalIds: pendingRefinements,
        ...(cancellationStale && pending
          ? { replaceProposalId: pending.id }
          : {}),
      });
    } catch {
      // The mutation retains the error, which is shown to the reviewer.
    } finally {
      await onRefresh?.();
      await Promise.all([
        applicability.refetch(),
        pendingCancellation.refetch(),
      ]);
    }
  };
  const applied =
    response?.status === "APPLIED" || future.outcome === "APPLIED";
  const ready =
    applicability.data?.canApply &&
    applicability.data.revision === future.revision &&
    (reviewState?.futureRevision === undefined ||
      reviewState.futureRevision === future.revision) &&
    !reconciliation?.approvalDisabled;
  const stepped = approveStep !== undefined;
  const refresh = !applied && !ready && (
    <Button
      size="small"
      aria-label="Refresh linked work status"
      data-testid="future-refresh-readiness"
      disabled={applicability.isFetching}
      sx={{ flexShrink: 0 }}
      onClick={() =>
        void (async () => {
          await onRefresh?.();
          await applicability.refetch();
        })()
      }
    >
      <RefreshIcon fontSize="small" sx={{ mr: 0.5 }} />
      {stepped && conditionCount > 0 ? "Refresh" : "Refresh linked work"}
    </Button>
  );
  const cancelAwaitingApproval = !!pending && !cancellationStale;
  const cancelLookupUnavailable = pendingCancellation.isError;
  const cancelAction = future.outcome === "STAGED" && !applied && (
    <Button
      size="small"
      color="inherit"
      sx={{ flexShrink: 0, color: "text.secondary" }}
      data-testid="future-cancel"
      disabled={
        cancel.isPending ||
        pendingCancellation.isPending ||
        cancelLookupUnavailable ||
        cancelAwaitingApproval
      }
      onClick={() => setConfirmingCancel(true)}
    >
      {cancellationStale ? "Replace cancellation" : "Cancel future"}
    </Button>
  );
  const applyAction = applied ? (
    <FutureStepDone>Applied</FutureStepDone>
  ) : (
    <>
      <Button
        variant="contained"
        color="success"
        size="small"
        sx={{ flexShrink: 0 }}
        data-testid="future-apply"
        disabled={!ready || apply.isPending || applicability.isFetching}
        onClick={() => void submit()}
      >
        {apply.isPending ? "Applying…" : "Apply"}
      </Button>
      {cancelAction}
      {reconciliation?.staged && (
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="future-readiness"
        >
          {applicability.isPending
            ? "Checking readiness…"
            : ready
              ? "Ready to apply"
              : applicability.data?.blockers.includes("COMPLETION_INCOMPLETE")
                ? "Waiting for linked work"
                : "Not ready to apply"}
        </Typography>
      )}
    </>
  );
  return (
    <Stack spacing={1} data-testid="future-application">
      {stepped ? (
        <FutureRevisionSteps
          approve={approveStep}
          conditionCount={conditionCount}
          conditions={
            <>
              {conditions}
              {refresh}
            </>
          }
          apply={applyAction}
        />
      ) : (
        <Stack direction="row" spacing={1} alignItems="center">
          {applyAction}
        </Stack>
      )}
      {!applied && (
        <>
          {(!stepped || conditionCount === 0) && refresh && (
            <span>{refresh}</span>
          )}
          {applicability.isPending && (
            <Typography variant="body2">
              Checking whether this can be applied…
            </Typography>
          )}
          {applicability.error && (
            <Alert severity="error">{applicability.error.message}</Alert>
          )}
          {applicability.data?.blockers.map((blocker) =>
            blocker === "COMPLETION_INCOMPLETE" ? (
              stepped ? null : (
                <Typography
                  key={blocker}
                  variant="body2"
                  color="text.secondary"
                  data-testid="future-waiting"
                >
                  {blockerLabels[blocker]}
                </Typography>
              )
            ) : reconciliation?.staged &&
              (blocker === "BASELINE_CHANGED" ||
                blocker === "BASELINE_UNAVAILABLE") ? null : (
              <Alert key={blocker} severity="warning">
                {blockerLabels[blocker]}
              </Alert>
            ),
          )}
          {ready && !stepped && !reconciliation?.staged && (
            <Typography variant="body2" color="text.secondary">
              The linked work is done. Apply when you're ready.
            </Typography>
          )}
        </>
      )}
      {cancelLookupUnavailable && (
        <Alert
          severity="error"
          data-testid="future-cancel-lookup-failed"
          action={
            <Button onClick={() => void pendingCancellation.refetch()}>
              Retry
            </Button>
          }
        >
          Could not check whether a cancellation is already pending.
        </Alert>
      )}
      {cancellationStale && (
        <Alert severity="warning" data-testid="future-cancel-stale">
          The pending revisions changed after this cancellation was requested,
          so it can no longer be approved. Review the current list and replace
          it.
        </Alert>
      )}
      {cancelAwaitingApproval && (
        <Alert severity="info" data-testid="future-cancel-pending">
          Your approval was recorded, but this project needs more approvals
          before the cancellation takes effect. The future stays approved and
          can still be applied until then.
        </Alert>
      )}
      {cancel.error && (
        <Alert severity="error">
          {
            toProposalApprovalFailureError(cancel.error, "Cancellation failed")
              .message
          }{" "}
          Refresh before trying again.
        </Alert>
      )}
      {response?.blocker && (
        <Alert severity="warning">{blockerLabels[response.blocker]}</Alert>
      )}
      {apply.error && !applied && (
        <Stack spacing={1}>
          <Alert severity="error">
            {
              toProposalApprovalFailureError(apply.error, "Application failed")
                .message
            }{" "}
            Refresh before retrying Apply.
          </Alert>
          <ProposalFailureDiagnostic
            diagnostic={extractProposalApprovalFailureDiagnostic(apply.error)}
          />
        </Stack>
      )}
      {invalidated.length > 0 && (
        <Stack spacing={1}>
          <Typography>Invalidated pending revisions</Typography>
          {invalidated.map((proposalId) => (
            <FutureProposalLink
              key={proposalId}
              {...{ organizationId, projectId, proposalId }}
            />
          ))}
        </Stack>
      )}
      <Dialog
        open={confirmingCancel}
        onClose={() => setConfirmingCancel(false)}
      >
        <DialogTitle>Cancel this approved change?</DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            <Typography>
              Live content will not change, and this future can no longer be
              applied. It leaves every Ready to apply list.
            </Typography>
            {pendingRefinements.length > 0 && (
              <>
                <Typography data-testid="future-cancel-refinements">
                  Once the cancellation is approved, these pending revisions
                  will be rejected:
                </Typography>
                {pendingRefinements.map((proposalId) => (
                  <FutureProposalLink
                    key={proposalId}
                    {...{ organizationId, projectId, proposalId }}
                  />
                ))}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            data-testid="future-cancel-decline"
            onClick={() => setConfirmingCancel(false)}
          >
            Keep future
          </Button>
          <Button
            color="error"
            data-testid="future-cancel-confirm"
            disabled={cancel.isPending}
            onClick={() => void cancelFuture()}
          >
            Cancel future
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={confirmation !== null}
        onClose={() => setConfirmation(null)}
      >
        <DialogTitle>
          Apply the currently approved version? Pending revisions will be
          invalidated.
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            <Typography>
              Approved version {confirmation?.details.revision}
            </Typography>
            {confirmation?.details.refinements.map((item) => (
              <Stack key={item.proposalId}>
                <FutureProposalLink
                  {...{ organizationId, projectId }}
                  proposalId={item.proposalId}
                />
                <Typography variant="caption">
                  Revision updated {new Date(item.updatedAt).toLocaleString()}
                </Typography>
              </Stack>
            ))}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button
            data-testid="future-apply-cancel"
            onClick={() => setConfirmation(null)}
          >
            Cancel
          </Button>
          <Button
            data-testid="future-apply-confirm"
            disabled={
              apply.isPending ||
              !confirmation ||
              !ready ||
              applicability.isFetching
            }
            onClick={() => confirmation && void submit(confirmation)}
          >
            Apply approved version
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
}
