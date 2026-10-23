import { Box, Stack, Typography } from "@mui/material";
import React from "react";

import { ClaudeCodeIcon, CodexIcon } from "./providerIcons";

export const WorksWithStrip: React.FC = () => (
  <Stack spacing={1}>
    <Stack direction="row" spacing={2} alignItems="center">
      <Stack direction="row" spacing={0.75} alignItems="center">
        <Box sx={{ fontSize: "1.25rem", lineHeight: 0 }}>
          <ClaudeCodeIcon />
        </Box>
        <Typography variant="caption" color="text.secondary">
          Claude Code
        </Typography>
      </Stack>
      <Stack direction="row" spacing={0.75} alignItems="center">
        <Box sx={{ fontSize: "1.25rem", lineHeight: 0 }}>
          <CodexIcon />
        </Box>
        <Typography variant="caption" color="text.secondary">
          Codex
        </Typography>
      </Stack>
    </Stack>
    <Typography variant="caption" color="text.secondary">
      Agent Bridge runs alongside your installed, authenticated Claude Code
      executable. It relays task context, progress, and completions to Hey Hey;
      Claude keeps control of its native login and token lifecycle.
    </Typography>
  </Stack>
);
