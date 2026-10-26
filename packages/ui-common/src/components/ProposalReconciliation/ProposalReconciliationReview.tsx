import { DiffLabelsContext } from "../SuggestedContent/DiffRenderer";
import { EditOutlined, SmartToyOutlined } from "@mui/icons-material";
import { ThreeWayReview } from "./ThreeWayReview";
import { isAxiosError } from "axios";
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
  Paper,
  Stack,
  Stepper,
  Step,
  StepLabel,
  Typography,
} from "@mui/material";
import { format, formatDistanceToNow } from "date-fns";
import {
  ProposalStatus,
  type ProposalResponseDto,
  type ProposalAgentFixRequest,
  type ProposalReconciliationIntervening,
  type ProposalReconciliationOverlap,
  type ProposalReconciliationState,
} from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import { usePathService } from "../../contexts/PathServiceContext";
import type { ProposalApprovalRequest } from "../ProposalDispatchers/types";
import { ReconciliationFieldComparison } from "./ReconciliationFieldComparison";
import {
  reconciliationFieldLabel,
  type ReconciliationPresentation,
} from "./reconciliationPresentation";
import { useWorkItemTypes } from "../../data/hooks/useWorkItemTypes";
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

export const ProposalReconciliationContext = createContext<{
  approvalDisabled: boolean;
  state: ProposalReconciliationState | null;
  standaloneUpdate: boolean;
  future: boolean;
  staged: boolean;
  submit: () => void;
} | null>(null);

const OUT_OF_DATE_STATUSES = new Set<ProposalReconciliationState["status"]>([
  "RECONCILIATION_REQUIRED",
  "AGENT_FIX_REQUIRED",
  "READY_FOR_REVIEW",
]);

const ago = (iso: string) =>
  formatDistanceToNow(new Date(iso), { addSuffix: true });

type Resolve = { onEdit: () => void; onAgentFix: () => void; busy: boolean };

function OutOfDateHeadsUp({ state }: { state: ProposalReconciliationState }) {
  const count = state.interveningProposals.length;
  const written = state.writtenAt ? `Written ${ago(state.writtenAt)}` : null;
  return (
    <Alert severity="info" data-testid="proposal-reconciliation-heads-up">
      {count > 0 ? (
        <>
          {written ? `${written} · ` : null}
          {count} {count === 1 ? "change was" : "changes were"} approved on this
          item since. Check they don&apos;t change whether this should still go
          ahead.
        </>
      ) : (
        <>
          {written ? `${written}. ` : null}No other changes were approved on
          this item since, but its content no longer matches what this proposal
          was written against.
        </>
      )}
    </Alert>
  );
}

function OverlapComparison({
  overlap,
  resolve,
  presentation,
  future,
}: {
  presentation: ReconciliationPresentation;
  future: boolean;
  overlap: ProposalReconciliationOverlap;
  resolve: Resolve;
}) {
  return (
    <Stack spacing={1} data-testid="proposal-reconciliation-overlap">
      <Typography variant="subtitle2">
        Resolve overlap: {reconciliationFieldLabel(overlap.path, presentation)}
      </Typography>
      <ReconciliationFieldComparison
        labels={{
          before: "Current",
          after: future ? "Previously approved future" : "This proposal",
        }}
        path={overlap.path}
        before={overlap.currentValue}
        after={overlap.proposedValue}
        presentation={presentation}
      />
      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          data-testid="proposal-reconciliation-edit-by-hand"
          onClick={resolve.onEdit}
        >
          Edit by hand
        </Button>
        <Button
          size="small"
          data-testid="proposal-reconciliation-agent-fix"
          disabled={resolve.busy}
          onClick={resolve.onAgentFix}
        >
          Agent fix
        </Button>
      </Stack>
    </Stack>
  );
}

function InterveningEntry({
  entry,
  proposalHref,
  presentation,
}: {
  presentation: ReconciliationPresentation;
  entry: ProposalReconciliationIntervening;
  proposalHref: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.5,
        bgcolor: "background.paper",
      }}
      data-testid="proposal-reconciliation-intervening"
    >
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Link href={proposalHref} variant="body2" fontWeight={600}>
            {entry.title}
          </Link>
          {entry.overlappingPaths.map((path) => (
            <Chip
              key={path}
              size="small"
              color="warning"
              label={`Overlaps: ${reconciliationFieldLabel(path, presentation)}`}
            />
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Approved{entry.approvedByName ? ` by ${entry.approvedByName}` : ""} ·{" "}
          {format(new Date(entry.approvedAt), "MMM d, yyyy · p")}
        </Typography>
        {entry.changes.length ? (
          <Box>
            <Button
              size="small"
              data-testid="proposal-reconciliation-history-toggle"
              aria-expanded={expanded}
              onClick={() => setExpanded(!expanded)}
            >
              {expanded ? "Hide its changes" : "Show its changes"}
            </Button>
            {expanded ? (
              <Typography variant="caption" color="text.secondary">
                What this approved change changed at the time.
              </Typography>
            ) : null}
            {expanded
              ? entry.changes.map((change) => (
                  <Stack
                    key={change.path}
                    spacing={0.5}
                    sx={{ mt: 1 }}
                    data-testid="proposal-reconciliation-intervening-diff"
                  >
                    <Typography variant="caption" color="text.secondary">
                      {reconciliationFieldLabel(change.path, presentation)}
                    </Typography>
                    <ReconciliationFieldComparison
                      labels={{
                        before: "Before this change",
                        after: "After this change",
                      }}
                      path={change.path}
                      before={change.before}
                      after={change.after}
                      presentation={presentation}
                    />
                  </Stack>
                ))
              : null}
          </Box>
        ) : null}
      </Stack>
    </Paper>
  );
}

function ChangedSinceList({
  state,
  proposal,
  resolve,
  historyOnly = false,
}: {
  historyOnly?: boolean;
  state: ProposalReconciliationState;
  proposal: ProposalResponseDto;
  resolve: Resolve;
}) {
  const paths = usePathService();
  const registry = useWorkItemTypes(proposal.organizationId, {
    projectId: proposal.projectId,
  });
  const typeKey = state.currentBases.find(
    (basis) => basis.entityId === proposal.targetEntityId,
  )?.content.type;
  const definition = registry.workItemTypes.find(
    (item) => item.definition.key === typeKey,
  )?.definition;
  const presentation: ReconciliationPresentation =
    proposal.targetEntityType === "DESIGN_DOC"
      ? { kind: "design-doc" }
      : { kind: "work-item", definition };
  const future = proposal.action === "VERSIONED_UPDATE";
  if (!state.interveningProposals.length && !state.overlaps.length) return null;
  return (
    <Stack
      spacing={1}
      sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 1 }}
      data-testid="proposal-reconciliation-changed-since"
    >
      {!historyOnly &&
        state.overlaps.map((overlap) => (
          <Paper key={overlap.path} variant="outlined" sx={{ p: 1.5 }}>
            <OverlapComparison
              overlap={overlap}
              resolve={resolve}
              presentation={presentation}
              future={future}
            />
          </Paper>
        ))}
      <Typography variant="subtitle2">
        {historyOnly
          ? "Approval history"
          : future
            ? "What’s changed since the baseline"
            : "What’s changed since this was written"}
      </Typography>
      {[...state.interveningProposals]
        .sort((a, b) => a.approvedAt.localeCompare(b.approvedAt))
        .map((entry) => (
          <InterveningEntry
            key={entry.proposalId}
            entry={entry}
            presentation={presentation}
            proposalHref={paths.proposal({
              projectId: proposal.projectId,
              proposalId: entry.proposalId,
            })}
          />
        ))}
    </Stack>
  );
}

/**
 * Out-of-date review shared by standalone, grouped and future proposal surfaces.
 * Decided proposals have nothing to reconcile and render their children alone.
 */
export function ProposalReconciliationReview(props: {
  proposal: ProposalResponseDto;
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
  onApply,
  children,
}: {
  proposal: ProposalResponseDto;
  grouped?: boolean;
  onApply: (request: ProposalApprovalRequest) => void;
  children: React.ReactNode;
}) {
  const paths = usePathService();
  const invalidateReview = useInvalidateProposalReview();
  const [agentFixOpen, setAgentFixOpen] = useState(false);
  const [agentRequest, setAgentRequest] =
    useState<ProposalAgentFixRequest | null>(null);
  const [wasResolving, setWasResolving] = useState(false);
  const [manualState, setManualState] =
    useState<ProposalReconciliationState | null>(null);
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
      if (requestSequence.current === sequence) {
        const next = response.data.data;
        setState(next);
        if (
          next.revisions.some(
            (revision) =>
              revision.source === "MANUAL" || revision.source === "AGENT_FIX",
          ) ||
          next.overlaps.length ||
          next.status === "AGENT_FIX_REQUIRED" ||
          (proposal.action === "VERSIONED_UPDATE" &&
            next.status === "RECONCILIATION_REQUIRED")
        )
          setWasResolving(true);
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
  const hasOverlaps = !!state?.overlaps.length;
  const staged = !grouped && wasResolving;
  const reviewOutcome = async () => {
    await invalidateReview(proposal.organizationId, proposal.projectId);
    await refresh();
  };
  const missingCandidate =
    state?.status === "READY_FOR_REVIEW" &&
    !state.revisions.some(
      (revision) => revision.id === state.candidateRevisionId,
    );
  const usesReplacement = grouped || proposal.action === "VERSIONED_UPDATE";
  const approvalDisabled =
    !state ||
    !!error ||
    busy ||
    requiresReconciliation ||
    hasOverlaps ||
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
  const outOfDate = !!state && OUT_OF_DATE_STATUSES.has(state.status);
  const threeWay =
    !grouped && !!state && staged && (requiresReconciliation || hasOverlaps);
  const resolve: Resolve = {
    onEdit: () => setManualState(state),
    onAgentFix: () => setAgentFixOpen(true),
    busy,
  };
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
      <Stack spacing={1} data-testid="proposal-reconciliation-review">
        {outOfDate && !threeWay && (requiresReconciliation || !staged) ? (
          <OutOfDateHeadsUp state={state} />
        ) : null}
        {staged ? (
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
            {!state && !error ? (
              <CircularProgress
                size={18}
                aria-label="Checking current content"
              />
            ) : null}
            {error ? (
              <Alert
                severity="error"
                action={<Button onClick={() => void refresh()}>Refresh</Button>}
              >
                {error}
              </Alert>
            ) : null}
            {outOfDate && !threeWay && !staged ? (
              <>
                <ChangedSinceList
                  state={state}
                  proposal={proposal}
                  resolve={resolve}
                />
              </>
            ) : null}
            {threeWay ? (
              <ThreeWayReview proposal={proposal} state={state} />
            ) : null}
            {requiresReconciliation && (threeWay || !hasOverlaps) ? (
              <Stack spacing={1}>
                {state.status === "AGENT_FIX_REQUIRED" ? (
                  <Typography variant="body2" color="text.secondary">
                    This change can&apos;t be merged into the current content
                    automatically.
                  </Typography>
                ) : null}
                <Stack direction="row" spacing={1}>
                  {grouped ? (
                    <Button
                      variant="contained"
                      data-testid="proposal-reconciliation-merge"
                      disabled={busy || state.status === "AGENT_FIX_REQUIRED"}
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
                        proposedResult: result,
                        expectedCurrentBases: manualState.currentBases,
                      },
                    })
                    .then(async (response) => {
                      // A pending refinement must leave the active conflict and approved result intact.
                      if (proposal.action === "VERSIONED_UPDATE")
                        await refresh();
                      else setState(response.data.data);
                      setManualState(null);
                      void invalidateReview(
                        proposal.organizationId,
                        proposal.projectId,
                      );
                    })
                    .catch(async (caught) => {
                      if (
                        isAxiosError(caught) &&
                        caught.response?.status === 409
                      ) {
                        await refresh();
                        setManualState(null);
                      }
                      setError(
                        caught instanceof Error
                          ? caught.message
                          : "The result could not be prepared. Refresh and try again.",
                      );
                    })
                    .finally(() => setBusy(false));
                }}
              />
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
            {state?.status === "READY_FOR_REVIEW" && !staged ? (
              <Typography
                variant="subtitle2"
                data-testid="proposal-reconciliation-merged-result"
              >
                {proposal.action === "VERSIONED_UPDATE"
                  ? "Complete revised result"
                  : "Merged result compared with current content"}
              </Typography>
            ) : null}
            {threeWay ? (
              proposal.action === "VERSIONED_UPDATE" ? null : (
                children
              )
            ) : (
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
                {children}
              </DiffLabelsContext.Provider>
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
    </ProposalReconciliationContext.Provider>
  );
}
