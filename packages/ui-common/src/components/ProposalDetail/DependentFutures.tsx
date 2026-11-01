import { useState } from "react";
import { Alert, Button, Stack } from "@mui/material";
import { useProposals } from "../../data/hooks/useProposals";
import { usePathService } from "../../contexts/PathServiceContext";
import { ProposalList } from "../ProposalList";

const PAGE_SIZE = 20;

export function DependentFutures({
  organizationId,
  projectId,
  taskId,
}: {
  organizationId: string;
  projectId: string;
  taskId: string;
}) {
  const [offset, setOffset] = useState(0);
  const paths = usePathService();
  const { data, isLoading, error, pagination } = useProposals(
    organizationId,
    projectId,
    { completionDependencyId: taskId, offset, limit: PAGE_SIZE },
  );

  if (error) {
    return <Alert severity="error">{error.message}</Alert>;
  }

  return (
    <Stack spacing={1} data-testid="dependent-futures">
      <ProposalList
        proposals={data}
        loading={isLoading}
        getProposalHref={(proposal) =>
          paths.proposal({ projectId, proposalId: proposal.id })
        }
      />
      <Stack direction="row">
        {offset > 0 && (
          <Button
            onClick={() => setOffset((value) => Math.max(0, value - PAGE_SIZE))}
          >
            Previous
          </Button>
        )}
        {pagination?.hasNext && (
          <Button onClick={() => setOffset((value) => value + PAGE_SIZE)}>
            Next
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
