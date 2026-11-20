import {
  alpha,
  Box,
  Button,
  CircularProgress,
  Tooltip,
  useTheme,
} from "@mui/material";
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
  const needsAttention = button.status?.state === "needs-you";
  const background = needsAttention
    ? alpha(theme.palette.warning.main, 0.18)
    : colors.background;
  const statusColors = {
    running: theme.palette.info.main,
    paused: theme.palette.warning.main,
    "needs-you": theme.palette.warning.main,
    done: theme.palette.success.main,
  };
  const control = (
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
      disabled={button.disabled}
      aria-busy={button.pending || undefined}
      sx={{
        flexShrink: 0,
        minWidth: 52,
        p: 0.5,
        gap: 0.5,
        flexDirection: "column",
        color: "text.primary",
        textTransform: "none",
        whiteSpace: "nowrap",
        "&.Mui-focusVisible": { outline: "2px solid", outlineOffset: 2 },
      }}
    >
      <Box
        component="span"
        data-testid="capsule-screen-button-square"
        sx={{
          position: "relative",
          display: "grid",
          placeItems: "center",
          width: 44,
          height: 44,
          borderRadius: "8px",
          border: "1px solid",
          borderColor: needsAttention
            ? theme.palette.warning.main
            : colors.border,
          bgcolor: background,
          color: needsAttention
            ? theme.palette.warning.main
            : colors.foreground,
        }}
      >
        {button.pending ? (
          <CircularProgress
            color="inherit"
            size={22}
            data-testid="capsule-screen-button-pending"
          />
        ) : Icon ? (
          <Icon sx={{ fontSize: 26 }} />
        ) : (
          button.label
        )}
        {button.status && (
          <>
            <Box
              component="span"
              data-testid="capsule-screen-button-progress"
              sx={{
                position: "absolute",
                bottom: -7,
                right: -10,
                px: 0.5,
                borderRadius: "8px",
                border: "1px solid",
                borderColor: statusColors[button.status.state],
                bgcolor: theme.palette.background.paper,
                color: theme.palette.text.primary,
                fontSize: 10,
                fontWeight: 700,
                lineHeight: "14px",
              }}
            >
              {button.status.text}
            </Box>
            <Box
              component="span"
              aria-hidden
              data-testid="capsule-screen-button-status-dot"
              sx={{
                position: "absolute",
                top: -4,
                right: -4,
                width: 9,
                height: 9,
                borderRadius: "50%",
                bgcolor: statusColors[button.status.state],
              }}
            />
          </>
        )}
      </Box>
      {Icon && (
        <Box
          component="span"
          data-testid="capsule-screen-button-label"
          sx={{ fontSize: 11, fontWeight: 700, lineHeight: 1.2 }}
        >
          {button.label}
        </Box>
      )}
    </Button>
  );
  if (button.tooltip && button.disabled) {
    return (
      <Tooltip title={button.tooltip}>
        <Box component="span" sx={{ display: "inline-flex" }}>
          {control}
        </Box>
      </Tooltip>
    );
  }
  return button.tooltip ? (
    <Tooltip title={button.tooltip}>{control}</Tooltip>
  ) : (
    control
  );
}
