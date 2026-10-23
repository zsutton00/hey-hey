import PauseCircleOutlineIcon from "@mui/icons-material/PauseCircleOutline";
import {
  Badge,
  Box,
  Collapse,
  Typography,
  type SxProps,
  type Theme,
} from "@mui/material";
import { useState } from "react";
import { AgentSessionCurrentState } from "../../api";
import { ThinkingText } from "../Conversation/Components/ThinkingText";
import {
  getActivitySpinnerSx,
  getSubtleActivityIconSx,
} from "../shared/SubtleActivityIcon";
import { getAgentSessionCurrentStatePresentation } from "./agentSessionCurrentStatePresentation";

export interface AgentSessionCurrentStateIndicatorProps {
  currentState: AgentSessionCurrentState | undefined;
  presentation: "animated" | "icon";
  sx?: SxProps<Theme>;
}

const INDICATOR_TEST_ID = "agent-session-current-state-indicator";

const getIndicatorSx = (sx: SxProps<Theme> | undefined): SxProps<Theme> => [
  {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: "text.secondary",
  },
  ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
];

const renderAnimatedActionableState = (
  currentState: AgentSessionCurrentState,
  label: string,
) => {
  if (currentState === AgentSessionCurrentState.AwaitingApproval) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 1,
          color: "text.secondary",
        }}
      >
        <PauseCircleOutlineIcon
          data-testid="agent-session-current-state-approval-icon"
          sx={{ fontSize: 48 }}
        />
        <Typography
          component="span"
          data-testid="agent-session-current-state-label"
          variant="caption"
          sx={{ fontWeight: 700, lineHeight: 1, whiteSpace: "nowrap" }}
        >
          {label}
        </Typography>
      </Box>
    );
  }

  return (
    <Typography
      component="span"
      data-testid="agent-session-current-state-label"
      variant="caption"
      sx={{
        color: "text.secondary",
        fontWeight: 700,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </Typography>
  );
};

const renderIcon = (
  currentState: AgentSessionCurrentState,
  presentation: ReturnType<typeof getAgentSessionCurrentStatePresentation>,
) => {
  const StateIcon = presentation.Icon;

  const icon = (
    <StateIcon
      aria-hidden="true"
      data-activity={presentation.activity}
      data-animation={presentation.iconAnimation}
      data-testid="agent-session-current-state-icon"
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
  );

  if (currentState !== AgentSessionCurrentState.PlanReady) {
    return icon;
  }

  return (
    <Badge
      aria-hidden="true"
      badgeContent={1}
      color="warning"
      overlap="rectangular"
      sx={{
        "& .MuiBadge-badge": {
          border: 1.5,
          borderColor: "background.paper",
          fontSize: 8,
          fontWeight: 700,
          height: 13,
          lineHeight: 1,
          minWidth: 13,
          p: 0,
        },
      }}
    >
      {icon}
    </Badge>
  );
};

const isVisibleState = (
  currentState: AgentSessionCurrentState | undefined,
): currentState is AgentSessionCurrentState => {
  if (!currentState) {
    return false;
  }
  const presentation = getAgentSessionCurrentStatePresentation(currentState);
  return presentation.isActive || presentation.isActionable;
};

export const AgentSessionCurrentStateIndicator = ({
  currentState,
  presentation: presentationMode,
  sx,
}: AgentSessionCurrentStateIndicatorProps) => {
  const visible = isVisibleState(currentState);
  // Keep rendering the last visible state while the collapse animates out.
  const [lastVisibleState, setLastVisibleState] = useState(
    visible ? currentState : undefined,
  );
  if (visible && currentState !== lastVisibleState) {
    setLastVisibleState(currentState);
  }

  if (presentationMode === "icon") {
    return visible ? (
      <IndicatorContent
        currentState={currentState}
        presentationMode={presentationMode}
        sx={sx}
      />
    ) : null;
  }

  const renderedState = visible ? currentState : lastVisibleState;
  return (
    <Collapse
      in={visible}
      appear
      unmountOnExit
      timeout={INDICATOR_COLLAPSE_TIMEOUT_MS}
      onExited={() => setLastVisibleState(undefined)}
      // Collapse renders block wrappers; re-center the inline-flex indicator
      // the way its flex parents did before it was wrapped.
      sx={{
        width: "100%",
        "& .MuiCollapse-wrapperInner": {
          display: "flex",
          justifyContent: "center",
        },
      }}
    >
      {renderedState ? (
        <IndicatorContent
          currentState={renderedState}
          presentationMode={presentationMode}
          sx={sx}
        />
      ) : null}
    </Collapse>
  );
};

const INDICATOR_COLLAPSE_TIMEOUT_MS = 150;

const IndicatorContent = ({
  currentState,
  presentationMode,
  sx,
}: {
  currentState: AgentSessionCurrentState;
  presentationMode: AgentSessionCurrentStateIndicatorProps["presentation"];
  sx: SxProps<Theme> | undefined;
}) => {
  const presentation = getAgentSessionCurrentStatePresentation(currentState);

  return (
    <Box
      aria-label={presentation.ariaLabel}
      aria-live="polite"
      data-actionable={String(presentation.isActionable)}
      data-active={String(presentation.isActive)}
      data-current-state={currentState}
      data-presentation={presentationMode}
      data-testid={INDICATOR_TEST_ID}
      sx={getIndicatorSx(sx)}
    >
      {presentationMode === "icon" ? (
        renderIcon(currentState, presentation)
      ) : presentation.isActive ? (
        <ThinkingText
          currentState={currentState}
          text={presentation.label}
          sx={{ marginTop: 0, marginBottom: 0 }}
        />
      ) : (
        renderAnimatedActionableState(currentState, presentation.label)
      )}
    </Box>
  );
};
