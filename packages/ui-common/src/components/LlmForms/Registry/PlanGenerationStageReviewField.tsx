import { Box, Stack, Typography } from "@mui/material";
import React, { useMemo } from "react";
import { SmarterTextAreaCard } from "../../SmarterTextAreaCard";
import {
  createPlanGenerationStageReviewValue,
  normalizePlanGenerationStageReviewValue,
} from "./planGenerationStageReviewUtils";
import type { FieldComponentProps } from "./types";
import type { PlanGenerationStageReviewValue } from "./types";

export type PlanGenerationStageReviewFieldProps =
  FieldComponentProps<PlanGenerationStageReviewValue>;

export const PlanGenerationStageReviewField: React.FC<
  PlanGenerationStageReviewFieldProps
> = ({
  config,
  context,
  value,
  onChange,
  disabled = false,
  isSubmitted = false,
}) => {
  const fallbackValue = useMemo(
    () => createPlanGenerationStageReviewValue(),
    []
  );

  const normalizedValue = useMemo(
    () => normalizePlanGenerationStageReviewValue(value ?? fallbackValue),
    [value, fallbackValue]
  );

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
      data-testid={`plan-generation-stage-review-${config.field}`}
    >
      <Typography variant="body2" color="text.secondary">
        {config.description}
        {config.required && (
          <Typography component="span" color="error.main" sx={{ ml: 0.5 }}>
            *
          </Typography>
        )}
      </Typography>

      {(!isSubmitted || normalizedValue.payload.feedback.length > 0) && (
        <Box>
          <SmarterTextAreaCard
            value={normalizedValue.payload.feedback}
            onChange={handleFeedbackChange}
            placeholder={
              config.placeholder ??
              "Add any notes or revision requests for the plan stages..."
            }
            disabled={isLocked}
            mentionConversationId={context.conversationId}
            saveStatus="draft"
            saveMode={null}
            hasUnsavedChanges={false}
            minRows={3}
          />
        </Box>
      )}

    </Stack>
  );
};
