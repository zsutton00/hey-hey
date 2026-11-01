import { useCallback, useEffect, useState } from "react";
import { Alert, Button, Stack } from "@mui/material";
import type {
  ProposalReconciliationSuggestion,
  ProposalReconciliationState,
} from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import { ReconciliationFieldComparison } from "./ReconciliationFieldComparison";
import {
  normalizeReconciliationContent,
  threeWayFields,
  threeWayValue,
} from "./threeWayProjection";
import {
  reconciliationFieldLabel,
  type ReconciliationPresentation,
} from "./reconciliationPresentation";
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
import { Typography } from "@mui/material";
import { useInvalidateProposalReview } from "../../data/hooks/useInvalidateProposalReview";
import {
  invalidateProposalReconciliation,
  subscribeProposalReconciliation,
} from "./reconciliationInvalidation";

/** Suggestion decisions never enter proposal-approval aggregation. */
export function ProposalSuggestionReview({
  suggestion,
}: {
  suggestion: ProposalReconciliationSuggestion;
}) {
  const [state, setState] = useState<ProposalReconciliationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const invalidate = useInvalidateProposalReview();
  const { organizationId, projectId, proposalId } = suggestion;
  const { workItemTypes, isLoading: loadingTypes } = useWorkItemTypes(
    organizationId,
    { projectId },
  );
  const refresh = useCallback(async () => {
    const response = await proposalsClient.getProposalReconciliation({
      organizationId,
      projectId,
      proposalId,
    });
    setState(response.data.data);
  }, [organizationId, projectId, proposalId]);
  useEffect(() => {
    const read = () => {
      void refresh().catch((cause) =>
        setError(
          cause instanceof Error
            ? cause.message
            : "Cannot load the saved suggestion.",
        ),
      );
    };
    read();
    return subscribeProposalReconciliation(proposalId, read);
  }, [proposalId, refresh, suggestion.status]);
  useEffect(() => {
    if (suggestion.status === "ACCEPTED") {
      invalidateProposalReconciliation(proposalId);
      void invalidate(organizationId, projectId);
    }
  }, [suggestion.status, proposalId, organizationId, projectId, invalidate]);
  const current = state?.suggestions?.find((item) => item.id === suggestion.id);
  const original = state?.revisions.find(
    (revision) => revision.id === suggestion.candidateRevisionId,
  );
  const before = original
    ? normalizeReconciliationContent(original.proposedResult)
    : undefined;
  const after = normalizeReconciliationContent(suggestion.proposedResult);
  const definition = workItemTypes.find(
    (item) => item.definition.key === after.type,
  )?.definition;
  const presentation: ReconciliationPresentation =
    typeof after.type === "string"
      ? { kind: "work-item", definition }
      : { kind: "design-doc" };
  const comparisonAvailable =
    !!original &&
    !loadingTypes &&
    (presentation.kind === "design-doc" || !!definition);
  const fields = threeWayFields({
    original: before,
    live: before,
    intended: after,
  });
  const decide = async (method: "ACCEPT_SUGGESTION" | "REJECT_SUGGESTION") => {
    setBusy(true);
    setError(null);
    try {
      const response =
        await proposalsClient.createProposalReconciliationCandidate({
          organizationId,
          projectId,
          proposalId,
          createProposalReconciliationCandidate: {
            method,
            suggestionId: suggestion.id,
          },
        });
      setState(response.data.data);
      invalidateProposalReconciliation(proposalId);
      await invalidate(organizationId, projectId);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "The suggestion could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Stack spacing={2} data-testid="proposal-suggestion-review">
      {error && <Alert severity="error">{error}</Alert>}
      {comparisonAvailable ? (
        fields.map((path) => (
          <Stack key={path} spacing={1}>
            <Typography variant="subtitle2">
              {reconciliationFieldLabel(path, presentation)}
            </Typography>
            <ReconciliationFieldComparison
              path={path}
              before={threeWayValue(before, path)}
              after={threeWayValue(after, path)}
              presentation={presentation}
              labels={{
                before: "Proposal before this suggestion",
                after: "Suggested content",
              }}
            />
          </Stack>
        ))
      ) : (
        <Alert severity="info">
          The complete comparison is unavailable; acceptance is disabled.
        </Alert>
      )}
      {current?.status === "PENDING" ? (
        <>
          <Alert severity="warning">
            Accept replaces the proposal’s current content and clears its
            approvals. Live content will not change. Accept is not approval.
          </Alert>
          <Stack direction="row" spacing={1}>
            <Button
              data-testid="proposal-suggestion-accept"
              disabled={busy || !comparisonAvailable}
              onClick={() => void decide("ACCEPT_SUGGESTION")}
            >
              Accept
            </Button>
            <Button
              data-testid="proposal-suggestion-reject"
              disabled={busy}
              onClick={() => void decide("REJECT_SUGGESTION")}
            >
              Reject
            </Button>
          </Stack>
        </>
      ) : current ? (
        <Alert severity="info">
          {current.status === "ACCEPTED"
            ? "Proposal updated. Fresh approvals are required."
            : current.status === "REJECTED"
              ? "Suggestion rejected. The proposal is unchanged."
              : "This suggestion is out of date or superseded. Prepare a new suggestion to continue."}
        </Alert>
      ) : null}
    </Stack>
  );
}
