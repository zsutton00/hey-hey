import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CheckIcon from "@mui/icons-material/Check";
import { Alert, Button, Chip, Stack, Typography } from "@mui/material";
import { Fragment, type ReactNode } from "react";
import type { ProposalResponseDto } from "../../api";
import { useProposal } from "../../data/hooks/useProposal";
import { FutureApplication } from "../ProposalDetail/FutureApplication";
import {
  FutureDependency,
  FutureDependencyName,
} from "../ProposalDetail/FutureDependency";
import { FutureProposalLink } from "../ProposalDetail/FutureProposalLink";

const joinNames = (
  taskIds: string[],
  organizationId: string,
  projectId: string,
) =>
  taskIds.map((taskId, index) => (
    <Fragment key={taskId}>
      {index > 0 && (index === taskIds.length - 1 ? " and " : ", ")}
      <FutureDependencyName {...{ organizationId, projectId, taskId }} />
    </Fragment>
  ));

/**
 * A future revision's footer: Approve → linked work → Apply, shown in every
 * state. Before approval, `approveControl` (the ordinary Approve/Reject) fills
 * the first step, linked work is a preview from the proposal (no status
 * checks) and Apply is disabled. After approval, linked work shows live status
 * and Apply follows the API (completion eligibility and applicability); this
 * footer never infers readiness.
 */
export function FutureApplyFooter({
  proposal: initial,
  onApplied,
  approveControl,
}: {
  proposal: ProposalResponseDto;
  onApplied?: (id: string) => Promise<void> | void;
  /** Present until approval; replaces the Approved step. */
  approveControl?: ReactNode;
}) {
  const { organizationId, projectId } = initial;
  const { proposal, refetch } = useProposal(
    organizationId,
    projectId,
    initial.id,
  );
  const current = proposal ?? initial;
  if (approveControl) {
    const updates = initial.updates as {
      dependencies?: Iterable<{ targetEntityId: string }>;
    };
    const linked = Array.from(updates.dependencies ?? []).map(
      (dependency) => dependency.targetEntityId,
    );
    return (
      <Stack spacing={1} data-testid="future-apply-footer" data-state="preview">
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          {approveControl}
          {linked.length > 0 && (
            <ArrowForwardIcon fontSize="small" color="disabled" />
          )}
          {linked.map((taskId) => (
            <Typography
              key={taskId}
              variant="body2"
              color="text.secondary"
              data-testid="future-dependency-preview"
            >
              <FutureDependencyName
                {...{ organizationId, projectId, taskId }}
              />
            </Typography>
          ))}
          <ArrowForwardIcon fontSize="small" color="disabled" />
          <Button size="small" disabled data-testid="future-apply">
            Apply
          </Button>
        </Stack>
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="future-waiting"
        >
          {linked.length > 0 ? (
            <>
              Once approved, this change waits for{" "}
              {joinNames(linked, organizationId, projectId)} to reach Verifying.
              You'll be asked to apply it then.
            </>
          ) : (
            "Once approved, you can apply this change."
          )}
        </Typography>
      </Stack>
    );
  }
  const future = current.reviewedFuture;
  if (!future)
    return (
      <Typography variant="body2" color="text.secondary">
        Approved. Loading linked work…
      </Typography>
    );
  if (future.outcome === "CANCELLED")
    return <Alert severity="info">This approved change was cancelled.</Alert>;

  const waitingOn = future.completionEligibility.blockers.map(
    (blocker) => blocker.dependency.targetEntityId,
  );
  const refinements = Array.from(future.outstandingRefinementProposalIds);

  return (
    <Stack spacing={1} data-testid="future-apply-footer">
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
      >
        <Chip
          icon={<CheckIcon />}
          label="Approved"
          size="small"
          color="success"
          variant="outlined"
        />
        {future.dependencies.length > 0 && (
          <ArrowForwardIcon fontSize="small" color="disabled" />
        )}
        {future.dependencies.map((dependency) => (
          <FutureDependency
            key={dependency.targetEntityId}
            {...{ organizationId, projectId }}
            taskId={dependency.targetEntityId}
          />
        ))}
        <ArrowForwardIcon fontSize="small" color="disabled" />
        <FutureApplication
          key={future.id}
          future={future}
          reconciliationProposal={current}
          onApplied={async () => {
            await refetch();
            await onApplied?.(current.id);
          }}
          waitingNote={
            waitingOn.length > 0 ? (
              <>
                Waiting for {joinNames(waitingOn, organizationId, projectId)}.
                You'll be asked to apply this change when{" "}
                {waitingOn.length > 1 ? "they reach" : "it reaches"} Verifying.
                Refresh checks the status again.
              </>
            ) : undefined
          }
        />
      </Stack>
      {refinements.length > 0 && (
        <Stack spacing={0.5}>
          <Typography variant="body2" color="text.secondary">
            Pending changes to this approved revision:
          </Typography>
          {refinements.map((proposalId) => (
            <FutureProposalLink
              key={proposalId}
              {...{ organizationId, projectId, proposalId }}
            />
          ))}
        </Stack>
      )}
    </Stack>
  );
}
