import { Box } from "@mui/material";
import type { HelpDemo } from "../../api";

import { MiniDemoPlayer } from "./MiniDemoPlayer";
import { resolvePreset } from "./presetRegistry";

export interface HelpDemoPlayerProps {
  demo: HelpDemo;
}

const assertNever = (value: never): never => {
  throw new Error(`Unsupported help demo kind: ${JSON.stringify(value)}`);
};

export const HelpDemoPlayer: React.FC<HelpDemoPlayerProps> = ({ demo }) => {
  switch (demo.kind) {
    case "preset": {
      const scenes = resolvePreset(demo.presetKey);

      return (
        <Box data-testid="help-demo-player" data-help-demo-id={demo.id}>
          <MiniDemoPlayer scenes={scenes} caption={demo.caption} />
        </Box>
      );
    }
    case "dsl":
      throw new Error("Help demo DSL rendering is not implemented yet.");
    default:
      return assertNever(demo);
  }
};
