import React, {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import type {
  ProposalResponseDto,
  ProposalReconciliationState,
} from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import { usePathService } from "../../contexts/PathServiceContext";
import type { ProposalApprovalRequest } from "../ProposalDispatchers/types";
import { DiffRenderer } from "../SuggestedContent/DiffRenderer";
import { subscribeProposalReconciliation } from "./reconciliationInvalidation";

export const ProposalReconciliationContext = createContext<{
  approvalDisabled: boolean;
  submit: () => void;
} | null>(null);

function CandidateComparison({
  state,
  graph,
}: {
  state: ProposalReconciliationState;
  graph: boolean;
}) {
  const revision = state.revisions.at(-1);
  const current = state.currentBases[0];
  if (!revision || !current) return null;
  return (
    <Stack spacing={1} data-testid="proposal-reconciliation-comparison">
      <Typography variant="subtitle2">
        Complete reconciled result compared with current content
      </Typography>
      <DiffRenderer
        oldContent={JSON.stringify(
          graph
            ? Object.fromEntries(
                state.currentBases.map((basis) => [
                  `${basis.entityType}:${basis.entityId}`,
                  basis.content,
                ]),
              )
            : current.content,
          null,
          2,
        )}
        newContent={JSON.stringify(revision.proposedResult, null, 2)}
        defaultViewMode="split-code"
        codeLanguage="json"
      />
      <details>
        <summary>Original content and revision history</summary>
        {state.revisions.map((item) => (
          <pre key={item.id}>
            {JSON.stringify(
              {
                source: item.source,
                baseline: item.bases,
                proposedResult: item.proposedResult,
                intent: item.intent,
              },
              null,
              2,
            )}
          </pre>
        ))}
      </details>
    </Stack>
  );
}

export function ProposalReconciliationReview({
  proposal,
  onApply,
  children,
}: {
  proposal: ProposalResponseDto;
  onApply: (request: ProposalApprovalRequest) => void;
  children: React.ReactNode;
}) {
  const paths = usePathService();
  const [state, setState] = useState<ProposalReconciliationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const requestSequence = useRef(0);
  const scope = {
    organizationId: proposal.organizationId,
    projectId: proposal.projectId,
    proposalId: proposal.id,
  };
  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setState(null);
    setError(null);
    try {
      const response = await proposalsClient.getProposalReconciliation({
        organizationId: proposal.organizationId,
        projectId: proposal.projectId,
        proposalId: proposal.id,
      });
      if (requestSequence.current === sequence) setState(response.data.data);
    } catch (caught) {
      if (requestSequence.current === sequence)
        setError(
          caught instanceof Error
            ? caught.message
            : "Reconciliation could not be loaded.",
        );
    }
  }, [proposal.id, proposal.organizationId, proposal.projectId]);
  useEffect(() => {
    void refresh();
    const unsubscribe = subscribeProposalReconciliation(
      proposal.id,
      () => void refresh(),
    );
    return () => {
      ++requestSequence.current;
      unsubscribe();
    };
  }, [refresh, proposal.id, proposal.updatedAt]);
  const requiresReconciliation =
    state?.status === "RECONCILIATION_REQUIRED" ||
    state?.status === "AGENT_FIX_REQUIRED";
  const approvalDisabled =
    !state ||
    !!error ||
    busy ||
    requiresReconciliation ||
    !!state.replacementProposalId ||
    !!state.replacementGroupId;
  const submit = () => {
    if (approvalDisabled) return;
    onApply(
      state.status === "READY_FOR_REVIEW"
        ? { reviewedReconciliationRevisionId: state.candidateRevisionId }
        : {},
    );
  };
  const merge = async () => {
    setBusy(true);
    setError(null);
    try {
      const response =
        await proposalsClient.createProposalReconciliationCandidate({
          ...scope,
          createProposalReconciliationCandidate: { method: "MERGE" },
        });
      setState(response.data.data);
    } catch (caught) {
      await refresh();
      setError(
        caught instanceof Error
          ? caught.message
          : "Reconciliation could not be prepared.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <ProposalReconciliationContext.Provider
      value={{ approvalDisabled, submit }}
    >
      <Stack spacing={1} data-testid="proposal-reconciliation-review">
        {!state && !error ? (
          <CircularProgress size={18} aria-label="Checking current content" />
        ) : null}
        {error ? (
          <Alert
            severity="error"
            action={<Button onClick={() => void refresh()}>Refresh</Button>}
          >
            {error}
          </Alert>
        ) : null}
        {requiresReconciliation ? (
          <>
            <Alert severity="warning">
              Current content has changed or the original basis is unavailable.
              Review a reconciled result before applying.
            </Alert>
            <Stack direction="row" spacing={1}>
              <Button
                data-testid="proposal-reconciliation-merge"
                disabled={busy || state.status === "AGENT_FIX_REQUIRED"}
                onClick={() => void merge()}
              >
                Merge
              </Button>
              <Button
                data-testid="proposal-reconciliation-agent-fix"
                href={paths.proposal({
                  projectId: proposal.projectId,
                  proposalId: proposal.id,
                  editing: true,
                })}
              >
                Agent fix
              </Button>
            </Stack>
          </>
        ) : null}
        {state?.status === "READY_FOR_REVIEW" ? (
          <CandidateComparison
            state={state}
            graph={"operations" in proposal.updates}
          />
        ) : null}
        {state?.replacementProposalId ? (
          <Button
            data-testid="proposal-reconciliation-open-replacement"
            href={paths.proposal({
              projectId: proposal.projectId,
              proposalId: state.replacementProposalId,
            })}
          >
            Review reconciled proposal
          </Button>
        ) : null}
        {state?.replacementGroupId ? (
          <Button
            href={paths.proposalGroup({
              projectId: proposal.projectId,
              groupId: state.replacementGroupId,
            })}
          >
            Review replacement group
          </Button>
        ) : null}
        {children}
      </Stack>
    </ProposalReconciliationContext.Provider>
  );
}
