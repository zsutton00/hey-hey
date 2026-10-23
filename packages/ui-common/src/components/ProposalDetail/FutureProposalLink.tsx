import { Alert, Link } from "@mui/material";
import { useProposal } from "../../data/hooks/useProposal";
import { usePathService } from "../../contexts/PathServiceContext";

export function FutureProposalLink({
  organizationId,
  projectId,
  proposalId,
}: {
  organizationId: string;
  projectId: string;
  proposalId: string;
}) {
  const { proposal, isLoading, error } = useProposal(
    organizationId,
    projectId,
    proposalId,
  );
  const paths = usePathService();
  if (isLoading) return <span>Loading revision…</span>;
  if (error || !proposal?.title)
    return <Alert severity="warning">Revision details unavailable</Alert>;
  return (
    <Link
      href={paths.proposal({ projectId, proposalId })}
      data-testid="future-refinement-link"
      data-proposal-id={proposalId}
    >
      {proposal.title}
    </Link>
  );
}
