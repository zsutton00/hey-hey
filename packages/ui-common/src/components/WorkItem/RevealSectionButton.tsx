import React from "react";
import { Button, CircularProgress, useTheme } from "@mui/material";
import PlayIcon from "@mui/icons-material/PlayArrow";

export interface RevealSectionButtonProps {
  /** Text to display on the button */
  buttonText: string;
  /** Function to call when button is clicked */
  onReveal: () => Promise<void>;
  /** Whether the button is in a loading state */
  isLoading?: boolean;
  /** Whether the button is disabled */
  disabled?: boolean;
}

export const RevealSectionButton: React.FC<RevealSectionButtonProps> = ({
  buttonText,
  onReveal,
  isLoading = false,
  disabled = false,
}) => {
  const theme = useTheme();

  const handleClick = async (): Promise<void> => {
    if (!disabled && !isLoading) {
      await onReveal();
    }
  };

  return (
    <Button
      variant="text"
      size="small"
      data-testid="reveal-section-button"
      startIcon={
        isLoading ? (
          <CircularProgress size={16} sx={{ color: "rgb(60, 114, 160)" }} />
        ) : (
          <PlayIcon />
        )
      }
      onClick={handleClick}
      disabled={disabled || isLoading}
      sx={{
        mt: 1,
        mb: 1,
        alignSelf: "flex-start",
        textTransform: "none",
        color: "rgb(60, 114, 160)",
        "&:hover": {
          backgroundColor: "rgba(60, 114, 160, 0.1)",
        },
        "&:disabled": {
          color: theme.palette.action.disabled,
        },
      }}
    >
      {isLoading ? "Revealing..." : buttonText}
    </Button>
  );
};
