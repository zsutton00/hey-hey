import { Alert, Box, Button, Stack } from "@mui/material";
import { useEntityPromptTemplateProposal } from "@hey-hey/ui-common/data";
import type {
  EntityPromptTemplateSelectorDto,
  ProposalResponseDto,
} from "@hey-hey/ui-common/api";
import React, { useEffect } from "react";
import { proposalReviewPath } from "../Proposals/proposalReviewPath";

export type EntityPromptTemplatePendingOperation = "RETIRE" | "UPSERT";

export interface EntityPromptTemplateProposalActionsProps {
  organizationId: string;
  projectId: string;
  proposals: ProposalResponseDto[];
  error?: Error | null;
  templateKey: string;
  selector: EntityPromptTemplateSelectorDto;
  onReviseRejected: (content: string) => void;
  onPendingOperationChange?: (
    proposalId: string,
    operation: EntityPromptTemplatePendingOperation | null
  ) => void;
}

interface ProposalProjectionProps {
  organizationId: string;
  projectId: string;
  proposal: ProposalResponseDto;
  templateKey: string;
  selector: EntityPromptTemplateSelectorDto;
  onReviseRejected: (content: string) => void;
  onPendingOperationChange?: (
    proposalId: string,
    operation: EntityPromptTemplatePendingOperation | null
  ) => void;
}

const ProposalProjection: React.FC<ProposalProjectionProps> = ({
  organizationId,
  projectId,
  proposal,
  templateKey,
  selector,
  onReviseRejected,
  onPendingOperationChange,
}) => {
  const projection = useEntityPromptTemplateProposal(proposal, {
    organizationId,
    projectId,
    templateKey,
    selector,
  });

  const projectedProposal = projection.proposal;
  const updates = projectedProposal?.updates;
  const proposedContent =
    updates !== null &&
    typeof updates === "object" &&
    "operation" in updates &&
    updates.operation === "UPSERT" &&
    "content" in updates &&
    typeof updates.content === "string"
      ? updates.content
      : null;
  const isRejected = projectedProposal?.status === "REJECTED";
  const operation =
    updates !== null &&
    typeof updates === "object" &&
    "operation" in updates &&
    (updates.operation === "UPSERT" || updates.operation === "RETIRE")
      ? updates.operation
      : null;
  const pendingOperation =
    projectedProposal?.status === "DRAFT" ? operation : null;

  useEffect(() => {
    onPendingOperationChange?.(proposal.id, pendingOperation);
    return () => onPendingOperationChange?.(proposal.id, null);
  }, [onPendingOperationChange, pendingOperation, proposal.id]);

  if (!projectedProposal) {
    return null;
  }

  return (
    <Stack spacing={1}>
      {pendingOperation && (
        <Alert
          severity="info"
          data-testid="entity-prompt-template-pending-proposal-notice"
        >
          There is a current proposal. Either accept or reject it before making
          further edits.
        </Alert>
      )}
      <Button
        component="a"
        href={proposalReviewPath(projectId, projectedProposal)}
        variant="outlined"
        size="small"
        sx={{ alignSelf: "flex-start" }}
        data-testid="entity-prompt-template-proposal-link"
      >
        View proposal
      </Button>
      {isRejected && proposedContent && (
        <Button
          variant="text"
          onClick={() => onReviseRejected(proposedContent)}
          data-testid="entity-prompt-template-revise-rejected"
        >
          Revise rejected content
        </Button>
      )}
    </Stack>
  );
};

export const EntityPromptTemplateProposalActions: React.FC<
  EntityPromptTemplateProposalActionsProps
> = ({
  organizationId,
  projectId,
  proposals,
  error,
  templateKey,
  selector,
  onReviseRejected,
  onPendingOperationChange,
}) => {
  if (error) {
    return (
      <Alert
        severity="error"
        data-testid="entity-prompt-template-proposals-error"
      >
        Failed to load template proposals: {error.message}
      </Alert>
    );
  }

  if (proposals.length === 0) {
    return null;
  }

  return (
    <Box component="section" data-testid="entity-prompt-template-proposals">
      <Stack spacing={2}>
        {proposals.map((proposal) => (
          <ProposalProjection
            key={proposal.id}
            proposal={proposal}
            organizationId={organizationId}
            projectId={projectId}
            templateKey={templateKey}
            selector={selector}
            onReviseRejected={onReviseRejected}
            onPendingOperationChange={onPendingOperationChange}
          />
        ))}
      </Stack>
    </Box>
  );
};

EntityPromptTemplateProposalActions.displayName =
  "EntityPromptTemplateProposalActions";
