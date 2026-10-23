import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import type {
  ProposalResponseDto,
  FutureApplyConfirmation,
  FutureApplyResponse,
  FutureRevisionResponse,
} from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import { useApplyProposalFuture } from "../../data/hooks/useApplyProposalFuture";
import { FutureProposalLink } from "./FutureProposalLink";
import { ProposalReconciliationReview } from "../ProposalReconciliation/ProposalReconciliationReview";
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
    "Linked work must reach verification (Plans: completion) before applying.",
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
  reconciliationProposal,
}: {
  future: FutureRevisionResponse;
  onApplied: () => Promise<void>;
  reconciliationProposal?: ProposalResponseDto;
}) {
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
      }
    } catch {
      // The mutation retains the error; retry starts a fresh confirmation exchange.
    } finally {
      await applicability.refetch();
    }
  };
  const applied =
    response?.status === "APPLIED" || future.outcome === "APPLIED";
  const reconciliationRequired =
    applicability.data?.blockers.includes("BASELINE_CHANGED") ||
    response?.blocker === "BASELINE_CHANGED";
  const ready =
    applicability.data?.canApply &&
    applicability.data.revision === future.revision;
  return (
    <Stack spacing={1} data-testid="future-application">
      {applied ? (
        <Alert severity="success">
          Applied version{" "}
          {response?.future.appliedRevision ?? future.appliedRevision}
        </Alert>
      ) : (
        <>
          {applicability.isPending && (
            <Typography>Checking application readiness…</Typography>
          )}
          {applicability.error && (
            <Alert severity="error">{applicability.error.message}</Alert>
          )}
          {!ready && (
            <Button
              data-testid="future-refresh-readiness"
              disabled={applicability.isFetching}
              onClick={() => void applicability.refetch()}
            >
              Refresh readiness
            </Button>
          )}
          {applicability.data?.blockers.map((blocker) => (
            <Alert key={blocker} severity="warning">
              {blockerLabels[blocker]}
            </Alert>
          ))}
          {ready && (
            <Alert severity="info">
              Ready, not applied. Applying requires an explicit action.
            </Alert>
          )}
          <Button
            data-testid="future-apply"
            disabled={!ready || apply.isPending || applicability.isFetching}
            onClick={() => void submit()}
          >
            {" "}
            {apply.isPending ? "Applying…" : "Apply"}
          </Button>
        </>
      )}
      {response?.blocker && (
        <Alert severity="warning">{blockerLabels[response.blocker]}</Alert>
      )}
      {reconciliationRequired && reconciliationProposal && (
        <ProposalReconciliationReview
          proposal={reconciliationProposal}
          onApply={() => undefined}
        >
          {null}
        </ProposalReconciliationReview>
      )}
      {apply.error && !applied && (
        <Stack spacing={1}>
          <Alert severity="error">
            {
              toProposalApprovalFailureError(apply.error, "Application failed")
                .message
            }{" "}
            Refresh readiness before retrying Apply.
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
