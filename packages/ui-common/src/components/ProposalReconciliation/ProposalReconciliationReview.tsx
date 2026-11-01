import { DiffLabelsContext } from "../SuggestedContent/DiffRenderer";
import { EditOutlined, SmartToyOutlined } from "@mui/icons-material";
import { ThreeWayReview } from "./ThreeWayReview";
import React, {
  createContext,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Stack,
  Stepper,
  Step,
  StepLabel,
  Typography,
} from "@mui/material";
import {
  ProposalStatus,
  type ProposalResponseDto,
  type ProposalAgentFixRequest,
  type ProposalReconciliationState,
} from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import { usePathService } from "../../contexts/PathServiceContext";
import type { ProposalApprovalRequest } from "../ProposalDispatchers/types";
import { subscribeProposalReconciliation } from "./reconciliationInvalidation";
import { useInvalidateProposalReview } from "../../data/hooks/useInvalidateProposalReview";
import { isFutureProposal } from "../ProposalDispatchers/futureAsUpdate";
import { ManualReconciliationEditor } from "./ManualReconciliationEditor";
import { AgentFixConfirmDialog } from "./AgentFixConfirmDialog";

const AgentConversationView = lazy(() =>
  import("../AgentSession/AgentConversationView").then((module) => ({
    default: module.AgentConversationView,
  })),
);

export const InlineReconciliationBodyContext =
  createContext<React.ReactNode>(null);

export const ProposalReconciliationContext = createContext<{
  approvalDisabled: boolean;
  state: ProposalReconciliationState | null;
  standaloneUpdate: boolean;
  future: boolean;
  staged: boolean;
  submit: () => void;
} | null>(null);

/**
 * Out-of-date review shared by standalone, grouped and future proposal surfaces.
 * Decided proposals have nothing to reconcile and render their children alone.
 */
export function ProposalReconciliationReview(props: {
  proposal: ProposalResponseDto;
  inlineBody?: boolean;
  grouped?: boolean;
  onApply: (request: ProposalApprovalRequest) => void;
  children: React.ReactNode;
}) {
  if (
    (isFutureProposal(props.proposal) &&
      props.proposal.updates.operation === "CANCEL") ||
    (props.proposal.status === ProposalStatus.Approved &&
      (props.proposal.action !== "VERSIONED_UPDATE" ||
        props.proposal.reviewedFuture?.outcome !== "STAGED")) ||
    props.proposal.status === ProposalStatus.Rejected
  )
    return <>{props.children}</>;
  return <PendingProposalReconciliationReview {...props} />;
}

function PendingProposalReconciliationReview({
  proposal,
  grouped = false,
  inlineBody = false,
  onApply,
  children,
}: {
  proposal: ProposalResponseDto;
  inlineBody?: boolean;
  grouped?: boolean;
  onApply: (request: ProposalApprovalRequest) => void;
  children: React.ReactNode;
}) {
  const paths = usePathService();
  const invalidateReview = useInvalidateProposalReview();
  const [agentFixOpen, setAgentFixOpen] = useState(false);
  const [agentRequest, setAgentRequest] =
    useState<ProposalAgentFixRequest | null>(null);
  const [manualState, setManualState] =
    useState<ProposalReconciliationState | null>(null);
  const [state, setState] = useState<ProposalReconciliationState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
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
      if (requestSequence.current === sequence) {
        const next = response.data.data;
        setState(next);
      }
    } catch (caught) {
      if (requestSequence.current === sequence)
        setError(
          caught instanceof Error
            ? caught.message
            : "Reconciliation could not be loaded.",
        );
    }
  }, [
    proposal.id,
    proposal.organizationId,
    proposal.projectId,
    proposal.action,
  ]);
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
  const staged =
    !grouped &&
    (requiresReconciliation || state?.status === "READY_FOR_REVIEW");
  const reviewOutcome = async () => {
    await invalidateReview(proposal.organizationId, proposal.projectId);
    await refresh();
  };
  const missingCandidate =
    state?.status === "READY_FOR_REVIEW" &&
    !state.revisions.some(
      (revision) => revision.id === state.candidateRevisionId,
    );
  const usesReplacement = grouped;
  const approvalDisabled =
    !state ||
    !!error ||
    busy ||
    requiresReconciliation ||
    missingCandidate ||
    (usesReplacement &&
      (!!state.replacementProposalId || !!state.replacementGroupId));
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
      void invalidateReview(proposal.organizationId, proposal.projectId);
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
  const threeWay = !!state && requiresReconciliation;
  const resolve = {
    onEdit: () => setManualState(state),
    onAgentFix: () => setAgentFixOpen(true),
    busy,
  };
  const comparison = (
    <InlineReconciliationBodyContext.Provider value={null}>
      {children}
    </InlineReconciliationBodyContext.Provider>
  );
  const body = (
    <Stack spacing={1} data-testid="proposal-reconciliation-review">
      {saved && state && (
        <Alert severity={requiresReconciliation ? "warning" : "success"}>
          {requiresReconciliation
            ? `Proposal updated; conflicts remain: ${state.conflictingPaths.join(", ")}`
            : "Proposal updated; reconciliation resolved."}{" "}
          Fresh approvals are required. Live content is unchanged.
        </Alert>
      )}
      {!manualState && staged ? (
        <Stepper
          activeStep={approvalDisabled ? 0 : 1}
          data-testid="proposal-reconciliation-stages"
        >
          <Step>
            <StepLabel>Resolve conflict</StepLabel>
          </Step>
          <Step>
            <StepLabel>Apply</StepLabel>
          </Step>
        </Stepper>
      ) : null}
      <Box
        sx={{
          display: "flex",
          flexDirection: { xs: "column", lg: "row" },
          gap: 2,
          minWidth: 0,
        }}
      >
        <Stack spacing={1} sx={{ flex: 1, minWidth: 0 }}>
          {manualState ? (
            <ManualReconciliationEditor
              proposal={proposal}
              state={manualState}
              busy={busy}
              error={error}
              onClose={() => setManualState(null)}
              onSave={(result) => {
                setBusy(true);
                setError(null);
                void proposalsClient
                  .createProposalReconciliationCandidate({
                    ...scope,
                    createProposalReconciliationCandidate: {
                      method: "MANUAL",
                      expectedFutureRevision: manualState.futureRevision,
                      expectedCandidateRevisionId:
                        manualState.candidateRevisionId,
                      proposedResult: result,
                      expectedCurrentBases: manualState.currentBases,
                    },
                  })
                  .then(async (response) => {
                    setState(response.data.data);
                    setSaved(true);
                    setManualState(null);
                    void invalidateReview(
                      proposal.organizationId,
                      proposal.projectId,
                    );
                  })
                  .catch(async (caught) => {
                    setError(
                      caught instanceof Error
                        ? caught.message
                        : "The result could not be prepared. Refresh and try again.",
                    );
                  })
                  .finally(() => setBusy(false));
              }}
            />
          ) : (
            <>
              {!state && !error ? (
                <CircularProgress
                  size={18}
                  aria-label="Checking current content"
                />
              ) : null}
              {error ? (
                <Alert
                  severity="error"
                  action={
                    <Button onClick={() => void refresh()}>Refresh</Button>
                  }
                >
                  {error}
                </Alert>
              ) : null}
              {threeWay ? (
                <ThreeWayReview proposal={proposal} state={state} />
              ) : null}
              {requiresReconciliation ? (
                <Stack spacing={1}>
                  {state.status === "AGENT_FIX_REQUIRED" ? (
                    <Typography variant="body2" color="text.secondary">
                      This change can&apos;t be merged into the current content
                      automatically.
                    </Typography>
                  ) : null}
                  <Stack direction="row" spacing={1}>
                    {grouped || proposal.action === "VERSIONED_UPDATE" ? (
                      <Button
                        variant="contained"
                        data-testid="proposal-reconciliation-merge"
                        disabled={
                          busy ||
                          state.status === "AGENT_FIX_REQUIRED" ||
                          state.overlaps.length > 0
                        }
                        onClick={() => void merge()}
                      >
                        Merge with current content
                      </Button>
                    ) : null}
                    <Button
                      variant="outlined"
                      startIcon={<EditOutlined />}
                      data-testid="proposal-reconciliation-edit-by-hand"
                      disabled={busy || !state.currentBases.length}
                      onClick={resolve.onEdit}
                    >
                      Edit by hand
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<SmartToyOutlined />}
                      data-testid="proposal-reconciliation-agent-fix"
                      disabled={busy}
                      onClick={resolve.onAgentFix}
                    >
                      Agent fix
                    </Button>
                  </Stack>
                </Stack>
              ) : null}
              {agentFixOpen ? (
                <AgentFixConfirmDialog
                  proposal={proposal}
                  onClose={() => setAgentFixOpen(false)}
                  onStarted={setAgentRequest}
                />
              ) : null}
              {grouped && state?.replacementProposalId ? (
                <Button
                  variant="contained"
                  data-testid="proposal-reconciliation-open-replacement"
                  href={paths.proposal({
                    projectId: proposal.projectId,
                    proposalId: state.replacementProposalId,
                  })}
                >
                  Review revised result
                </Button>
              ) : null}
              {usesReplacement && state?.replacementGroupId ? (
                <Button
                  variant="contained"
                  href={paths.proposalGroup({
                    projectId: proposal.projectId,
                    groupId: state.replacementGroupId,
                  })}
                >
                  Review replacement group
                </Button>
              ) : null}
              {state?.status === "READY_FOR_REVIEW" ? (
                <Typography
                  variant="subtitle2"
                  data-testid="proposal-reconciliation-merged-result"
                >
                  {proposal.action === "VERSIONED_UPDATE"
                    ? "Complete revised result"
                    : "Merged result compared with current content"}
                </Typography>
              ) : null}
              {threeWay ? null : (
                <DiffLabelsContext.Provider
                  value={
                    staged
                      ? { before: "Live now", after: "After applying" }
                      : undefined
                  }
                >
                  {staged && state && !approvalDisabled ? (
                    <Typography variant="h6">
                      Review what Apply will change
                    </Typography>
                  ) : null}
                  {comparison}
                </DiffLabelsContext.Provider>
              )}
            </>
          )}
        </Stack>
        {agentRequest ? (
          <Stack
            spacing={1}
            sx={{ flex: 1, minWidth: 0 }}
            data-testid="proposal-reconciliation-agent-panel"
          >
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Typography variant="subtitle2">Agent fix</Typography>
              <Button onClick={() => setAgentRequest(null)}>
                Close conversation
              </Button>
            </Stack>
            <Suspense
              fallback={
                <CircularProgress
                  size={18}
                  aria-label="Loading agent conversation"
                />
              }
            >
              <AgentConversationView
                organizationId={agentRequest.organizationId}
                projectId={agentRequest.projectId}
                agentSessionId={agentRequest.agentSessionId}
                conversationId={agentRequest.conversationId}
                sessionResumability="resumable"
                onProposalsAccepted={() => void reviewOutcome()}
              />
            </Suspense>
          </Stack>
        ) : null}
      </Box>
    </Stack>
  );
  return (
    <ProposalReconciliationContext.Provider
      value={{
        approvalDisabled,
        submit,
        state,
        standaloneUpdate: !grouped && proposal.action === "UPDATE",
        future: proposal.action === "VERSIONED_UPDATE",
        staged,
      }}
    >
      {inlineBody && staged ? (
        <InlineReconciliationBodyContext.Provider value={body}>
          {children}
        </InlineReconciliationBodyContext.Provider>
      ) : (
        body
      )}
    </ProposalReconciliationContext.Provider>
  );
}
