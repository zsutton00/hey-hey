import { useState } from "react";
import { Alert, Button, Link, Stack, Typography } from "@mui/material";
import { useProposals } from "../../data/hooks/useProposals";
import { usePathService } from "../../contexts/PathServiceContext";

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
    { completionDependencyId: taskId, offset, limit: 20 },
  );
  return (
    <Stack spacing={1} data-testid="dependent-futures">
      <Typography variant="subtitle2">Dependent futures</Typography>
      {isLoading ? (
        <Typography>Loading dependent futures…</Typography>
      ) : error ? (
        <Alert severity="error">{error.message}</Alert>
      ) : (
        <>
          {data.length === 0 && <Typography>No dependent futures</Typography>}
          {data.map((proposal) =>
            proposal.title ? (
              <Link
                key={proposal.id}
                href={paths.proposal({ projectId, proposalId: proposal.id })}
                data-testid="dependent-future-link"
                data-proposal-id={proposal.id}
              >
                {proposal.title}
              </Link>
            ) : (
              <Alert key={proposal.id} severity="warning">
                Future title unavailable
              </Alert>
            ),
          )}
          <Stack direction="row">
            {offset > 0 && (
              <Button
                onClick={() => setOffset((value) => Math.max(0, value - 20))}
              >
                Previous
              </Button>
            )}
            {pagination?.hasNext && (
              <Button onClick={() => setOffset((value) => value + 20)}>
                Next
              </Button>
            )}
          </Stack>
        </>
      )}
    </Stack>
  );
}
