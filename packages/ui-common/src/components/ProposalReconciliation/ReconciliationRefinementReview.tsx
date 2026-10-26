import {
  Alert,
  Button,
  CircularProgress,
  Stack,
  Typography,
} from "@mui/material";
import { ProposalStatus } from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import { useProposal } from "../../data/hooks/useProposal";
import { useInvalidateProposalReview } from "../../data/hooks/useInvalidateProposalReview";
import { useInvalidateConversation } from "../../data/hooks/useInvalidateConversation";
import { UpdateProposal } from "../ProposalDispatchers/UpdateProposal";

/** Review changes to the same non-live future inside Resolve, without offering Apply. */
export function ReconciliationRefinementReview({
  organizationId,
  projectId,
  proposalId,
  onReviewed,
}: {
  organizationId: string;
  projectId: string;
  proposalId: string;
  onReviewed: () => Promise<void>;
}) {
  const { proposal, error, refetch } = useProposal(
    organizationId,
    projectId,
    proposalId,
  );
  const invalidateReview = useInvalidateProposalReview();
  const invalidateConversation = useInvalidateConversation();
  const refresh = async () => {
    await invalidateReview(organizationId, projectId);
    if (proposal?.conversationId)
      invalidateConversation(proposal.conversationId);
    await onReviewed();
  };
  if (error)
    return (
      <Alert
        severity="error"
        action={<Button onClick={() => void refetch()}>Refresh</Button>}
      >
        {error.message}
      </Alert>
    );
  if (!proposal)
    return <CircularProgress size={18} aria-label="Loading proposed fix" />;
  if (proposal.status !== ProposalStatus.Draft) return null;
  return (
    <Stack spacing={1} data-testid="proposal-reconciliation-refinement">
      <Typography variant="subtitle2">Review the fix</Typography>
      <Typography variant="body2">
        Approval updates this future and leaves live content unchanged.
      </Typography>
      <UpdateProposal
        organizationId={organizationId}
        projectId={projectId}
        proposals={[proposal]}
        renderMode="reconciliation-refinement"
        onApply={async (id, request = {}) => {
          try {
            const response = await proposalsClient.updateProposal({
              organizationId,
              projectId,
              proposalId: id,
              updateProposalDto: {
                status: ProposalStatus.Approved,
                ...request,
              },
            });
            if (!response.data.data)
              throw new Error(
                "Approval response omitted the reviewed proposal.",
              );
            return response.data.data;
          } finally {
            await refresh();
          }
        }}
        onReject={async (id, reason) => {
          try {
            await proposalsClient.rejectProposal({
              organizationId,
              projectId,
              proposalId: id,
              rejectProposalDto: { reason },
            });
          } finally {
            await refresh();
          }
        }}
      />
    </Stack>
  );
}
