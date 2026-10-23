import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import { Box, IconButton, Stack } from "@mui/material";
import React, { useState } from "react";

const TERMINAL_WIDTH = 520;
const TERMINAL_HEIGHT = 168;

const WINDOW_DOT_COLORS = ["#ff5f57", "#febc2e", "#28c840"] as const;

export interface TerminalSceneProps {
  /** Command displayed inside the terminal. */
  command: string;
  /** Optional output displayed beneath the command. */
  output?: string;
  /**
   * Stable id used to namespace the data-testid hooks rendered by this scene.
   * Callers pass a prefix (e.g. "install-agent-bridge-terminal") so tests can
   * scope to a specific terminal without coupling to the primitive.
   */
  testIdPrefix: string;
}

export const TerminalScene: React.FC<TerminalSceneProps> = ({
  command,
  output,
  testIdPrefix,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(command).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Box
      data-testid={testIdPrefix}
      sx={{
        width: TERMINAL_WIDTH,
        maxWidth: "100%",
        minHeight: TERMINAL_HEIGHT,
        borderRadius: 1.5,
        overflow: "hidden",
        backgroundColor: "#1e1f23",
        boxShadow: 3,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Stack
        direction="row"
        spacing={0.75}
        alignItems="center"
        data-testid={`${testIdPrefix}-chrome`}
        sx={{
          px: 1.5,
          py: 1,
          backgroundColor: "#2b2d31",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
        }}
      >
        {WINDOW_DOT_COLORS.map((color) => (
          <Box
            key={color}
            sx={{
              width: 12,
              height: 12,
              borderRadius: "50%",
              backgroundColor: color,
            }}
          />
        ))}
        <Box sx={{ flex: 1 }} />
        <IconButton
          size="small"
          onClick={handleCopy}
          data-testid={`${testIdPrefix}-copy`}
          aria-label="Copy command"
          sx={{ color: "rgba(255,255,255,0.5)", p: 0.5 }}
        >
          {copied ? (
            <CheckCircleIcon sx={{ fontSize: 16, color: "#5cd770" }} />
          ) : (
            <ContentCopyIcon sx={{ fontSize: 16 }} />
          )}
        </IconButton>
      </Stack>
      <Box
        sx={{
          flex: 1,
          px: 2,
          py: 1.5,
          fontFamily:
            '"SFMono-Regular", "Menlo", "Monaco", "Consolas", "Liberation Mono", "Courier New", monospace',
          fontSize: "0.875rem",
          lineHeight: 1.5,
          color: "#e6e6e6",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
        }}
      >
        <Box
          component="span"
          sx={{ color: "#5cd770", mr: 1 }}
          data-testid={`${testIdPrefix}-prompt`}
        >
          $
        </Box>
        <Box component="span" data-testid={`${testIdPrefix}-command`}>
          {command}
        </Box>
        {output ? (
          <Box sx={{ mt: 1.5 }} data-testid={`${testIdPrefix}-output`}>
            {output}
          </Box>
        ) : null}
      </Box>
    </Box>
  );
};
