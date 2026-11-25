import { Alert, Box, Button, Chip, Paper, Stack } from "@mui/material";
import React, { useContext, useEffect } from "react";
import { ProposalAction, type ProposalResponseDto } from "../../api";
import type { ProposalTargetFailure } from "../../data/hooks/proposalTargetRead";
import type { ApprovalProgress } from "../../permissions";
import { ProposalContentBlockedContext } from "./ProposalContentBlockedContext";
import { ProposalEdges } from "./ProposalEdges";
import { ProposalFailureDiagnostic } from "./ProposalFailureDiagnostic";
import { staticProposalEntityTypePresentation } from "./proposalHeaderType";
import type { ProposalRenderOverrides } from "./proposalRenderOverrides";
import { ProposalStateIndicator } from "./ProposalStateIndicator";
import { ProposalTitle } from "./ProposalTitle";
import type { ProposalItemStatus } from "./types";

const archivesTarget = (proposal: ProposalResponseDto): boolean =>
  proposal.action === ProposalAction.Delete ||
  ("status" in proposal.updates && proposal.updates.status === "ARCHIVED");

/** Says, in the reviewer's terms, why this proposal's item cannot be shown. */
export function describeTargetFailure(
  proposal: ProposalResponseDto,
  status: ProposalItemStatus,
  failure: ProposalTargetFailure,
): string {
  const title = proposal.title?.trim();
  const item = title ? `“${title}”` : "This item";

  if (!failure.notFound) {
    return `${item} couldn’t be loaded: ${failure.message}`;
  }
  if (status.state === "applied" && archivesTarget(proposal)) {
    return `${item} is now archived.`;
  }
  return `${item} is archived or no longer exists.`;
}

/**
 * The card for a proposal whose current content cannot be shown. It keeps the
 * proposal's identity and decision, and while a decision is still needed it
 * withholds approval and leaves rejection available.
 */
export const UnavailableTargetCard: React.FC<{
  proposal: ProposalResponseDto;
  status: ProposalItemStatus;
  explanation: string;
  /** Reads the item again, when doing so could succeed. */
  onRetry?: () => void;
  onReject?: (reason: string) => Promise<void>;
  disabled?: boolean;
  siblingProposals: Map<string, ProposalResponseDto>;
  approvalProgress: ApprovalProgress | undefined;
  overrides: ProposalRenderOverrides;
}> = ({
  proposal,
  status,
  explanation,
  onRetry,
  onReject,
  disabled,
  siblingProposals,
  approvalProgress,
  overrides,
}) => {
  const decided =
    status.state === "applying" ||
    status.state === "applied" ||
    status.state === "rejected" ||
    !!status.reviewAccepted;

  const blockApproval = useContext(ProposalContentBlockedContext);
  useEffect(() => {
    if (decided) {
      return;
    }
    return blockApproval?.(proposal.id);
  }, [blockApproval, decided, proposal.id]);

  const content = (
    <Stack
      spacing={1.5}
      data-testid="proposal-target-unavailable"
      data-proposal-id={proposal.id}
    >
      {!overrides.hideHeader && (
        <ProposalTitle
          proposal={proposal}
          typePresentation={staticProposalEntityTypePresentation(
            proposal.targetEntityType,
          )}
          hideTypeChip={overrides.hideTypeChip}
          linked={false}
        />
      )}
      <Alert
        severity={decided ? "info" : "error"}
        action={
          onRetry ? (
            <Button
              color="inherit"
              size="small"
              onClick={onRetry}
              data-testid="proposal-target-retry"
            >
              Try again
            </Button>
          ) : undefined
        }
      >
        <div>{explanation}</div>
        {decided ? null : (
          <div>It can’t be approved without the item’s current content.</div>
        )}
      </Alert>
      {status.state === "failed" && status.error ? (
        <Alert severity="error">{status.error}</Alert>
      ) : null}
      {status.state === "failed" ? (
        <ProposalFailureDiagnostic diagnostic={status.diagnostic} />
      ) : null}
      <ProposalEdges
        edges={proposal.edges}
        siblingProposals={siblingProposals}
        organizationId={proposal.organizationId}
        projectId={proposal.projectId}
        ownerApplied={status.state === "applied"}
      />
      {!overrides.hideStateIndicator && (
        <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
          {status.state === "pending" && status.reviewAccepted ? (
            <Chip label="Approved" size="small" color="success" />
          ) : (
            <ProposalStateIndicator
              // A failed attempt is still undecided, so Reject stays offered.
              status={status.state === "failed" ? { state: "pending" } : status}
              action={proposal.action}
              canApprove={false}
              onApply={() => undefined}
              onReject={onReject}
              disabled={disabled}
              approvalProgress={approvalProgress}
            />
          )}
        </Box>
      )}
    </Stack>
  );

  return overrides.hideCard ? (
    content
  ) : (
    <Paper variant="outlined" sx={{ p: 2 }}>
      {content}
    </Paper>
  );
};
