import { Box, type SxProps, type Theme } from "@mui/material";
import { ConversationPhase } from "../../../api";
import {
  getActivitySpinnerSx,
  getSubtleActivityIconSx,
} from "../../shared/SubtleActivityIcon";
import { getConversationPhasePresentation } from "./conversationPhasePresentation";

export interface ConversationPhaseIndicatorProps {
  phase: ConversationPhase | undefined;
  sx?: SxProps<Theme>;
}

export const ConversationPhaseIndicator = ({
  phase,
  sx,
}: ConversationPhaseIndicatorProps) => {
  if (!phase || phase === ConversationPhase.Idle) return null;

  const presentation = getConversationPhasePresentation(phase);
  const PhaseIcon = presentation.Icon;

  return (
    <Box
      aria-label={presentation.ariaLabel}
      aria-live="polite"
      data-active={String(presentation.isActive)}
      data-phase={phase}
      data-testid="conversation-phase-indicator"
      sx={[
        {
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          color: "text.secondary",
          flexShrink: 0,
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      <PhaseIcon
        aria-hidden="true"
        data-testid="conversation-phase-icon"
        viewBox={presentation.iconViewBox}
        sx={
          presentation.iconAnimation === "rotation"
            ? getActivitySpinnerSx()
            : presentation.iconAnimation === "opacity"
              ? (theme) => ({
                  color: theme.palette.info.main,
                  ...getSubtleActivityIconSx(theme),
                })
              : undefined
        }
      />
    </Box>
  );
};
