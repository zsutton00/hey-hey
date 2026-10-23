import ClockIcon from "@mui/icons-material/AccessTime";
import { Badge, Button, Tooltip, useMediaQuery, useTheme } from "@mui/material";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ActionFeedbackSurface } from "./ActionFeedbackSurface";
import { buttonColors } from "./capsuleActionButtonColors";
import { getFailureIdentityKey } from "../AgentSession/codingSessionFeedback";
import type { CapsuleActionRegistration } from "./types";
import { useGuidableTarget } from "../GuidedWalkthrough/useGuidableTarget";

const actionIconStylesById: Record<string, React.CSSProperties> = {
  search: {
    backgroundColor: "transparent",
    border: "solid 1px currentColor",
  },
  "save-design-doc": {
    backgroundColor: "#2563EB",
    color: "#fff",
  },
  "cancel-design-doc": {
    backgroundColor: "#6B7280",
    color: "#fff",
  },
  "save-adr": {
    backgroundColor: "#2563EB",
    color: "#fff",
  },
  "cancel-adr": {
    backgroundColor: "#6B7280",
    color: "#fff",
  },
  "save-work-item": {
    backgroundColor: "#2563EB",
    color: "#fff",
  },
  "cancel-work-item": {
    backgroundColor: "#6B7280",
    color: "#fff",
  },
};

const COMPACT_BUTTON_MIN_WIDTH = 48;
const COMPACT_ICON_CHIP_SIZE = 40;
const COMPACT_DISCUSS_ICON_SIZE = 18;

export interface CapsuleActionButtonProps {
  /** Action data to display */
  action: CapsuleActionRegistration;
  idx: number;
  /** Whether this action is currently active/expanded */
  isActive: boolean;
  /** Whether any action is currently expanded (to grey out inactive buttons) */
  isAnyExpanded: boolean;
  /** Callback when button is clicked (for actions without menu items) */
  onClick: () => void;
  inProgress?: boolean;
  /** Use the compact sizing required by the mobile toolbar row. */
  compact?: boolean;
}

/**
 * Individual action button displayed in the ActionsCapsule bar
 */
export const CapsuleActionButton: React.FC<CapsuleActionButtonProps> = ({
  action,
  idx,
  isActive,
  isAnyExpanded,
  onClick,
  inProgress,
  compact = false,
}) => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const buttonRef = useRef<HTMLButtonElement>(null);
  useGuidableTarget(action.guidableTarget ?? null, () => buttonRef.current);
  const previousFailureKeyRef = useRef<string | null>(null);
  const [feedbackAnchorEl, setFeedbackAnchorEl] =
    useState<HTMLButtonElement | null>(null);
  const defaultTextColor =
    theme.palette.mode === "dark"
      ? theme.palette.common.white
      : theme.palette.text.primary;
  const disabledTextColor = theme.palette.text.disabled;

  const feedback = action.feedback;
  // Keep an action with recoverable feedback interactive even while another
  // capsule action is expanded, so the user can reach its explanation.
  const isGreyedOut = isAnyExpanded && !isActive && !feedback;
  const isDisabled = Boolean(action.disabled) && !feedback;
  const isSaveAction = action.id.startsWith("save-");
  const preserveIconChipWhenDisabled =
    isSaveAction && isDisabled && !isGreyedOut;
  const failureKey = feedback
    ? getFailureIdentityKey(feedback.failureIdentity)
    : null;

  useEffect(() => {
    if (failureKey === null) {
      previousFailureKeyRef.current = null;
      setFeedbackAnchorEl(null);
      return;
    }

    if (
      previousFailureKeyRef.current !== null &&
      previousFailureKeyRef.current !== failureKey
    ) {
      setFeedbackAnchorEl(buttonRef.current);
    }
    previousFailureKeyRef.current = failureKey;
  }, [failureKey]);

  const handleButtonClick = useCallback(() => {
    if (feedback) {
      setFeedbackAnchorEl(buttonRef.current);
      return;
    }
    onClick();
  }, [feedback, onClick]);

  const iconStyleFromId = actionIconStylesById[action.id];
  const colorStyle: React.CSSProperties = action.iconStyle ??
    iconStyleFromId ?? {
      backgroundColor: isActive ? "#888" : buttonColors[idx],
    };
  const hasIconBackground =
    colorStyle.backgroundColor !== undefined &&
    colorStyle.backgroundColor !== "transparent";
  const iconColor =
    colorStyle.color ??
    (hasIconBackground ? theme.palette.common.white : defaultTextColor);
  const actionTextColor = action.textColor ?? defaultTextColor;
  const isCompactDiscuss = compact && action.id === "discuss";

  const Icon = action.icon ? (
    <action.icon
      sx={{
        color: iconColor,
        ...(isCompactDiscuss && { fontSize: COMPACT_DISCUSS_ICON_SIZE }),
      }}
    />
  ) : undefined;

  const button = (
    <Button
      ref={buttonRef}
      variant="outlined"
      size="medium"
      startIcon={Icon}
      aria-label={compact ? action.label : undefined}
      onClick={handleButtonClick}
      disabled={isDisabled || isGreyedOut}
      aria-busy={feedback?.isRetrying || undefined}
      sx={{
        textTransform: "none",
        flexDirection: "column",
        ...(compact
          ? {
              minWidth: COMPACT_BUTTON_MIN_WIDTH,
              minHeight: 48,
              padding: 0,
            }
          : {
              padding: "8px 10px",
            }),
        position: "relative",
        color: isDisabled ? disabledTextColor : actionTextColor,
        border: "none",
        outline: "none",
        fontSize: "12px",
        whiteSpace: "nowrap",
        maxWidth: 80,
        overflow: "hidden",
        textOverflow: "ellipsis",
        "&.Mui-disabled": {
          color: disabledTextColor,
          ...(preserveIconChipWhenDisabled && { opacity: 1 }),
        },
        ...(isGreyedOut && {
          opacity: 0.5,
        }),
        "& .MuiButton-startIcon": {
          display: "grid",
          placeItems: "center",
          lineHeight: 0,
          marginLeft: "0px",
          marginRight: "0px",
          padding: compact ? 0 : "8px",
          borderRadius: "50%",
          ...(compact && {
            width: COMPACT_ICON_CHIP_SIZE,
            height: COMPACT_ICON_CHIP_SIZE,
          }),
          ...colorStyle,
          ...(preserveIconChipWhenDisabled && {
            opacity: 0.85,
            filter: "saturate(0.9)",
          }),
        },
        "& .MuiButton-startIcon .MuiSvgIcon-root": {
          color: iconColor,
          display: "block",
        },
        "&.Mui-disabled .MuiButton-startIcon .MuiSvgIcon-root": {
          ...(preserveIconChipWhenDisabled && {
            color: iconColor,
          }),
        },
        "& .MuiButton-endIcon": {
          marginLeft: "0",
          marginRight: "0",
          marginTop: "-6px",
        },
      }}
      data-testid={`capsule-action-${action.id}`}
    >
      {inProgress && (
        <ClockIcon
          sx={{
            position: "absolute",
            top: "-4px",
            right: "8px",
            color: "#555",
            fontSize: "16px",
          }}
        />
      )}
      {!compact && action.label}
    </Button>
  );

  const buttonWithTooltip = feedback ? (
    <Tooltip title={feedback.reason}>{button}</Tooltip>
  ) : (
    button
  );

  const buttonWithBadge =
    action.badge !== undefined ? (
      <Badge
        badgeContent={action.badge}
        color="primary"
        sx={{
          "& .MuiBadge-badge": {
            transform: "translate(-8px, 8px)",
          },
        }}
      >
        {buttonWithTooltip}
      </Badge>
    ) : (
      buttonWithTooltip
    );

  return (
    <>
      {buttonWithBadge}
      {feedback ? (
        <ActionFeedbackSurface
          actionId={action.id}
          actionLabel={action.label}
          anchorEl={feedbackAnchorEl}
          feedback={feedback}
          mobile={isMobile}
          onClose={() => setFeedbackAnchorEl(null)}
        />
      ) : null}
    </>
  );
};
