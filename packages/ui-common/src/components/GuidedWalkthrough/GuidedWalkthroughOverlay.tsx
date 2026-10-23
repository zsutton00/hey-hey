import { isGuidableTargetVisible } from "./targetVisibility";
import React, { useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Box, Button, Paper, Typography } from "@mui/material";
import { alpha } from "@mui/material/styles";
import { AutoFixHigh } from "@mui/icons-material";
import {
  CALLOUT_WIDTH,
  computeCalloutPosition,
  type TargetRect,
} from "./calloutPosition";
import type {
  CalloutPlacement,
  GuidedWalkthroughView,
  SuggestionHelperView,
} from "./GuidedWalkthroughRunner";

const HIGHLIGHT_INSET = 4;

/**
 * Measures `element` every frame while it is the active target, so guidance
 * follows it however it moves (scroll, resize, or a sibling growing and
 * pushing it). No event covers every cause of movement, so the position is
 * polled; state only changes when the geometry does.
 */
function useTargetRect(element: HTMLElement | null): TargetRect | null {
  const [rect, setRect] = useState<TargetRect | null>(null);

  useLayoutEffect(() => {
    if (element === null) {
      setRect(null);
      return;
    }
    let frame: number | null = null;
    const measure = () => {
      frame = requestAnimationFrame(measure);
      const { top, left, width, height } = element.getBoundingClientRect();
      if (!isGuidableTargetVisible(element)) {
        setRect(null);
        return;
      }
      setRect((prev) =>
        prev !== null &&
        prev.top === top &&
        prev.left === left &&
        prev.width === width &&
        prev.height === height
          ? prev
          : { top, left, width, height },
      );
    };
    measure();
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
    };
  }, [element]);

  return rect;
}

const ProgressBar: React.FC<{
  title: string;
  stepNumber: number;
  stepCount: number;
  onExit: () => void;
}> = ({ title, stepNumber, stepCount, onExit }) => (
  <Paper
    elevation={4}
    data-testid="guided-walkthrough-bar"
    role="region"
    aria-label={`${title} walkthrough`}
    sx={(theme) => ({
      position: "fixed",
      top: 16,
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: theme.zIndex.modal + 2,
      display: "flex",
      alignItems: "center",
      gap: 1.5,
      pl: 2,
      pr: 1,
      py: 0.5,
      borderRadius: 999,
    })}
  >
    <Typography variant="body2" fontWeight={600}>
      {title}
    </Typography>
    <Typography variant="body2" color="text.secondary">
      Step {stepNumber} of {stepCount}
    </Typography>
    <Typography variant="caption" color="text.secondary">
      Esc to exit
    </Typography>
    <Button size="small" onClick={onExit} data-testid="guided-walkthrough-exit">
      Exit
    </Button>
  </Paper>
);

const Highlight: React.FC<{ rect: TargetRect }> = ({ rect }) => (
  <Box
    aria-hidden
    data-testid="guided-walkthrough-highlight"
    sx={(theme) => ({
      position: "fixed",
      top: rect.top - HIGHLIGHT_INSET,
      left: rect.left - HIGHLIGHT_INSET,
      width: rect.width + HIGHLIGHT_INSET * 2,
      height: rect.height + HIGHLIGHT_INSET * 2,
      border: `2px solid ${theme.palette.primary.main}`,
      borderRadius: 1.5,
      boxShadow: `0 0 0 4px ${theme.palette.primary.main}33`,
      pointerEvents: "none",
      zIndex: theme.zIndex.modal + 1,
    })}
  />
);

const Callout: React.FC<{
  rect: TargetRect;
  placement: CalloutPlacement;
  copy: string;
  suggestion: SuggestionHelperView | null;
}> = ({ rect, placement, copy, suggestion }) => {
  const position = computeCalloutPosition(placement, rect, {
    width: window.innerWidth,
    height: window.innerHeight,
  });
  return (
    <Box
      data-testid="guided-walkthrough-anchor"
      sx={(theme) => ({
        position: "fixed",
        top: position.top,
        left: position.left,
        transform: position.transform,
        width: CALLOUT_WIDTH,
        zIndex: theme.zIndex.modal + 2,
      })}
    >
      <Paper
        elevation={6}
        role="status"
        aria-live="polite"
        data-testid="guided-walkthrough-callout"
        data-placement={position.placement}
        sx={(theme) => ({
          p: 1.5,
          transformOrigin:
            position.placement === "right"
              ? "left center"
              : position.placement === "top"
                ? "center bottom"
                : "center top",
          bgcolor: theme.palette.primary.dark,
          color: theme.palette.primary.contrastText,
          // Preserve the blue surface under dark-mode Paper elevation.
          backgroundImage: "none",
          // The outer anchor retains its positioning transform during scaling.
          animation: `walkthrough-callout-enter 750ms ${theme.transitions.easing.easeOut}`,
          "@keyframes walkthrough-callout-enter": {
            "0%": { opacity: 0, transform: "scale(0.6)" },
            "60%": { opacity: 1, transform: "scale(1.1)" },
            "100%": { opacity: 1, transform: "scale(1)" },
          },
          "@media (prefers-reduced-motion: reduce)": {
            animation: "none",
          },
        })}
      >
        <Typography variant="body2">{copy}</Typography>
        {suggestion !== null && (
          <Box sx={{ mt: 1.5 }}>
            <Box
              data-testid="guided-walkthrough-suggested-prompt"
              sx={(theme) => ({
                p: 1.5,
                borderRadius: 1,
                bgcolor: alpha(theme.palette.common.black, 0.18),
                border: `1px solid ${alpha(
                  theme.palette.primary.contrastText,
                  0.3,
                )}`,
              })}
            >
              <Typography
                variant="caption"
                component="div"
                fontWeight={600}
                sx={{ mb: 0.5 }}
              >
                Suggested prompt
              </Typography>
              <Typography
                variant="body2"
                color="inherit"
                component="blockquote"
                sx={{
                  m: 0,
                  fontStyle: "normal",
                  whiteSpace: "pre-wrap",
                  overflowWrap: "anywhere",
                }}
              >
                {suggestion.text}
              </Typography>
            </Box>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AutoFixHigh />}
              sx={(theme) => ({
                mt: 1,
                color: "inherit",
                borderColor: "currentColor",
                "&:hover": {
                  borderColor: "currentColor",
                  bgcolor: alpha(theme.palette.primary.contrastText, 0.12),
                },
                "&.Mui-focusVisible": {
                  outline: `2px solid ${theme.palette.primary.contrastText}`,
                  outlineOffset: 2,
                },
              })}
              onClick={() => {
                suggestion.accept();
              }}
              data-testid="guided-walkthrough-use-suggestion"
            >
              Use our suggestion
            </Button>
          </Box>
        )}
      </Paper>
    </Box>
  );
};

const EndedMessage: React.FC<{ message: string; onDismiss: () => void }> = ({
  message,
  onDismiss,
}) => (
  <Paper
    elevation={4}
    role="status"
    aria-live="polite"
    data-testid="guided-walkthrough-ended"
    sx={(theme) => ({
      position: "fixed",
      top: 16,
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: theme.zIndex.modal + 2,
      display: "flex",
      alignItems: "center",
      gap: 1.5,
      pl: 2,
      pr: 1,
      py: 0.5,
      borderRadius: 999,
    })}
  >
    <Typography variant="body2">{message}</Typography>
    <Button size="small" onClick={onDismiss}>
      Dismiss
    </Button>
  </Paper>
);

const ActiveGuidance: React.FC<{
  view: Extract<GuidedWalkthroughView, { status: "active" }>;
  onExit: () => void;
}> = ({ view, onExit }) => {
  const rect = useTargetRect(view.target);
  return (
    <>
      {/* Callout first so Tab reaches its helper straight after the target. */}
      {rect !== null && (
        <>
          <Highlight rect={rect} />
          <Callout
            key={view.stepNumber}
            rect={rect}
            placement={view.placement}
            copy={view.copy}
            suggestion={view.suggestion}
          />
        </>
      )}
      <ProgressBar
        title={view.title}
        stepNumber={view.stepNumber}
        stepCount={view.stepCount}
        onExit={onExit}
      />
    </>
  );
};

export interface GuidedWalkthroughOverlayProps {
  view: GuidedWalkthroughView;
  onExit: () => void;
  onDismissMessage: () => void;
}

/**
 * Render-only guidance. Everything is fixed-position so nothing enters page or
 * modal layout, and only the bar and callout take pointer input, never the
 * highlighted control. Inside the followed DiscussModal it portals into the
 * modal's guidance slot so it stays within the Dialog's keyboard boundary.
 */
export const GuidedWalkthroughOverlay: React.FC<
  GuidedWalkthroughOverlayProps
> = ({ view, onExit, onDismissMessage }) => {
  switch (view.status) {
    case "idle":
      return null;
    case "ended":
      return createPortal(
        <EndedMessage message={view.message} onDismiss={onDismissMessage} />,
        document.body,
      );
    case "active":
      return createPortal(
        <ActiveGuidance view={view} onExit={onExit} />,
        view.modalContainer ?? document.body,
      );
  }
};
