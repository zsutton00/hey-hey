import { Box, Button, Tooltip, useTheme } from "@mui/material";
import { AnimatePresence, motion } from "motion/react";
import React from "react";
import type { UIElement } from "../../api";
import { SubmitButton } from "../SubmitButton";
import type { FormValue, SecondAction } from "./types";
import {
  PlanGenerationVisualPreviewApproveHandler,
  PlanGenerationVisualPreviewContinueRevisingHandler,
} from "./Registry/types";

interface DynamicFormButtonProps {
  uiElements: UIElement[];
  hasContent: boolean;
  isSubmitted: boolean;
  secondActions?: SecondAction[];
  onSecondActionExecute?: (
    action: SecondAction,
    formValues: Record<string, FormValue>
  ) => void;
  disabled?: boolean;
  isSubmitting?: boolean;
  showSkeleton: boolean;
  formValues: Record<string, FormValue>;
  showButtons?: boolean;
  hasSecondaryActionInFlight?: boolean;
}

export const DynamicFormButtons: React.FC<DynamicFormButtonProps> = ({
  uiElements,
  secondActions,
  onSecondActionExecute,
  hasContent,
  isSubmitted,
  isSubmitting,
  disabled,
  showSkeleton,
  formValues,
  showButtons = true,
  hasSecondaryActionInFlight = false,
}) => {
  const theme = useTheme();
  const secondaryActionBackgroundColor =
    theme.palette.mode === "dark"
      ? theme.palette.grey[900]
      : theme.palette.common.white;
  const secondaryActionHoverBackgroundColor =
    theme.palette.mode === "dark"
      ? theme.palette.grey[800]
      : theme.palette.grey[50];
  const secondaryActionDisabledBorderColor =
    theme.palette.mode === "dark"
      ? theme.palette.grey[700]
      : theme.palette.grey[300];

  const elementWithSubmitText = uiElements.find(
    (element) => element.submitText
  );

  const visibleActions = secondActions?.filter(
    (action) => action.presentation !== "INLINE"
  );

  const hasVisibleActions = !!visibleActions?.length;
  const hasVisualPreviewReviewActions = visibleActions?.some(
    (action) =>
      action.handler === PlanGenerationVisualPreviewApproveHandler ||
      action.handler === PlanGenerationVisualPreviewContinueRevisingHandler,
  );
  const showContainer =
    !isSubmitted && !showSkeleton && (showButtons || hasVisibleActions);

  return (
    <AnimatePresence>
      {showContainer && (
        <Box
          component={motion.div}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
          data-testid="dynamic-form-btns-cont"
          sx={{
            mt: "8px !important",
            pl: "2px",
            pr: "2px",
            display: "flex",
            gap: 2,
            justifyContent: "flex-start",
          }}
        >
          {/* Second Action Buttons (left side) */}
          {visibleActions?.map((action) => {
            if (action.render) {
              return (
                <React.Fragment key={action.testId || action.label}>
                  {action.render(formValues, {
                    isSubmissionLocked:
                      Boolean(isSubmitting) || hasSecondaryActionInFlight,
                  })}
                </React.Fragment>
              );
            }
            const isContained = action.variant === "contained";
            const availability = action.getAvailability?.(formValues) ?? {
              disabled: false,
            };
            const isActionDisabled =
              action.disabled ||
              availability.disabled ||
              isSubmitting ||
              hasSecondaryActionInFlight;

            const button = (
              <span>
                <Button
                  variant={action.variant || "text"}
                  size="small"
                  onClick={() =>
                    onSecondActionExecute
                      ? onSecondActionExecute(action, formValues)
                      : action.onExecute(formValues)
                  }
                  disabled={isActionDisabled}
                  data-testid={
                    action.testId || "dynamic-form-second-action-button"
                  }
                  startIcon={action.icon}
                  sx={{
                    py: 1.5,
                    px: 2,
                    backgroundColor: isContained
                      ? theme.palette.primary.main
                      : secondaryActionBackgroundColor,
                    color: isContained
                      ? theme.palette.primary.contrastText
                      : theme.palette.text.primary,
                    border: `1px solid ${
                      isContained
                        ? theme.palette.primary.main
                        : theme.palette.actionable.main
                    }`,
                    "&:hover": {
                      backgroundColor: isContained
                        ? theme.palette.primary.dark
                        : secondaryActionHoverBackgroundColor,
                      border: `1px solid ${
                        isContained
                          ? theme.palette.primary.dark
                          : theme.palette.actionable.dark
                      }`,
                    },
                    "&:disabled": {
                      backgroundColor: isContained
                        ? theme.palette.action.disabledBackground
                        : secondaryActionBackgroundColor,
                      color: isContained
                        ? theme.palette.action.disabled
                        : theme.palette.text.disabled,
                      border: `1px solid ${
                        isContained
                          ? theme.palette.action.disabledBackground
                          : secondaryActionDisabledBorderColor
                      }`,
                    },
                  }}
                >
                  {action.label}
                </Button>
              </span>
            );

            return availability.reason && isActionDisabled ? (
              <Tooltip key={action.testId || action.label} title={availability.reason}>
                {button}
              </Tooltip>
            ) : (
              <React.Fragment key={action.testId || action.label}>
                {button}
              </React.Fragment>
            );
          })}
          {/* Primary Action Button (right side) */}
          {showButtons && !hasVisualPreviewReviewActions && (
            <SubmitButton
              type="submit"
              loading={isSubmitting}
              disabled={disabled || !hasContent}
              aria-label={elementWithSubmitText?.submitText || undefined}
            >
              {elementWithSubmitText?.submitText}
            </SubmitButton>
          )}
        </Box>
      )}
    </AnimatePresence>
  );
};
