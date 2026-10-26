import { FunctionalDialog as Dialog } from "../Modals/FunctionalDialog";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useContext, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import type {
  FutureApplyConfirmation,
  FutureApplyResponse,
  FutureRevisionResponse,
} from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import { useApplyProposalFuture } from "../../data/hooks/useApplyProposalFuture";
import { ProposalReconciliationContext } from "../ProposalReconciliation/ProposalReconciliationReview";
import { FutureProposalLink } from "./FutureProposalLink";

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
} as const;

export function FutureApplication({
  future,
  onApplied,
  waitingNote,
  reviewSteps,
  onRefresh,
}: {
  future: FutureRevisionResponse;
  onApplied: () => Promise<void>;
  /** Replaces the generic waiting-on-linked-work message. */
  waitingNote?: ReactNode;
  /** Approval and linked work share the action row. */
  reviewSteps?: ReactNode;
  onRefresh?: () => Promise<void>;
}) {
  const reconciliation = useContext(ProposalReconciliationContext);
  const { organizationId, projectId, id: futureId } = future;
  const [response, setResponse] = useState<FutureApplyResponse | null>(null);
  const [confirmation, setConfirmation] =
    useState<FutureApplyConfirmation | null>(null);
  const [invalidated, setInvalidated] = useState<string[]>([]);
  const apply = useApplyProposalFuture();
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
  const submit = async (confirmed?: FutureApplyConfirmation) => {
    setConfirmation(null);
    let appliedSuccessfully = false;
    try {
      const result = await apply.mutate({
        organizationId,
        projectId,
        futureId,
        futureApplyRequest: {
          expectedRevision: confirmed?.revision ?? future.revision,
          ...(confirmed ? { confirmation: confirmed } : {}),
        },
      });
      setResponse(result);
      if (result.status === "CONFIRMATION_REQUIRED")
        setConfirmation(result.confirmation ?? null);
      if (result.status === "APPLIED") {
        setInvalidated(
          confirmed?.refinements.map((item) => item.proposalId) ?? [],
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
  const applied =
    response?.status === "APPLIED" || future.outcome === "APPLIED";
  const ready =
    !reconciliation?.approvalDisabled &&
    applicability.data?.canApply &&
    applicability.data.revision === future.revision;
  return (
    <Stack spacing={1} data-testid="future-application">
      {applied ? (
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          data-testid="future-review-sequence"
          sx={{
            minWidth: 0,
            flexWrap: "nowrap",
            overflow: "hidden",
            "& > :not([data-testid=future-linked-work])": { flexShrink: 0 },
          }}
        >
          {reviewSteps}
          {reviewSteps && (
            <ArrowForwardIcon fontSize="small" color="disabled" />
          )}
          <Alert severity="success">Applied</Alert>
        </Stack>
      ) : (
        <>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{
              flexWrap: reconciliation?.staged ? "wrap" : "nowrap",
              minWidth: 0,
              overflow: "hidden",
              "& > :not([data-testid=future-linked-work])": { flexShrink: 0 },
            }}
            data-testid="future-review-sequence"
          >
            {reviewSteps}
            {reviewSteps && (
              <ArrowForwardIcon fontSize="small" color="disabled" />
            )}
            {reconciliation?.staged ? (
              <Typography
                variant="body2"
                color="text.secondary"
                data-testid="future-readiness"
              >
                {applicability.isPending
                  ? "Checking readiness…"
                  : ready
                    ? "Ready to apply"
                    : applicability.data?.blockers.includes(
                          "COMPLETION_INCOMPLETE",
                        )
                      ? "Waiting for linked work"
                      : "Not ready to apply"}
              </Typography>
            ) : null}
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
          </Stack>
          {!ready && (
            <span>
              <Button
                size="small"
                aria-label="Refresh linked work status"
                data-testid="future-refresh-readiness"
                disabled={applicability.isFetching}
                onClick={() =>
                  void (async () => {
                    await onRefresh?.();
                    await applicability.refetch();
                  })()
                }
              >
                <RefreshIcon fontSize="small" sx={{ mr: 0.5 }} /> Refresh linked
                work
              </Button>
            </span>
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
              <Typography
                key={blocker}
                variant="body2"
                color="text.secondary"
                data-testid="future-waiting"
              >
                {waitingNote ?? blockerLabels[blocker]}
              </Typography>
            ) : reconciliation?.staged &&
              (blocker === "BASELINE_CHANGED" ||
                blocker === "BASELINE_UNAVAILABLE") ? null : (
              <Alert key={blocker} severity="warning">
                {blockerLabels[blocker]}
              </Alert>
            ),
          )}
          {ready && !reconciliation?.staged && (
            <Typography variant="body2" color="text.secondary">
              The linked work is done. Apply when you're ready.
            </Typography>
          )}
        </>
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
        open={confirmation !== null}
        onClose={() => setConfirmation(null)}
      >
        <DialogTitle>
          Apply the currently approved version? Pending revisions will be
          invalidated.
        </DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            <Typography>Approved version {confirmation?.revision}</Typography>
            {confirmation?.refinements.map((item) => (
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
