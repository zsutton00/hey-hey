import { DiffLabelsContext } from "../SuggestedContent/DiffRenderer";
import {
  EditOutlined,
  HelpOutlineOutlined,
  SmartToyOutlined,
} from "@mui/icons-material";
import { ConversationCard } from "../Conversation/Card";
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
  Chip,
  CircularProgress,
  Link,
  Stack,
  Stepper,
  Step,
  StepLabel,
  Typography,
} from "@mui/material";
import { format } from "date-fns";
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
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
import { ReconciliationFieldComparison } from "./ReconciliationFieldComparison";
import {
  reconciliationFieldLabel,
  type ReconciliationPresentation,
} from "./reconciliationPresentation";

const choiceButtonSx = {
  border: "2px solid var(--card-main)",
  color: "var(--card-main)",
  "&:hover": { border: "2px solid var(--card-main)" },
};

const AgentConversationView = lazy(() =>
  import("../AgentSession/AgentConversationView").then((module) => ({
    default: module.AgentConversationView,
  })),
);

/**
 * A future whose changes and the changes applied since touch different content.
 * Nothing needs deciding; the reviewer sees what changed meanwhile and the merged result.
 */
function CleanMergeNotice({
  proposal,
  state,
}: {
  proposal: ProposalResponseDto;
  state: ProposalReconciliationState;
}) {
  const paths = usePathService();
  const registry = useWorkItemTypes(proposal.organizationId, {
    projectId: proposal.projectId,
  });
  const type = state.currentBases.find(
    (basis) => basis.entityId === proposal.targetEntityId,
  )?.content.type;
  const presentation: ReconciliationPresentation =
    proposal.targetEntityType === "DESIGN_DOC"
      ? { kind: "design-doc" }
      : {
          kind: "work-item",
          definition: registry.workItemTypes.find(
            (item) => item.definition.key === type,
          )?.definition,
        };
  return (
    <Alert severity="info" data-testid="proposal-reconciliation-clean-merge">
      <Typography variant="body2">
        Other changes were applied after this was written. They touch different
        content, so Apply keeps them and adds this change. Check that anything
        this change adds still belongs.
      </Typography>
      {state.writtenAt && (
        <Typography variant="body2">
          Written {format(new Date(state.writtenAt), "MMM d, yyyy · p")}
        </Typography>
      )}
      {state.interveningProposals.length > 0 ? (
        <Stack component="ul" spacing={0.5} sx={{ m: 0, mt: 1, pl: 2 }}>
          {state.interveningProposals.map((entry) => (
            <Box key={entry.proposalId} component="li">
              <Typography variant="body2">
                <Link
                  href={paths.proposal({
                    projectId: proposal.projectId,
                    proposalId: entry.proposalId,
                  })}
                >
                  {entry.title}
                </Link>{" "}
                · Approved{" "}
                {format(new Date(entry.approvedAt), "MMM d, yyyy · p")}
                {entry.approvedByName ? ` by ${entry.approvedByName}` : ""}
              </Typography>
              <Box component="details">
                <Typography
                  component="summary"
                  variant="body2"
                  data-testid="proposal-reconciliation-intervening-diff"
                  aria-label={`View changes in ${entry.title}`}
                  sx={{ cursor: "pointer" }}
                >
                  View changes
                </Typography>
                {entry.changes.length ? (
                  entry.changes.map(({ path, before, after }) => (
                    <Stack key={path} spacing={0.5} sx={{ py: 1 }}>
                      <Typography variant="subtitle2">
                        {reconciliationFieldLabel(path, presentation)}
                      </Typography>
                      <ReconciliationFieldComparison
                        {...{ path, before, after, presentation }}
                        labels={{
                          before: "Before approval",
                          after: "After approval",
                        }}
                      />
                    </Stack>
                  ))
                ) : (
                  <Typography variant="body2">
                    This proposal has no retained comparison.
                  </Typography>
                )}
              </Box>
            </Box>
          ))}
        </Stack>
      ) : null}
    </Alert>
  );
}

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
  const agentPanelRef = useRef<HTMLDivElement | null>(null);
  const startedAgentSessionId = agentRequest?.agentSessionId;
  const scope = {
    organizationId: proposal.organizationId,
    projectId: proposal.projectId,
    proposalId: proposal.id,
  };
  // Once per launch, bring the proposal's own conversation panel into view:
  // the launch button sits low on the page while the panel is at the top. The
  // page, not the conversation viewer, owns this movement.
  useEffect(() => {
    if (!startedAgentSessionId) {
      return;
    }

    agentPanelRef.current?.scrollIntoView({ block: "start" });
  }, [startedAgentSessionId]);

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
    !state?.alreadyMatches &&
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
              {state?.mergedResult ? (
                <CleanMergeNotice proposal={proposal} state={state} />
              ) : null}
              {state?.alreadyMatches ? (
                <Alert severity="info">
                  The current content already matches this proposal.
                </Alert>
              ) : null}
              {requiresReconciliation ? (
                <ConversationCard
                  tone={{ role: "needsAnswer" }}
                  icon={<HelpOutlineOutlined fontSize="small" />}
                  kindLabel="Needs your answer"
                  chips={<Chip size="small" label="Conflict" />}
                  lead="How do you want to resolve it?"
                  data-testid="proposal-reconciliation-choices"
                  footer={{
                    content: (
                      <Stack direction="row" spacing={1} flexWrap="wrap">
                        {grouped ? (
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
                          sx={choiceButtonSx}
                        >
                          Choose sections
                        </Button>
                        <Button
                          variant="outlined"
                          startIcon={<SmartToyOutlined />}
                          data-testid="proposal-reconciliation-agent-fix"
                          disabled={busy}
                          onClick={resolve.onAgentFix}
                          sx={choiceButtonSx}
                        >
                          Work with agent
                        </Button>
                      </Stack>
                    ),
                  }}
                >
                  {state.status === "AGENT_FIX_REQUIRED" ? (
                    <Typography variant="body2" color="text.secondary">
                      This change can&apos;t be merged into the current content
                      automatically.
                    </Typography>
                  ) : null}
                  <Stack spacing={1}>
                    <Typography variant="body2">
                      <strong>Choose sections:</strong> Pick the live content or
                      the proposal for each item, and edit any item yourself.
                    </Typography>
                    <Typography variant="body2">
                      <strong>Work with agent:</strong> Opens an agent
                      conversation beside this comparison; its suggestions
                      arrive as diffs you accept or reject.
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Neither choice approves or applies anything.
                    </Typography>
                  </Stack>
                </ConversationCard>
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
              {state?.status === "READY_FOR_REVIEW" && !state.alreadyMatches ? (
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
            ref={agentPanelRef}
            sx={{ flex: 1, minWidth: 0 }}
            data-testid="proposal-reconciliation-agent-panel"
          >
            <Stack
              direction="row"
              justifyContent="space-between"
              alignItems="center"
            >
              <Typography variant="subtitle2">Work with agent</Typography>
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
