import { Box, Stack, Typography } from "@mui/material";
import React, { useEffect, useMemo, useRef } from "react";
import { SmarterTextAreaCard } from "../../SmarterTextAreaCard";
import {
  createPlanShapingFeatureSyncReviewValue,
  normalizePlanShapingFeatureSyncReviewValue,
} from "./planShapingFeatureSyncReviewUtils";
import type { FieldComponentProps } from "./types";
import type { PlanShapingFeatureSyncReviewValue } from "./types";
import { WorkflowReviewAction } from "../../../api";

export type PlanShapingFeatureSyncReviewFieldProps =
  FieldComponentProps<PlanShapingFeatureSyncReviewValue>;

export const PlanShapingFeatureSyncReviewField: React.FC<
  PlanShapingFeatureSyncReviewFieldProps
> = ({
  config,
  context,
  value,
  onChange,
  onSubmit,
  disabled = false,
  isSubmitted = false,
}) => {
  const fallbackValue = useMemo(
    () => createPlanShapingFeatureSyncReviewValue(),
    []
  );

  const hasSeededInitialValueRef = useRef(false);

  const normalizedValue = useMemo(
    () => normalizePlanShapingFeatureSyncReviewValue(value ?? fallbackValue),
    [value, fallbackValue]
  );

  useEffect(() => {
    if (hasSeededInitialValueRef.current) {
      return;
    }
    if (value !== undefined || !onChange) {
      return;
    }

    onChange(fallbackValue);
    hasSeededInitialValueRef.current = true;
  }, [fallbackValue, onChange, value]);

  const isLocked = disabled || isSubmitted;
  const feedback =
    normalizedValue.action ===
    WorkflowReviewAction.Refine
      ? normalizedValue.payload.feedback
      : "";

  const handleFeedbackChange = (feedback: string) => {
    onChange?.({
      action: WorkflowReviewAction.Refine,
      payload: { feedback },
    });
  };

  return (
    <Stack
      spacing={2}
      data-testid={`plan-shaping-feature-sync-review-${config.field}`}
    >
      <Typography variant="body2" color="text.secondary">
        {config.description}
        {config.required && (
          <Typography component="span" color="error.main" sx={{ ml: 0.5 }}>
            *
          </Typography>
        )}
      </Typography>

      {(!isSubmitted || feedback.length > 0) && (
        <Box>
          <SmarterTextAreaCard
            value={feedback}
            onChange={handleFeedbackChange}
            placeholder={
              config.placeholder ??
              "Add feedback for the flagged items, then select Revise..."
            }
            disabled={isLocked}
            mentionConversationId={context.conversationId}
            saveStatus="draft"
            saveMode={null}
            hasUnsavedChanges={false}
            minRows={3}
            onSubmit={isLocked ? undefined : onSubmit}
          />
        </Box>
      )}
    </Stack>
  );
};
