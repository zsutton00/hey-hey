import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogTitle,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import type { FutureApplicationOffer } from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import { reviewedUnappliedOffers } from "../../data/futureOffers/futureOfferCoordinator";
import { useProposal } from "../../data/hooks/useProposal";
import { UpdateProposal } from "../ProposalDispatchers/UpdateProposal";

interface OfferDialogProps {
  organizationId: string;
  projectId: string;
  taskId: string;
  open: boolean;
  onClose: () => void;
}

/** Closing discards only local review state; later completion can offer again. */
export function FutureApplicationOfferDialog(props: OfferDialogProps) {
  return props.open ? <OpenFutureApplicationOfferDialog {...props} /> : null;
}

function OpenFutureApplicationOfferDialog({
  organizationId,
  projectId,
  taskId,
  onClose,
}: OfferDialogProps) {
  const id = useId();
  const [revisions, setRevisions] = useState<FutureApplicationOffer[]>([]);
  const [selected, setSelected] = useState<string>();
  const [applied, setApplied] = useState<Set<string>>(new Set());
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
    staleTime: 0,
  });
  useEffect(() => {
    if (!offers.data) return;
    // Keep revisions applied in this review available for inspection.
    setRevisions((previous) => [
      ...offers.data,
      ...previous.filter(
        (item) =>
          applied.has(item.futureId) &&
          !offers.data.some((next) => next.futureId === item.futureId),
      ),
    ]);
    setSelected((previous) => previous ?? offers.data[0]?.futureId);
    if (!offers.isFetching && offers.data.length === 0 && applied.size === 0)
      onClose();
  }, [offers.data, offers.isFetching, applied, onClose]);
  const active = revisions.some((item) => item.futureId === selected)
    ? selected
    : revisions[0]?.futureId;
  if (
    offers.isPending ||
    (offers.isSuccess && offers.data.length === 0 && applied.size === 0)
  )
    return null;
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth={false}
      fullWidth
      aria-labelledby={`${id}-title`}
      data-testid="future-offer-dialog"
      slotProps={{
        paper: {
          sx: {
            width: "94vw",
            maxWidth: "78rem",
            height: "95dvh",
            maxHeight: "95dvh",
            m: { xs: 1, sm: 2 },
            overflow: "hidden",
          },
        },
      }}
    >
      <DialogTitle id={`${id}-title`}>Review future revisions</DialogTitle>
      <Typography sx={{ px: 3, pb: 2 }} variant="body2">
        Review the complete changes before making them live. Each revision
        applies separately.
      </Typography>
      {offers.error && (
        <Alert severity="error">
          Linked future revisions could not be loaded.
        </Alert>
      )}
      {revisions.length > 1 && (
        <Tabs
          value={active}
          onChange={(_, value: string) => setSelected(value)}
          variant="scrollable"
          scrollButtons="auto"
          selectionFollowsFocus
          aria-label="Future revisions"
          sx={{ flexShrink: 0 }}
        >
          {revisions.map((offer, index) => (
            <Tab
              key={offer.futureId}
              value={offer.futureId}
              id={`${id}-tab-${index}`}
              aria-controls={`${id}-panel-${index}`}
              data-testid="future-offer-tab"
              data-future-id={offer.futureId}
              label={
                <Stack>
                  <span>{offer.proposalTitle}</span>
                  <Typography component="span" variant="caption">
                    {applied.has(offer.futureId)
                      ? "Applied"
                      : offer.applicability.canApply
                        ? "Ready to apply"
                        : "Not ready to apply"}
                  </Typography>
                </Stack>
              }
            />
          ))}
        </Tabs>
      )}
      {revisions.map((offer, index) => (
        <OfferedFuture
          key={offer.futureId}
          {...{ organizationId, projectId, offer }}
          active={offer.futureId === active}
          panelId={`${id}-panel-${index}`}
          tabId={revisions.length > 1 ? `${id}-tab-${index}` : undefined}
          onApplied={async () => {
            setApplied((previous) => new Set([...previous, offer.futureId]));
            await offers.refetch();
          }}
        />
      ))}
      <DialogActions sx={{ flexShrink: 0 }}>
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
  active,
  panelId,
  tabId,
  onApplied,
}: {
  organizationId: string;
  projectId: string;
  offer: FutureApplicationOffer;
  active: boolean;
  panelId: string;
  tabId?: string;
  onApplied: () => Promise<void>;
}) {
  const { proposal, isLoading, error } = useProposal(
    organizationId,
    projectId,
    offer.proposalId,
  );
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  return (
    <Box
      role={tabId ? "tabpanel" : "region"}
      id={panelId}
      aria-labelledby={tabId}
      aria-label={tabId ? undefined : offer.proposalTitle}
      hidden={!active}
      data-testid="future-offer"
      data-future-id={offer.futureId}
      sx={{
        display: active ? "flex" : "none",
        flexDirection: "column",
        minHeight: 0,
        flex: 1,
      }}
    >
      <Box
        sx={{
          overflow: "auto",
          minHeight: 0,
          flex: 1,
          px: { xs: 1, sm: 3 },
          py: 2,
        }}
      >
        {isLoading && (
          <CircularProgress aria-label="Loading revision changes" />
        )}
        {(error || (!isLoading && !proposal)) && (
          <Alert severity="error">Revision changes could not be loaded.</Alert>
        )}
        {proposal && (
          <UpdateProposal
            proposals={[proposal]}
            organizationId={organizationId}
            projectId={projectId}
            renderMode="future-review"
            diffDefaultViewMode="split"
            onApply={async () => {
              throw new Error(
                "Review approval is required before applying this revision",
              );
            }}
            onApplied={onApplied}
            renderFutureFooter={(content) =>
              footer ? createPortal(content, footer) : null
            }
          />
        )}
      </Box>
      <Box
        ref={setFooter}
        data-testid="future-offer-actions"
        sx={{
          flexShrink: 0,
          maxHeight: "40dvh",
          overflow: "auto",
          borderTop: 1,
          borderColor: "divider",
          p: 2,
          "[data-testid=future-review-sequence]": {
            flexWrap: "wrap",
            overflowX: "visible",
            gap: 1,
          },
        }}
      />
    </Box>
  );
}
