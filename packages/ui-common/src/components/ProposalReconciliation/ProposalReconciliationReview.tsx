import { isAxiosError } from "axios";
import React, {
  createContext,
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
  Typography,
} from "@mui/material";
import { format, formatDistanceToNow } from "date-fns";
import {
  ProposalStatus,
  type ProposalResponseDto,
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

export const ProposalReconciliationContext = createContext<{
  approvalDisabled: boolean;
  state: ProposalReconciliationState | null;
  standaloneUpdate: boolean;
  future: boolean;
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
  overlaps,
  proposalHref,
  resolve,
  presentation,
  future,
}: {
  presentation: ReconciliationPresentation;
  future: boolean;
  entry: ProposalReconciliationIntervening;
  overlaps: ProposalReconciliationOverlap[];
  proposalHref: string;
  resolve: Resolve;
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
        {overlaps.map((overlap) => (
          <OverlapComparison
            key={overlap.path}
            overlap={overlap}
            resolve={resolve}
            presentation={presentation}
            future={future}
          />
        ))}
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
                {overlaps.length
                  ? " Hiding this comparison keeps the overlap above visible for resolution."
                  : ""}
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
}: {
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
  const unattributed = state.overlaps.filter(
    (overlap) => !overlap.interveningProposalId,
  );
  if (!state.interveningProposals.length && !unattributed.length) return null;
  return (
    <Stack
      spacing={1}
      sx={{ p: 1.5, bgcolor: "action.hover", borderRadius: 1 }}
      data-testid="proposal-reconciliation-changed-since"
    >
      <Typography variant="subtitle2">
        {future
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
            future={future}
            overlaps={state.overlaps.filter(
              (overlap) => overlap.interveningProposalId === entry.proposalId,
            )}
            proposalHref={paths.proposal({
              projectId: proposal.projectId,
              proposalId: entry.proposalId,
            })}
            resolve={resolve}
          />
        ))}
      {unattributed.map((overlap) => (
        <Paper key={overlap.path} variant="outlined" sx={{ p: 1.5 }}>
          <Chip
            size="small"
            color="warning"
            label={`Overlaps: ${reconciliationFieldLabel(overlap.path, presentation)}`}
            sx={{ mb: 1 }}
          />
          <OverlapComparison
            overlap={overlap}
            resolve={resolve}
            presentation={presentation}
            future={future}
          />
        </Paper>
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
  const hasOverlaps = !!state?.overlaps.length;
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
  const resolve: Resolve = {
    onEdit: () => setManualState(state),
    onAgentFix: () => setAgentFixOpen(true),
    busy,
  };
  const hasReplacement =
    usesReplacement &&
    (!!state?.replacementProposalId || !!state?.replacementGroupId);
  return (
    <ProposalReconciliationContext.Provider
      value={{
        approvalDisabled,
        submit,
        state,
        standaloneUpdate: !grouped && proposal.action === "UPDATE",
        future: proposal.action === "VERSIONED_UPDATE",
      }}
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
        {outOfDate ? (
          <>
            <OutOfDateHeadsUp state={state} />
            <ChangedSinceList
              state={state}
              proposal={proposal}
              resolve={resolve}
            />
          </>
        ) : null}
        {requiresReconciliation && !hasOverlaps && !hasReplacement ? (
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
                data-testid="proposal-reconciliation-edit-by-hand"
                disabled={busy || !state.currentBases.length}
                onClick={resolve.onEdit}
              >
                Edit by hand
              </Button>
              <Button
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
                .then((response) => {
                  setState(response.data.data);
                  setManualState(null);
                  void invalidateReview(
                    proposal.organizationId,
                    proposal.projectId,
                  );
                })
                .catch(async (caught) => {
                  if (isAxiosError(caught) && caught.response?.status === 409) {
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
          />
        ) : null}
        {usesReplacement && state?.replacementProposalId ? (
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
        {outOfDate ? (
          <Box sx={{ borderTop: 1, borderColor: "divider", pt: 2 }}>
            <Typography
              variant="subtitle2"
              data-testid="proposal-reconciliation-under-review"
            >
              {proposal.action === "VERSIONED_UPDATE"
                ? "Future under review"
                : "This proposal’s change"}
            </Typography>
            {hasOverlaps ? (
              <Typography variant="body2" color="text.secondary">
                The complete revised result appears after resolution.{" "}
                {proposal.action === "VERSIONED_UPDATE"
                  ? "Previous approval does not approve new edits. Review the revised future, then choose Apply separately."
                  : "Resolve the overlap to approve."}
              </Typography>
            ) : null}
            {children}
          </Box>
        ) : (
          children
        )}
      </Stack>
    </ProposalReconciliationContext.Provider>
  );
}
