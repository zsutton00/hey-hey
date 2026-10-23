import { Box, Button, Stack, Typography } from "@mui/material";
import React from "react";

import { InstallAgentBridgeTerminalDemo } from "./InstallAgentBridgeTerminalDemo";
import { StepBodyWithDemo } from "./StepBodyWithDemo";
import { WorksWithStrip } from "./WorksWithStrip";

export const INSTALL_AGENT_BRIDGE_COMMAND = "npm install -g @hey-hey/cli";

export const InstallAgentBridgePanel: React.FC = () => (
  <Stack spacing={1.5}>
    <StepBodyWithDemo
      text={
        <Stack spacing={1.5}>
          <Typography variant="body1" color="text.secondary">
            Hey Hey orchestrates a local coding agent on your machine, so you'll
            need one installed.
          </Typography>
          <WorksWithStrip />
        </Stack>
      }
      demo={
        <InstallAgentBridgeTerminalDemo
          command={INSTALL_AGENT_BRIDGE_COMMAND}
        />
      }
    />
    <Box>
      <Button variant="contained" size="small" disabled>
        Download Agent Bridge
      </Button>
    </Box>
  </Stack>
);
