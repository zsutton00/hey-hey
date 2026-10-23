import type { DebugEventReplayResultDto } from "@hey-hey/ui-common/api";
import { Alert, Chip, Paper, Stack, Typography } from "@mui/material";
import React from "react";

export interface DebugEventReplayResultProps {
  result: DebugEventReplayResultDto;
}

const resultChipColor = (
  result: DebugEventReplayResultDto,
): "default" | "error" | "success" | "warning" => {
  if (result.error || result.queueStatus === "FAILED") {
    return "error";
  }

  if (result.queueStatus === "QUEUED") {
    return "success";
  }

  if (result.validationStatus === "INVALID") {
    return "warning";
  }

  return "default";
};

export const DebugEventReplayResult: React.FC<DebugEventReplayResultProps> = ({
  result,
}) => (
  <Paper data-testid="debug-event-replay-result" sx={{ p: 2 }} variant="outlined">
    <Stack spacing={1}>
      <Stack
        alignItems={{ sm: "center", xs: "flex-start" }}
        direction={{ sm: "row", xs: "column" }}
        justifyContent="space-between"
        spacing={1}
      >
        <Typography variant="subtitle2">{result.eventType}</Typography>
        <Chip
          color={resultChipColor(result)}
          label={result.queueStatus}
          size="small"
        />
      </Stack>
      <Typography color="text.secondary" variant="body2">
        Validation: {result.validationStatus} · Fix: {result.fixStatus}
      </Typography>
      <Typography sx={{ overflowWrap: "anywhere" }} variant="body2">
        Original event: {result.originalEventId}
      </Typography>
      {result.replayEventId ? (
        <Typography sx={{ overflowWrap: "anywhere" }} variant="body2">
          Replay event: {result.replayEventId}
        </Typography>
      ) : null}
      {result.error ? <Alert severity="error">{result.error}</Alert> : null}
    </Stack>
  </Paper>
);
