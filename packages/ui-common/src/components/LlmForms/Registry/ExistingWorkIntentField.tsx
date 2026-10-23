import { Box, ButtonBase, Stack, Typography } from "@mui/material";
import React, { useRef } from "react";
import type { FieldComponentProps } from "./types";

type ExistingWorkIntentChoice = "yes" | "no";

export interface ExistingWorkIntentValue {
  choice: ExistingWorkIntentChoice;
}

const EXISTING_WORK_INTENT_PROMPT =
  "How would you like to setup your project? You can answer questions (this takes 5-10 minutes) and we will generate a bootstrapped set of Features for you. Or can you start your project now, then import your existing service(s) and we'll analyze them for Features";

export const isExistingWorkIntentValue = (
  value: unknown,
): value is ExistingWorkIntentValue =>
  typeof value === "object" &&
  value !== null &&
  "choice" in value &&
  ((value as { choice?: unknown }).choice === "yes" ||
    (value as { choice?: unknown }).choice === "no");

const OPTIONS: Array<{
  choice: ExistingWorkIntentChoice;
  title: string;
  description: string;
}> = [
  {
    choice: "yes",
    title: "Import existing work",
    description:
      "Create your project immediately. After you've completed your local setup, Hey Hey can import your project and help you create your features",
  },
  {
    choice: "no",
    title: "Describe your project",
    description:
      "Hey Hey asks questions and uses your answers to bootstrap your project's initial features.",
  },
];

export type ExistingWorkIntentFieldProps = FieldComponentProps<
  ExistingWorkIntentValue | undefined
>;

export const ExistingWorkIntentField: React.FC<
  ExistingWorkIntentFieldProps
> = ({
  config,
  value,
  onChange,
  error,
  disabled = false,
  isSubmitted = false,
}) => {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const readOnly = disabled || isSubmitted;
  const selectedChoice = isExistingWorkIntentValue(value)
    ? value.choice
    : undefined;

  const selectChoice = (choice: ExistingWorkIntentChoice) => {
    if (readOnly) return;
    onChange?.({ choice });
  };

  const handleKeyDown = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    if (readOnly) return;

    const direction =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;

    if (direction === 0) return;

    event.preventDefault();
    const nextIndex = (index + direction + OPTIONS.length) % OPTIONS.length;
    const nextOption = OPTIONS[nextIndex];
    selectChoice(nextOption.choice);
    optionRefs.current[nextIndex]?.focus();
  };

  return (
    <Stack
      data-testid={`existing-work-intent-field-${config.field}`}
      spacing={1.5}
      sx={{ mb: 2 }}
    >
      <Typography variant="body1" component="h3">
        {EXISTING_WORK_INTENT_PROMPT}
        {config.required && !isSubmitted && " *"}
      </Typography>

      <Box
        role="radiogroup"
        aria-label={EXISTING_WORK_INTENT_PROMPT}
        aria-readonly={isSubmitted || undefined}
        aria-required={config.required || undefined}
        sx={{
          display: "grid",
          gridTemplateColumns: {
            xs: "minmax(0, 1fr)",
            sm: "repeat(2, minmax(0, 1fr))",
          },
          gap: 2,
        }}
      >
        {OPTIONS.map((option, index) => {
          const selected = selectedChoice === option.choice;
          const descriptionId = `existing-work-intent-description-${option.choice}`;

          return (
            <ButtonBase
              key={option.choice}
              ref={(element) => {
                optionRefs.current[index] = element;
              }}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={option.title}
              aria-describedby={descriptionId}
              tabIndex={selected || (!selectedChoice && index === 0) ? 0 : -1}
              disabled={readOnly}
              onClick={() => selectChoice(option.choice)}
              onKeyDown={(event) => handleKeyDown(event, index)}
              sx={{
                display: "block",
                width: "100%",
                p: 2,
                border: "1px solid",
                borderColor: selected ? "primary.main" : "divider",
                borderRadius: 1,
                textAlign: "left",
                bgcolor: selected ? "action.selected" : "background.paper",
                opacity: readOnly && !selected ? 0.72 : 1,
                outline: "none",
                transition:
                  "border-color 120ms ease, background-color 120ms ease",
                "&:hover": readOnly
                  ? undefined
                  : {
                      borderColor: "primary.main",
                      bgcolor: "action.hover",
                    },
                "&:focus-visible": {
                  boxShadow: "0 0 0 3px rgba(25, 118, 210, 0.25)",
                },
              }}
            >
              <Stack spacing={0.75}>
                <Typography variant="subtitle1" fontWeight={600}>
                  {option.title}
                </Typography>
                <Typography
                  id={descriptionId}
                  variant="body2"
                  color="text.secondary"
                >
                  {option.description}
                </Typography>
              </Stack>
            </ButtonBase>
          );
        })}
      </Box>

      {error && (
        <Typography variant="caption" color="error.main">
          {error}
        </Typography>
      )}
    </Stack>
  );
};
