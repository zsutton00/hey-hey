import { Box, Button, Stack, Typography } from "@mui/material";
import React, { useMemo } from "react";
import type { MultipleChoiceAction, MultipleChoicePayload } from "../../../api";
import type { FieldComponentProps } from "./types";

export interface MultipleChoiceFieldProps
  extends Omit<FieldComponentProps<MultipleChoiceAction>, "onChange"> {
  value?: MultipleChoiceAction;
  onChange?: (value: MultipleChoiceAction) => void;
}

const isMultipleChoicePayload = (
  payload: unknown
): payload is MultipleChoicePayload =>
  payload !== null &&
  typeof payload === "object" &&
  "options" in payload &&
  Array.isArray((payload as MultipleChoicePayload).options);

export const MultipleChoiceField: React.FC<MultipleChoiceFieldProps> = ({
  config,
  value,
  onChange,
  error,
  disabled = false,
  isSubmitted = false,
}) => {
  const payload = config.payload;
  const options = useMemo(
    () => (isMultipleChoicePayload(payload) ? payload.options : []),
    [payload]
  );

  if (options.length === 0) {
    return (
      <Box data-testid={`multiple-choice-field-${config.field}`} sx={{ mb: 2 }}>
        <Typography color="error.main">
          No branching options were provided.
        </Typography>
      </Box>
    );
  }

  const handleSelect = (action: MultipleChoiceAction) => {
    if (disabled || isSubmitted) {
      return;
    }
    onChange?.(action);
  };

  return (
    <Stack
      data-testid={`multiple-choice-field-${config.field}`}
      spacing={1.5}
      sx={{ mb: 2 }}
    >
      {config.description && (
        <Typography color="text.primary" variant="body1">
          {config.description}
        </Typography>
      )}

      {options.map((option) => {
        const isSelected = value === option.action;
        return (
          <Box
            key={option.action}
            sx={{
              border: "1px solid",
              borderColor: isSelected ? "primary.main" : "divider",
              borderRadius: 1,
              p: 1.5,
            }}
          >
            <Button
              data-testid={`multiple-choice-option-${option.action}`}
              variant={isSelected ? "contained" : "outlined"}
              onClick={() => handleSelect(option.action)}
              disabled={disabled || isSubmitted}
              fullWidth
              sx={{
                justifyContent: "flex-start",
                textTransform: "none",
                fontWeight: 600,
                mb: 1,
              }}
            >
              {option.title}
            </Button>
            <Typography color="text.secondary" variant="body2">
              {option.description}
            </Typography>
          </Box>
        );
      })}

      {error && (
        <Typography color="error.main" variant="caption">
          {error}
        </Typography>
      )}
    </Stack>
  );
};
