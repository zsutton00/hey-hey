import React, { useEffect, useState, useRef } from "react";
import {
  Box,
  Paper,
  Typography,
  Button,
  IconButton,
  LinearProgress,
  Portal,
  Backdrop,
  useTheme,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import { useTranslation } from "react-i18next";
import {
  useWalkthrough,
  type WalkthroughStep,
} from "../../hooks/useWalkthrough";
import {
  useWalkthroughContext,
  WalkthroughType,
} from "../../contexts/WalkthroughContext";

export interface InitiativeEditorWalkthroughProps {
  /** Whether to auto-start the walkthrough for first-time users */
  autoStart?: boolean;
  /** Callback when walkthrough starts */
  onStart?: () => void;
  /** Callback when walkthrough finishes */
  onFinish?: () => void;
  /** The type of walkthrough to listen for triggers */
  walkthroughType?: WalkthroughType;
}

// Define walkthrough steps
const createWalkthroughSteps = (
  t: (key: string) => string
): WalkthroughStep[] => [
  {
    id: "welcome",
    title: t("walkthrough.welcome.title"),
    content: t("walkthrough.welcome.content"),
    position: "bottom",
    showSkipButton: true,
  },
  {
    id: "description-section",
    title: t("walkthrough.description.title"),
    content: t("walkthrough.description.content"),
    targetSelector: "[data-section-id='description']",
    position: "right",
  },
  {
    id: "skeleton-sections",
    title: t("walkthrough.skeleton.title"),
    content: t("walkthrough.skeleton.content"),
    targetSelector: "[data-section-id='details']",
    position: "right",
  },
  {
    id: "reveal-buttons",
    title: t("walkthrough.reveal.title"),
    content: t("walkthrough.reveal.content"),
    targetSelector: "[data-testid='reveal-section-button']",
    position: "top",
  },
  {
    id: "chat-interface",
    title: t("walkthrough.chat.title"),
    content: t("walkthrough.chat.content"),
    targetSelector: "[data-testid='conversation-viewer']",
    position: "left",
    isLastStep: true,
  },
  // {
  //   id: "save-options",
  //   title: t("walkthrough.save.title"),
  //   content: t("walkthrough.save.content"),
  //   targetSelector: "[data-testid='save-buttons']",
  //   position: "top",
  //   isLastStep: true,
  // },
];

interface PopoverPosition {
  top: number;
  left: number;
  maxWidth: number;
}

export const InitiativeEditorWalkthrough: React.FC<
  InitiativeEditorWalkthroughProps
> = ({
  autoStart = true,
  onStart,
  onFinish,
  walkthroughType = WalkthroughType.INITIATIVE_EDITOR,
}) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const { isTriggered } = useWalkthroughContext();
  const [popoverPosition, setPopoverPosition] =
    useState<PopoverPosition | null>(null);
  const [highlightPosition, setHighlightPosition] = useState<DOMRect | null>(
    null
  );
  const walkthroughSteps = createWalkthroughSteps(t);
  const positionUpdateRef = useRef<number>(-1);

  const {
    isActive,
    currentStep,
    isFirstStep,
    isLastStep,
    nextStep,
    previousStep,
    finishWalkthrough,
    startWalkthrough,
  } = useWalkthrough({
    walkthroughKey: "initiative-editor",
    steps: walkthroughSteps,
    autoStart,
  });

  // Handle external restart trigger from context
  useEffect(() => {
    if (isTriggered(walkthroughType)) {
      startWalkthrough();
    }
  }, [isTriggered, walkthroughType, startWalkthrough]);

  // Update popover position when step changes
  useEffect(() => {
    if (!isActive || !currentStep) {
      setPopoverPosition(null);
      setHighlightPosition(null);
      return;
    }

    const updatePosition = (): void => {
      let targetElement: Element | null = null;

      if (currentStep.targetSelector) {
        targetElement = document.querySelector(currentStep.targetSelector);
      }

      if (targetElement) {
        const rect = targetElement.getBoundingClientRect();
        setHighlightPosition(rect);

        let popoverTop = rect.top;
        let popoverLeft = rect.left;
        const popoverWidth = 400;

        // Adjust position based on desired placement
        switch (currentStep.position) {
          case "top":
            popoverTop = rect.top - 20;
            popoverLeft = rect.left + (rect.width - popoverWidth) / 2;
            break;
          case "bottom":
            popoverTop = rect.bottom + 20;
            popoverLeft = rect.left + (rect.width - popoverWidth) / 2;
            break;
          case "left":
            popoverTop = rect.top + (rect.height - 200) / 2;
            popoverLeft = rect.left - popoverWidth - 20;
            break;
          case "right":
            popoverTop = rect.top + (rect.height - 200) / 2;
            popoverLeft = rect.right + 20;
            break;
          default:
            popoverTop = rect.bottom + 20;
            popoverLeft = rect.left;
        }

        // Keep popover within viewport bounds
        const viewport = {
          width: window.innerWidth,
          height: window.innerHeight,
        };

        popoverLeft = Math.max(
          20,
          Math.min(popoverLeft, viewport.width - popoverWidth - 20)
        );
        popoverTop = Math.max(20, Math.min(popoverTop, viewport.height - 250));

        setPopoverPosition({
          top: popoverTop,
          left: popoverLeft,
          maxWidth: popoverWidth,
        });
      } else {
        // Center the popover if no target element
        setHighlightPosition(null);
        setPopoverPosition({
          top: window.innerHeight / 2 - 150,
          left: window.innerWidth / 2 - 200,
          maxWidth: 400,
        });
      }
    };

    // Update position immediately and on resize/scroll
    updatePosition();

    const handlePositionUpdate = (): void => {
      if (positionUpdateRef.current) {
        cancelAnimationFrame(positionUpdateRef.current);
      }
      positionUpdateRef.current = requestAnimationFrame(updatePosition);
    };

    window.addEventListener("resize", handlePositionUpdate);
    window.addEventListener("scroll", handlePositionUpdate, true);

    return () => {
      window.removeEventListener("resize", handlePositionUpdate);
      window.removeEventListener("scroll", handlePositionUpdate, true);
      if (positionUpdateRef.current) {
        cancelAnimationFrame(positionUpdateRef.current);
      }
    };
  }, [isActive, currentStep]);

  // Handle callbacks
  useEffect(() => {
    if (isActive && onStart) {
      onStart();
    }
  }, [isActive, onStart]);

  const handleFinish = (): void => {
    finishWalkthrough();
    if (onFinish) {
      onFinish();
    }
  };

  if (!isActive || !currentStep || !popoverPosition) {
    return null;
  }

  const progressPercent =
    ((walkthroughSteps.findIndex((s) => s.id === currentStep.id) + 1) /
      walkthroughSteps.length) *
    100;

  return (
    <Portal>
      {/* Backdrop with highlight cutout */}
      <Backdrop
        open={true}
        sx={{
          backgroundColor: "rgba(0, 0, 0, 0.5)",
          zIndex: theme.zIndex.modal + 1,
        }}
      >
        {/* Highlight spotlight */}
        {highlightPosition && (
          <Box
            sx={{
              position: "absolute",
              top: highlightPosition.top - 8,
              left: highlightPosition.left - 8,
              width: highlightPosition.width + 16,
              height: highlightPosition.height + 16,
              backgroundColor: "transparent",
              border: `2px solid ${theme.palette.primary.main}`,
              borderRadius: 2,
              boxShadow: `0 0 0 4px rgba(25, 118, 210, 0.3)`,
              animation: "pulse 2s infinite",
              "@keyframes pulse": {
                "0%": { boxShadow: `0 0 0 4px rgba(25, 118, 210, 0.3)` },
                "50%": { boxShadow: `0 0 0 8px rgba(25, 118, 210, 0.1)` },
                "100%": { boxShadow: `0 0 0 4px rgba(25, 118, 210, 0.3)` },
              },
            }}
          />
        )}

        {/* Walkthrough popover */}
        <Paper
          elevation={8}
          sx={{
            position: "absolute",
            top: popoverPosition.top,
            left: popoverPosition.left,
            maxWidth: popoverPosition.maxWidth,
            width: popoverPosition.maxWidth,
            p: 4,
            zIndex: theme.zIndex.modal + 2,
            borderRadius: 2,
          }}
        >
          {/* Header */}
          <Box sx={{ display: "flex", alignItems: "flex-start", mb: 3 }}>
            <Box sx={{ flexGrow: 1 }}>
              <Typography variant="h6" component="h3" sx={{ mb: 1 }}>
                {currentStep.title}
              </Typography>
              <LinearProgress
                variant="determinate"
                value={progressPercent}
                sx={{ height: 4, borderRadius: 2 }}
              />
            </Box>
            <IconButton
              size="small"
              onClick={handleFinish}
              sx={{ ml: 2, mt: -0.5 }}
            >
              <CloseIcon />
            </IconButton>
          </Box>

          {/* Content */}
          <Typography variant="body2" sx={{ mb: 4, lineHeight: 1.6 }}>
            {currentStep.content}
          </Typography>

          {/* Navigation */}
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Button
              variant="text"
              startIcon={<ArrowBackIcon />}
              onClick={previousStep}
              disabled={isFirstStep}
              size="small"
            >
              {t("walkthrough.navigation.previous")}
            </Button>

            <Box sx={{ display: "flex", gap: 1 }}>
              {currentStep.showSkipButton && (
                <Button variant="text" onClick={handleFinish} size="small">
                  {t("walkthrough.navigation.skip")}
                </Button>
              )}

              <Button
                variant="contained"
                endIcon={isLastStep ? null : <ArrowForwardIcon />}
                startIcon={isLastStep ? <PlayArrowIcon /> : null}
                onClick={isLastStep ? handleFinish : nextStep}
                size="small"
              >
                {isLastStep
                  ? t("walkthrough.navigation.finish")
                  : t("walkthrough.navigation.next")}
              </Button>
            </Box>
          </Box>

          {/* Step indicator */}
          <Typography
            variant="caption"
            sx={{
              position: "absolute",
              top: -8,
              right: 12,
              backgroundColor: theme.palette.primary.main,
              color: theme.palette.primary.contrastText,
              px: 1,
              py: 0.25,
              borderRadius: 1,
              fontSize: "0.75rem",
            }}
          >
            {walkthroughSteps.findIndex((s) => s.id === currentStep.id) + 1} of{" "}
            {walkthroughSteps.length}
          </Typography>
        </Paper>
      </Backdrop>
    </Portal>
  );
};
