import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CheckIcon from "@mui/icons-material/Check";
import { Alert, Button, Chip, Stack, Typography } from "@mui/material";
import { Fragment, type ReactNode } from "react";
import type {
  FutureDependencyPresentation,
  ProposalResponseDto,
} from "../../api";
import { useProposal } from "../../data/hooks/useProposal";
import { MentionCopyBoundary } from "../shared/MentionCopyBoundary";
import { FutureApplication } from "../ProposalDetail/FutureApplication";
import {
  FutureDependency,
  FutureDependencyName,
} from "../ProposalDetail/FutureDependency";
import { FutureProposalLink } from "../ProposalDetail/FutureProposalLink";

const joinNames = (dependencies: readonly FutureDependencyPresentation[]) =>
  dependencies.map((dependency, index) => (
    <Fragment key={dependency.targetEntityId}>
      {index > 0 && (index === dependencies.length - 1 ? " and " : ", ")}
      <FutureDependencyName dependency={dependency} />
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
interface FutureApplyFooterProps {
  proposal: ProposalResponseDto;
  onApplied?: (id: string) => Promise<void> | void;
  /** Present until approval; replaces the Approved step. */
  approveControl?: ReactNode;
}

export function FutureApplyFooter(props: FutureApplyFooterProps) {
  return (
    <MentionCopyBoundary>
      <FutureApplyFooterContent {...props} />
    </MentionCopyBoundary>
  );
}

function FutureApplyFooterContent({
  proposal: initial,
  onApplied,
  approveControl,
}: FutureApplyFooterProps) {
  const { organizationId, projectId } = initial;
  const { proposal, refetch, isReady, error } = useProposal(
    organizationId,
    projectId,
    initial.id,
  );
  const current = proposal ?? initial;
  const linkedWorkUnavailable = (
    <Alert
      severity="error"
      data-testid="future-linked-work-unavailable"
      action={<Button onClick={() => void refetch()}>Refresh</Button>}
    >
      Linked work details are unavailable. Refresh before reviewing or applying
      this future.
    </Alert>
  );
  if (approveControl && current.status !== "APPROVED") {
    const previous = current.reviewedFuture;
    const linked = previous
      ? previous.dependencyPresentation
      : current.dependencyPresentation;
    if (!linked) return linkedWorkUnavailable;
    return (
      <Stack spacing={1} data-testid="future-apply-footer" data-state="preview">
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="nowrap"
          sx={{
            minWidth: 0,
            overflowX: "auto",
            "& > :not([data-testid=future-linked-work])": { flexShrink: 0 },
          }}
          useFlexGap
        >
          {previous ? (
            <Chip
              icon={<CheckIcon />}
              label="Previously approved"
              size="small"
              color="success"
              variant="outlined"
            />
          ) : (
            approveControl
          )}
          {linked.length > 0 && (
            <ArrowForwardIcon fontSize="small" color="disabled" />
          )}
          {linked.length > 0 && (
            <Stack
              direction="row"
              spacing={1}
              sx={{
                minWidth: 0,
                flex: 1,
                overflowX: "auto",
                "& > *": { flexShrink: 0 },
              }}
              data-testid="future-linked-work"
            >
              {linked.map((dependency) => (
                <FutureDependency
                  key={dependency.targetEntityId}
                  {...{ organizationId, projectId, dependency }}
                />
              ))}
            </Stack>
          )}
          <ArrowForwardIcon fontSize="small" color="disabled" />
          <Button
            size="small"
            variant="contained"
            color="success"
            disabled
            data-testid="future-apply"
          >
            Apply
          </Button>
        </Stack>
        {previous && approveControl}
        <Typography
          variant="body2"
          color="text.secondary"
          data-testid="future-waiting"
        >
          {previous ? (
            "Review this revised result. Approval stores the same future and leaves live content unchanged; then choose Apply separately."
          ) : linked.length > 0 ? (
            <>
              Once approved, this change waits for {joinNames(linked)} to reach
              Verifying. You'll be asked to apply it then.
            </>
          ) : (
            "Once approved, you can apply this change."
          )}
        </Typography>
      </Stack>
    );
  }
  const future = current.reviewedFuture;
  if (!future && (isReady || error))
    return (
      <Alert
        severity="error"
        action={<Button onClick={() => void refetch()}>Refresh</Button>}
      >
        The approved future is unavailable. Refresh before reviewing or applying
        it.
      </Alert>
    );
  if (!future)
    return (
      <Typography variant="body2" color="text.secondary">
        Approved. Loading linked work…
      </Typography>
    );
  if (future.outcome === "CANCELLED")
    return <Alert severity="info">This approved change was cancelled.</Alert>;

  // Required response data can be absent when the running API violates its
  // contract. Keep that failure local; absence never means no dependencies.
  const linked = future.dependencyPresentation;
  if (!linked) return linkedWorkUnavailable;

  const waitingIds = new Set(
    future.completionEligibility.blockers.map(
      (blocker) => blocker.dependency.targetEntityId,
    ),
  );
  const waitingOn = linked.filter((dependency) =>
    waitingIds.has(dependency.targetEntityId),
  );
  const refinements = Array.from(future.outstandingRefinementProposalIds);

  return (
    <Stack spacing={1} data-testid="future-apply-footer">
      <FutureApplication
        key={future.id}
        future={future}
        onRefresh={async () => {
          await refetch();
        }}
        reviewSteps={
          <>
            <Chip
              icon={<CheckIcon />}
              label="Previously approved"
              size="small"
              color="success"
              variant="outlined"
            />
            {future.dependencies.length > 0 && (
              <ArrowForwardIcon fontSize="small" color="disabled" />
            )}
            {linked.length > 0 && (
              <Stack
                direction="row"
                spacing={1}
                sx={{
                  minWidth: 0,
                  flex: 1,
                  overflowX: "auto",
                  "& > *": { flexShrink: 0 },
                }}
                data-testid="future-linked-work"
              >
                {linked.map((dependency) => (
                  <FutureDependency
                    key={dependency.targetEntityId}
                    {...{ organizationId, projectId, dependency }}
                  />
                ))}
              </Stack>
            )}
          </>
        }
        onApplied={async () => {
          await refetch();
          await onApplied?.(current.id);
        }}
        waitingNote={
          waitingOn.length > 0 ? (
            <>
              Waiting for {joinNames(waitingOn)}. You'll be asked to apply this
              change when {waitingOn.length > 1 ? "they reach" : "it reaches"}{" "}
              Verifying. Refresh checks the status again.
            </>
          ) : undefined
        }
      />
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
