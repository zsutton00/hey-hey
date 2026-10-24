import { useEffect } from "react";
import { reviewedUnappliedOffers } from "../../data/futureOffers/futureOfferCoordinator";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from "@mui/material";
import type { FutureApplicationOffer } from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import { FutureApplication } from "./FutureApplication";
import { FutureProposalLink } from "./FutureProposalLink";

/**
 * Offered after a work item reaches VERIFYING or COMPLETED. Declining keeps no
 * state, so a later transition offers any still-unapplied futures again.
 */
export function FutureApplicationOfferDialog({
  organizationId,
  projectId,
  taskId,
  open,
  onClose,
}: {
  organizationId: string;
  projectId: string;
  taskId: string;
  open: boolean;
  onClose: () => void;
}) {
  const offers = useQuery({
    queryKey: ["proposal-future-offers", organizationId, projectId, taskId],
    queryFn: async () => {
      const result = await proposalsClient.listProposalFutureOffers({
        organizationId,
        projectId,
        dependencyTaskId: taskId,
      });
      if (!result.data.data)
        throw new Error("Future offer response is missing");
      return reviewedUnappliedOffers(result.data.data);
    },
    enabled: open,
    staleTime: 0,
  });
  useEffect(() => {
    if (
      open &&
      offers.isSuccess &&
      !offers.isFetching &&
      offers.data.length === 0
    )
      onClose();
  }, [open, offers.isSuccess, offers.isFetching, offers.data, onClose]);
  if (!open) return null;
  if (offers.error)
    return (
      <Alert severity="warning" onClose={onClose}>
        Linked future revisions could not be loaded.
      </Alert>
    );
  if (!offers.data?.length) return null;
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      data-testid="future-offer-dialog"
    >
      <DialogTitle>
        Apply {offers.data.length} linked{" "}
        {offers.data.length === 1 ? "future" : "futures"}?
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2">
            Review the linked future revisions below. Each one shows whether it
            is ready to apply. Nothing changes until you choose Apply.
          </Typography>
          {offers.data.map((offer) => (
            <OfferedFuture
              key={offer.futureId}
              {...{ organizationId, projectId, offer }}
              onApplied={async () => {
                await offers.refetch();
              }}
            />
          ))}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button data-testid="future-offer-dismiss" onClick={onClose}>
          Not now
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function OfferedFuture({
  organizationId,
  projectId,
  offer,
  onApplied,
}: {
  organizationId: string;
  projectId: string;
  offer: FutureApplicationOffer;
  onApplied: () => Promise<void>;
}) {
  const future = useQuery({
    queryKey: [
      "proposal-future",
      organizationId,
      projectId,
      offer.futureId,
      offer.applicability.revision,
    ],
    queryFn: async () => {
      const result = await proposalsClient.getProposalFuture({
        organizationId,
        projectId,
        futureId: offer.futureId,
      });
      if (!result.data.data) throw new Error("Future unavailable");
      return result.data.data;
    },
  });
  return (
    <Stack
      spacing={1}
      data-testid="future-offer"
      data-future-id={offer.futureId}
    >
      <FutureProposalLink
        {...{ organizationId, projectId }}
        proposalId={offer.proposalId}
      />
      {future.error && <Alert severity="error">{future.error.message}</Alert>}
      {future.data && (
        <FutureApplication future={future.data} onApplied={onApplied} />
      )}
    </Stack>
  );
}
