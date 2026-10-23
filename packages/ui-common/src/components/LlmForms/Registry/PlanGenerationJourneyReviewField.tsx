import { Alert, Box, Chip, Paper, Stack, Typography } from "@mui/material";
import React, { useEffect, useMemo, useRef } from "react";
import type {
  JourneyMap,
  JourneyStep,
  ServiceNote,
} from "../../../api";
import { SmarterTextAreaCard } from "../../SmarterTextAreaCard";
import {
  createPlanGenerationJourneyReviewValue,
  normalizePlanGenerationJourneyReviewValue,
} from "./planGenerationJourneyReviewUtils";
import { PLAN_PROPOSAL_BORDER } from "../../ProposalDispatchers/proposalRenderOverrides";
import type { FieldComponentProps } from "./types";
import type { PlanGenerationJourneyReviewValue } from "./types";

export type PlanGenerationJourneyReviewFieldProps =
  FieldComponentProps<PlanGenerationJourneyReviewValue>;

const isJourneyMapPayload = (value: unknown): value is JourneyMap => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  return Array.isArray((value as { steps?: unknown }).steps);
};

const extractJourneyMap = (payload: unknown): JourneyMap | undefined => {
  if (isJourneyMapPayload(payload)) {
    return payload;
  }
  if (
    typeof payload === "object" &&
    payload !== null &&
    "journeyMap" in payload
  ) {
    const inner = (payload as { journeyMap?: unknown }).journeyMap;
    if (isJourneyMapPayload(inner)) {
      return inner;
    }
  }
  return undefined;
};

const JourneyPhaseReviewCard: React.FC<{ step: JourneyStep }> = ({ step }) => (
  <Paper
    data-testid={`plan-generation-journey-review-phase-card-${step.id}`}
    elevation={0}
    variant="outlined"
    sx={{
      p: 2,
      width: "100%",
      display: "flex",
      flexDirection: "column",
      gap: 1.25,
      border: PLAN_PROPOSAL_BORDER,
      boxSizing: "border-box",
    }}
  >
    <Stack direction="row" spacing={1} alignItems="flex-start">
      <Typography variant="subtitle1" sx={{ fontWeight: 600, flex: 1 }}>
        {step.title}
      </Typography>
      {step.isUserInteractive && (
        <Chip
          data-testid={`plan-generation-journey-review-validation-badge-${step.id}`}
          label="Validation"
          size="small"
          color="primary"
          variant="outlined"
        />
      )}
    </Stack>

    <Typography variant="body2" color="text.secondary">
      {step.description}
    </Typography>

    {step.implementationNotes.length > 0 && (
      <Box
        data-testid={`plan-generation-journey-review-breakdowns-${step.id}`}
        sx={{
          pl: 2.5,
        }}
      >
        <Box
          component="ul"
          sx={{
            listStyle: "disc",
            pl: 2.5,
            m: 0,
            display: "flex",
            flexDirection: "column",
            gap: 0.5,
          }}
        >
          {step.implementationNotes.map((note, index) => (
            <JourneyBreakdownBullet
              key={`${step.id}-note-${index}`}
              note={note}
            />
          ))}
        </Box>
      </Box>
    )}
  </Paper>
);

const JourneyBreakdownBullet: React.FC<{ note: ServiceNote }> = ({ note }) => (
  <Box component="li">
    <Stack direction="row" spacing={1} alignItems="baseline" flexWrap="wrap">
      <Typography variant="body2" sx={{ flex: 1 }}>
        {note.text}
      </Typography>
      {note.serviceName !== null && (
        <Chip
          label={note.serviceName}
          size="small"
          variant="outlined"
          sx={{ height: 20 }}
        />
      )}
    </Stack>
  </Box>
);

export const PlanGenerationJourneyReviewField: React.FC<
  PlanGenerationJourneyReviewFieldProps
> = ({
  config,
  context,
  value,
  onChange,
  disabled = false,
  isSubmitted = false,
}) => {
  const payloadJourneyMap = useMemo(
    () => extractJourneyMap(config.payload),
    [config.payload]
  );

  const fallbackValue = useMemo(
    () => createPlanGenerationJourneyReviewValue(payloadJourneyMap),
    [payloadJourneyMap]
  );

  const hasSeededInitialValueRef = useRef(false);

  const normalizedValue = useMemo(
    () =>
      normalizePlanGenerationJourneyReviewValue(
        value ?? fallbackValue,
        fallbackValue
      ),
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
      payload: { ...normalizedValue.payload, feedback },
    });
  };

  return (
    <Stack
      spacing={2}
      data-testid={`plan-generation-journey-review-${config.field}`}
    >
      <Stack data-testid="plan-generation-journey-review-phases" spacing={1.5}>
        {normalizedValue.payload.journeyMap.steps.map((step) => (
          <JourneyPhaseReviewCard key={step.id} step={step} />
        ))}
      </Stack>
      <Alert severity="warning" variant="filled">
        Review these steps carefully — small details can have large effects on
        the final plan.
      </Alert>
      {(!isSubmitted || normalizedValue.payload.feedback.length > 0) && (
        <Box>
          <SmarterTextAreaCard
            value={normalizedValue.payload.feedback}
            onChange={handleFeedbackChange}
            placeholder={
              config.placeholder ??
              "Add notes for revising the journey, or leave empty to approve as-is..."
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
