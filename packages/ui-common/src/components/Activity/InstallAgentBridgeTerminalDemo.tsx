import React from "react";

import { TerminalScene } from "./TerminalScene";

const DEFAULT_INSTALL_COMMAND = "npm install -g @hey-hey/cli";

export interface InstallAgentBridgeTerminalDemoProps {
  command?: string;
}

export const InstallAgentBridgeTerminalDemo: React.FC<
  InstallAgentBridgeTerminalDemoProps
> = ({ command = DEFAULT_INSTALL_COMMAND }) => (
  <TerminalScene
    command={command}
    testIdPrefix="install-agent-bridge-terminal"
  />
);
