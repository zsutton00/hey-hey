import { Box, Divider, Stack, Typography } from "@mui/material";
import React from "react";
import { MarkdownRenderer } from "../../shared/MarkdownRenderer";
import type { FieldComponentProps } from "./types";
import {
  buildImplementationReadinessFindingMarkdown,
  isImplementationReadinessPayload,
} from "./implementationReadinessUtils";

export const ImplementationReadinessField: React.FC<FieldComponentProps> = ({
  config,
}) => {
  const readinessPayload = isImplementationReadinessPayload(config.payload)
    ? config.payload
    : null;
  const finding = readinessPayload?.disposition.finding ?? null;

  return (
    <Box
      data-testid="implementation-readiness-field"
      data-field={config.field}
      sx={{
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        p: 2,
        bgcolor: "background.paper",
      }}
    >
      <Stack spacing={2}>
        <Box>
          <Typography variant="h6">Implementation readiness review</Typography>
          <Typography variant="body2" color="text.secondary">
            Resolve the decision below before planning or code-capable work
            continues.
          </Typography>
        </Box>
        <Divider />
        {finding ? (
          <Box data-testid="implementation-readiness-finding">
            <MarkdownRenderer>
              {buildImplementationReadinessFindingMarkdown(finding)}
            </MarkdownRenderer>
          </Box>
        ) : (
          <Typography
            variant="body2"
            color="text.secondary"
            data-testid="implementation-readiness-finding-missing"
          >
            The readiness finding is unavailable.
          </Typography>
        )}
      </Stack>
    </Box>
  );
};
