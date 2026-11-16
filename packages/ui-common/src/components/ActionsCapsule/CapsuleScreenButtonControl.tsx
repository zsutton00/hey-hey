import { Box, Button, useTheme } from "@mui/material";
import type { CapsuleScreenButton } from "./types";
import { screenButtonColors } from "./capsuleActionButtonColors";

export function CapsuleScreenButtonControl({
  button,
  onClick,
}: {
  button: CapsuleScreenButton;
  onClick: () => void;
}) {
  const theme = useTheme();
  const colors = screenButtonColors[theme.palette.mode];
  const Icon = button.icon;
  const statusColors = {
    running: theme.palette.info.main,
    paused: theme.palette.warning.main,
    "needs-you": theme.palette.warning.main,
    done: theme.palette.success.main,
  };
  return (
    <Button
      data-testid="capsule-screen-button"
      data-screen-key={button.key}
      aria-label={button.accessibleName}
      aria-description={
        button.status
          ? [button.status.state, button.status.text].filter(Boolean).join(" ")
          : undefined
      }
      onClick={onClick}
      sx={{
        flexShrink: 0,
        minWidth: 44,
        width: 44,
        height: 44,
        p: 0.5,
        borderRadius: "6px",
        border: "1px solid",
        borderColor: colors.border,
        bgcolor: colors.background,
        color: colors.foreground,
        flexDirection: "column",
        fontSize: 10,
        textTransform: "none",
        whiteSpace: "nowrap",
        "&:hover": { bgcolor: colors.background },
        "&.Mui-focusVisible": { outline: "2px solid", outlineOffset: 2 },
      }}
    >
      {Icon ? <Icon fontSize="small" /> : button.label}
      {Icon && button.label}
      {button.status && (
        <Box
          component="span"
          sx={{ display: "flex", gap: 0.5, alignItems: "center" }}
        >
          <Box
            component="span"
            aria-hidden
            sx={{
              width: 6,
              height: 6,
              borderRadius: "50%",
              bgcolor: statusColors[button.status.state],
            }}
          />
          {button.status.text}
        </Box>
      )}
    </Button>
  );
}
