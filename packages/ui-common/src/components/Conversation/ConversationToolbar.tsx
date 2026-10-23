import React from "react";
import { Box, IconButton, Tooltip } from "@mui/material";

export interface ToolbarButton {
  /** Unique key for the button */
  key: string;
  /** Accessible label for the button */
  label: string;
  /** Icon to display */
  icon: React.ReactNode;
  /** Click handler */
  onClick: () => void;
  /** Whether the button is disabled */
  disabled?: boolean;
  /** Optional tooltip text (defaults to label) */
  tooltip?: string;
}

export interface ConversationToolbarProps {
  /** Array of button configurations to render */
  buttons: ToolbarButton[];
  /** Optional className for styling */
  className?: string;
}

/**
 * Toolbar component for conversation viewer actions
 * Displays a horizontal row of icon buttons
 */
export const ConversationToolbar: React.FC<ConversationToolbarProps> = ({
  buttons,
  className,
}) => {
  if (!buttons || buttons.length === 0) {
    return null;
  }

  return (
    <Box
      className={className}
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 1,
      }}
    >
      {buttons.map((button) => (
        <Tooltip key={button.key} title={button.tooltip || button.label}>
          <span>
            <IconButton
              aria-label={button.label}
              onClick={button.onClick}
              disabled={button.disabled}
              size="small"
              sx={{
                color: "rgb(60, 114, 160)",
                "&:hover": {
                  backgroundColor: "rgba(60, 114, 160, 0.1)",
                },
              }}
            >
              {button.icon}
            </IconButton>
          </span>
        </Tooltip>
      ))}
    </Box>
  );
};
