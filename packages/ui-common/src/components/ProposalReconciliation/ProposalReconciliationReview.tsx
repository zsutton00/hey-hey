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
import { formatDistanceToNow } from "date-fns";
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
import { DiffRenderer } from "../SuggestedContent/DiffRenderer";
import { subscribeProposalReconciliation } from "./reconciliationInvalidation";
import { AgentFixConfirmDialog } from "./AgentFixConfirmDialog";

export const ProposalReconciliationContext = createContext<{
  approvalDisabled: boolean;
  submit: () => void;
} | null>(null);

const OUT_OF_DATE_STATUSES = new Set<ProposalReconciliationState["status"]>([
  "RECONCILIATION_REQUIRED",
  "AGENT_FIX_REQUIRED",
  "READY_FOR_REVIEW",
]);

const ago = (iso: string) =>
  formatDistanceToNow(new Date(iso), { addSuffix: true });

const displayValue = (value: unknown): string =>
  value === null || value === undefined
    ? ""
    : typeof value === "string"
      ? value
      : JSON.stringify(value, null, 2);

type Resolve = { editHref: string; onAgentFix: () => void; busy: boolean };

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
}: {
  overlap: ProposalReconciliationOverlap;
  resolve: Resolve;
}) {
  return (
    <Stack spacing={1} data-testid="proposal-reconciliation-overlap">
      <Stack direction="row" spacing={2}>
        {(
          [
            ["Now", overlap.currentValue],
            ["This proposal", overlap.proposedValue],
          ] as const
        ).map(([label, value]) => (
          <Box key={label} sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
            <Typography
              variant="body2"
              component="div"
              sx={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}
            >
              {displayValue(value) || "(empty)"}
            </Typography>
          </Box>
        ))}
      </Stack>
      <Stack direction="row" spacing={1}>
        <Button
          size="small"
          data-testid="proposal-reconciliation-edit-by-hand"
          href={resolve.editHref}
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
}: {
  entry: ProposalReconciliationIntervening;
  overlaps: ProposalReconciliationOverlap[];
  proposalHref: string;
  resolve: Resolve;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.5 }}
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
              label={`Overlaps: ${path}`}
            />
          ))}
        </Stack>
        <Typography variant="caption" color="text.secondary">
          Approved{entry.approvedByName ? ` by ${entry.approvedByName}` : ""}{" "}
          {ago(entry.approvedAt)}
        </Typography>
        {overlaps.map((overlap) => (
          <OverlapComparison
            key={overlap.path}
            overlap={overlap}
            resolve={resolve}
          />
        ))}
        {entry.changes.length ? (
          <Box>
            <Button size="small" onClick={() => setExpanded(!expanded)}>
              {expanded ? "Hide its changes" : "Show its changes"}
            </Button>
            {expanded
              ? entry.changes.map((change) => (
                  <Stack
                    key={change.path}
                    spacing={0.5}
                    sx={{ mt: 1 }}
                    data-testid="proposal-reconciliation-intervening-diff"
                  >
                    <Typography variant="caption" color="text.secondary">
                      {change.path}
                    </Typography>
                    <DiffRenderer
                      oldContent={displayValue(change.before)}
                      newContent={displayValue(change.after)}
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
  const unattributed = state.overlaps.filter(
    (overlap) => !overlap.interveningProposalId,
  );
  if (!state.interveningProposals.length && !unattributed.length) return null;
  return (
    <Stack spacing={1} data-testid="proposal-reconciliation-changed-since">
      <Typography variant="subtitle2">
        What&apos;s changed since this was written
      </Typography>
      {state.interveningProposals.map((entry) => (
        <InterveningEntry
          key={entry.proposalId}
          entry={entry}
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
            label={`Overlaps: ${overlap.path}`}
            sx={{ mb: 1 }}
          />
          <OverlapComparison overlap={overlap} resolve={resolve} />
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
  onApply: (request: ProposalApprovalRequest) => void;
  children: React.ReactNode;
}) {
  if (
    props.proposal.status === ProposalStatus.Approved ||
    props.proposal.status === ProposalStatus.Rejected
  )
    return <>{props.children}</>;
  return <PendingProposalReconciliationReview {...props} />;
}

function PendingProposalReconciliationReview({
  proposal,
  onApply,
  children,
}: {
  proposal: ProposalResponseDto;
  onApply: (request: ProposalApprovalRequest) => void;
  children: React.ReactNode;
}) {
  const paths = usePathService();
  const [agentFixOpen, setAgentFixOpen] = useState(false);
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
  const approvalDisabled =
    !state ||
    !!error ||
    busy ||
    requiresReconciliation ||
    hasOverlaps ||
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
  const outOfDate = !!state && OUT_OF_DATE_STATUSES.has(state.status);
  const resolve: Resolve = {
    editHref: outOfDate
      ? paths.proposal({
          projectId: proposal.projectId,
          proposalId: proposal.id,
          editing: true,
        })
      : "",
    onAgentFix: () => setAgentFixOpen(true),
    busy,
  };
  const hasReplacement =
    !!state?.replacementProposalId || !!state?.replacementGroupId;
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
              <Button
                variant="contained"
                data-testid="proposal-reconciliation-merge"
                disabled={busy || state.status === "AGENT_FIX_REQUIRED"}
                onClick={() => void merge()}
              >
                Merge with current content
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
        {agentFixOpen ? (
          <AgentFixConfirmDialog
            proposal={proposal}
            onClose={() => setAgentFixOpen(false)}
          />
        ) : null}
        {state?.replacementProposalId ? (
          <Button
            variant="contained"
            data-testid="proposal-reconciliation-open-replacement"
            href={paths.proposal({
              projectId: proposal.projectId,
              proposalId: state.replacementProposalId,
            })}
          >
            Review merged version
          </Button>
        ) : null}
        {state?.replacementGroupId ? (
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
            Merged result compared with current content
          </Typography>
        ) : null}
        {children}
      </Stack>
    </ProposalReconciliationContext.Provider>
  );
}
