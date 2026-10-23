import React from "react";

import { TerminalScene } from "./TerminalScene";

const PAIR_COMMAND = "heyhey pair";
const PAIR_OUTPUT = `Pair this machine in your browser.

Code: ABC-123

Open: http://localhost:5173/pairing?code=ABC-123`;

export const HeyheyPairTerminalDemo: React.FC = () => (
  <TerminalScene
    command={PAIR_COMMAND}
    output={PAIR_OUTPUT}
    testIdPrefix="heyhey-pair-terminal"
  />
);
