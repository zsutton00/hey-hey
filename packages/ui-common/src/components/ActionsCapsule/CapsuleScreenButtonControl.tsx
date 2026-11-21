import {
  Box,
  Button,
  CircularProgress,
  Tooltip,
  useTheme,
} from "@mui/material";
import type { CapsuleScreenButton } from "./types";
import { screenButtonColors } from "./capsuleActionButtonColors";
import {
  CAPSULE_CHIP_PADDING,
  CAPSULE_CHIP_SIZE,
  CAPSULE_ICON_SIZE,
  GRID_CELL_MIN_WIDTH,
  GRID_ICON_CHIP_SIZE,
} from "./capsuleChipSize";

export function CapsuleScreenButtonControl({
  button,
  onClick,
  gridCell = false,
}: {
  button: CapsuleScreenButton;
  onClick: () => void;
  /** Mobile grid cell: same chip size and padding as the round actions there. */
  gridCell?: boolean;
}) {
  const theme = useTheme();
  const colors = screenButtonColors[theme.palette.mode];
  const Icon = button.icon;
  const needsAttention = button.status?.state === "needs-you";
  const background = needsAttention
    ? theme.palette.warning.main
    : colors.background;
  const foreground = needsAttention
    ? theme.palette.warning.contrastText
    : colors.foreground;
  const chipSize = gridCell ? GRID_ICON_CHIP_SIZE : CAPSULE_CHIP_SIZE;
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
        ...(gridCell
          ? { minWidth: GRID_CELL_MIN_WIDTH, padding: "4px 2px", gap: 0.5 }
          : { padding: `${CAPSULE_CHIP_PADDING}px 10px`, gap: 0 }),
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
          boxSizing: "border-box",
          width: chipSize,
          height: chipSize,
          borderRadius: "8px",
          bgcolor: background,
          color: foreground,
        }}
      >
        {button.pending ? (
          <CircularProgress
            color="inherit"
            size={CAPSULE_ICON_SIZE}
            data-testid="capsule-screen-button-pending"
          />
        ) : Icon ? (
          <Icon sx={{ fontSize: CAPSULE_ICON_SIZE }} />
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
          sx={{ fontSize: 12, fontWeight: 700 }}
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
