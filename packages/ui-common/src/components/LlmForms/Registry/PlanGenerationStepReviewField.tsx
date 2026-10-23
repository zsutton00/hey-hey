import { Box, Stack, Typography } from "@mui/material";
import React, { useEffect, useMemo, useRef } from "react";
import { SmarterTextAreaCard } from "../../SmarterTextAreaCard";
import {
  createPlanGenerationStepReviewValue,
  normalizePlanGenerationStepReviewValue,
} from "./planGenerationStepReviewUtils";
import type { FieldComponentProps } from "./types";
import type { PlanGenerationStepReviewValue } from "./types";

export type PlanGenerationStepReviewFieldProps =
  FieldComponentProps<PlanGenerationStepReviewValue>;

export const PlanGenerationStepReviewField: React.FC<
  PlanGenerationStepReviewFieldProps
> = ({
  config,
  context,
  value,
  onChange,
  disabled = false,
  isSubmitted = false,
}) => {
  const fallbackValue = useMemo(
    () => createPlanGenerationStepReviewValue(),
    []
  );

  const hasSeededInitialValueRef = useRef(false);

  const normalizedValue = useMemo(
    () => normalizePlanGenerationStepReviewValue(value ?? fallbackValue),
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

  const handleFeedbackChange = (feedback: string) => {
    onChange?.({
      ...normalizedValue,
      payload: { feedback },
    });
  };

  return (
    <Stack
      spacing={2}
      data-testid={`plan-generation-step-review-${config.field}`}
    >
      <Typography variant="body2" color="text.secondary">
        {config.description}
        {config.required && (
          <Typography component="span" color="error.main" sx={{ ml: 0.5 }}>
            *
          </Typography>
        )}
      </Typography>

      <Box>
        <SmarterTextAreaCard
          value={normalizedValue.payload.feedback}
          onChange={handleFeedbackChange}
          placeholder={
            config.placeholder ??
            "Add any notes or revision requests for the plan steps..."
          }
          disabled={isLocked}
          mentionConversationId={context.conversationId}
          saveStatus="draft"
          saveMode={null}
          hasUnsavedChanges={false}
          minRows={3}
        />
      </Box>
    </Stack>
  );
};
