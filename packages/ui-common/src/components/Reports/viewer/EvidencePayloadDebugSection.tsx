import { Paper, Stack, Typography } from "@mui/material";
import React from "react";
import { usePlatformAdminAccess } from "../../../data/hooks/usePlatformAdminAccess";

export interface EvidencePayloadDebugSectionProps {
  payload: unknown;
}

export const EvidencePayloadDebugSection: React.FC<
  EvidencePayloadDebugSectionProps
> = ({ payload }) => {
  const { isPlatformAdmin } = usePlatformAdminAccess();

  if (!isPlatformAdmin) {
    return null;
  }

  let formatted: string;
  try {
    formatted = JSON.stringify(payload, null, 2);
  } catch {
    formatted = "{}";
  }

  return (
    <Stack
      data-testid="report-viewer-evidence-pipeline-debug-payload"
      spacing={1}
    >
      <Typography variant="subtitle2">Debug Payload</Typography>
      <Paper
        sx={{
          p: 2,
          overflowX: "auto",
          backgroundColor: "background.default",
        }}
        variant="outlined"
      >
        <Typography
          component="pre"
          sx={{ m: 0, whiteSpace: "pre-wrap" }}
          variant="body2"
        >
          {formatted}
        </Typography>
      </Paper>
    </Stack>
  );
};
