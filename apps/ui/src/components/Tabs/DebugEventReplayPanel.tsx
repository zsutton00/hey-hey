import { useModalState } from "@hey-hey/ui-common/components/Modals";
import { FunctionalDialog as Dialog } from "@hey-hey/ui-common/components/Modals";
import { DebugEventReplayMode } from "@hey-hey/ui-common/api";
import { useDebugEventReplay, useOutboxEvents } from "@hey-hey/ui-common/data";
import {
  Alert,
  Button,
  CircularProgress,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Stack,
  Typography,
} from "@mui/material";
import React, { useEffect, useMemo, useState } from "react";
import { DebugEventReplayResult } from "./DebugEventReplayResult";

export interface DebugEventReplayPanelProps {
  entityId: string;
  entityType: string;
  projectId: string;
}

const modeLabels: Record<DebugEventReplayMode, string> = {
  [DebugEventReplayMode.ValidateOnly]: "Validate only",
  [DebugEventReplayMode.ReemitOriginal]: "Re-emit original",
  [DebugEventReplayMode.AttemptFixAndReemit]: "Attempt fix and re-emit",
};

export const DebugEventReplayPanel: React.FC<DebugEventReplayPanelProps> = ({
  entityId,
  entityType,
  projectId,
}) => {
  const {
    data: outboxData,
    error: outboxError,
    events,
    isLoading: isOutboxLoading,
  } = useOutboxEvents(entityType, entityId);
  const {
    data: replayData,
    error: replayError,
    isPending: isReplayPending,
    replay,
  } = useDebugEventReplay({ entityId, entityType });
  const [selectedEventId, setSelectedEventId] = useState("");
  const [mode, setMode] = useState<DebugEventReplayMode>(
    DebugEventReplayMode.ValidateOnly,
  );
  const [confirmOpen, setConfirmOpen, confirmOpenOwnerKey] =
    useModalState(false);

  useEffect(() => {
    if (events.length === 0) {
      setSelectedEventId("");
      return;
    }

    setSelectedEventId((currentEventId) =>
      events.some((event) => event.id === currentEventId)
        ? currentEventId
        : events[0].id,
    );
  }, [events]);

  const selectedEvent = useMemo(
    () => events.find((event) => event.id === selectedEventId),
    [events, selectedEventId],
  );

  const submitReplay = async (): Promise<void> => {
    setConfirmOpen(false);
    if (!selectedEventId) {
      return;
    }

    try {
      await replay({
        eventId: selectedEventId,
        mode,
        projectId,
      });
    } catch {
      // The hook exposes the request failure for inline rendering.
    }
  };

  const handleRun = (): void => {
    if (mode === DebugEventReplayMode.ValidateOnly) {
      void submitReplay();
      return;
    }

    setConfirmOpen(true);
  };

  return (
    <Stack data-testid="debug-event-replay-panel" spacing={2}>
      <Paper sx={{ p: 2 }}>
        <Stack spacing={2}>
          <Stack spacing={0.5}>
            <Typography variant="h6">Event replay</Typography>
            <Typography color="text.secondary" variant="body2">
              Validate or re-emit an outbox event without changing its source
              row.
            </Typography>
          </Stack>

          {isOutboxLoading ? (
            <Stack alignItems="center" py={2}>
              <CircularProgress size={24} />
            </Stack>
          ) : outboxError ? (
            <Alert severity="error">{outboxError.message}</Alert>
          ) : !outboxData || events.length === 0 ? (
            <Alert severity="info">
              No outbox events are available for this entity.
            </Alert>
          ) : (
            <Stack direction={{ md: "row", xs: "column" }} spacing={2}>
              <FormControl fullWidth size="small">
                <InputLabel id="debug-event-replay-event-label">
                  Event
                </InputLabel>
                <Select
                  label="Event"
                  labelId="debug-event-replay-event-label"
                  onChange={(event) => setSelectedEventId(event.target.value)}
                  value={selectedEventId}
                >
                  {events.map((event) => (
                    <MenuItem key={event.id} value={event.id}>
                      {event.eventType} · {event.status}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <FormControl fullWidth size="small">
                <InputLabel id="debug-event-replay-mode-label">
                  Operation
                </InputLabel>
                <Select
                  label="Operation"
                  labelId="debug-event-replay-mode-label"
                  onChange={(event) =>
                    setMode(event.target.value as DebugEventReplayMode)
                  }
                  value={mode}
                >
                  {Object.values(DebugEventReplayMode).map((option) => (
                    <MenuItem key={option} value={option}>
                      {modeLabels[option]}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
              <Button
                disabled={!selectedEvent || isReplayPending}
                onClick={handleRun}
                startIcon={
                  isReplayPending ? <CircularProgress size={16} /> : undefined
                }
                variant="contained"
              >
                {isReplayPending ? "Running…" : "Run"}
              </Button>
            </Stack>
          )}

          {replayError ? (
            <Alert severity="error">{replayError.message}</Alert>
          ) : null}
        </Stack>
      </Paper>

      {replayData ? (
        <Stack spacing={1.5}>
          <Stack
            alignItems={{ sm: "center", xs: "flex-start" }}
            direction={{ sm: "row", xs: "column" }}
            justifyContent="space-between"
            spacing={1}
          >
            <Typography variant="subtitle1">Replay results</Typography>
            <Typography color="text.secondary" variant="body2">
              {replayData.total} result{replayData.total === 1 ? "" : "s"}
              {replayData.truncated ? " · response truncated" : ""}
            </Typography>
          </Stack>
          {replayData.results.map((result) => (
            <DebugEventReplayResult
              key={result.originalEventId}
              result={result}
            />
          ))}
        </Stack>
      ) : null}

      <Dialog
        ownerKey={confirmOpenOwnerKey}
        onClose={() => setConfirmOpen(false)}
        open={confirmOpen}
      >
        <DialogTitle>Confirm event replay</DialogTitle>
        <DialogContent>
          This will call “{modeLabels[mode]}” for the selected event and may
          queue a fresh PENDING replay copy with a distinct identity. The source
          event and payload remain unchanged.
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          <Button onClick={() => void submitReplay()} variant="contained">
            Confirm
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  );
};
