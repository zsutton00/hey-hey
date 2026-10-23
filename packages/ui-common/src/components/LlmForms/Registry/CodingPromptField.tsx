import { Box, Typography } from "@mui/material";
import isObject from "lodash/isObject.js";
import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  CodingPromptSystemMessageData,
  CodingPromptUserMessage,
} from "../../../api";
import { SmartTextAreaCard } from "../../SmartTextAreaCard";
import { ServiceSelector } from "../../Selectors/ServiceSelector";
import { ImplementationHintsSelector } from "../../Selectors/ImplementationHintsSelector";
import type { FieldComponentProps } from "./types";

export interface CodingPromptFieldProps
  extends Omit<
    FieldComponentProps<
      CodingPromptSystemMessageData | CodingPromptUserMessage
    >,
    "onChange"
  > {
  value?: CodingPromptSystemMessageData | CodingPromptUserMessage;
  onChange?: (value: CodingPromptUserMessage) => void;
}

const isCodingPromptUserMessage = (
  value: CodingPromptSystemMessageData | CodingPromptUserMessage | undefined
): value is CodingPromptUserMessage => {
  if (!value || !isObject(value)) return false;
  return "userMessage" in value && "nextAction" in value;
};

const isCodingPromptSystemMessageData = (
  value: CodingPromptSystemMessageData | CodingPromptUserMessage | undefined
): value is CodingPromptSystemMessageData => {
  if (!value || !isObject(value)) return false;
  return "steps" in value && "outcomes" in value;
};

export const CodingPromptField: React.FC<CodingPromptFieldProps> = ({
  config,
  value,
  onChange,
  error,
  disabled = false,
  isSubmitted = false,
  context,
}) => {
  const { t } = useTranslation();

  const [fieldValue, setFieldValue] = useState<string>(() => {
    if (isCodingPromptUserMessage(value)) {
      return value.userMessage;
    }
    return typeof value === "string" ? value : "";
  });

  const [serviceId, setServiceId] = useState<string | null>(() => {
    if (isCodingPromptUserMessage(value) && value.serviceId) {
      return value.serviceId;
    }
    return null;
  });

  const [selectedHintIds, setSelectedHintIds] = useState<string[]>(() => {
    if (isCodingPromptUserMessage(value) && value.selectedHintIds) {
      return value.selectedHintIds;
    }
    return [];
  });

  useEffect(() => {
    if (isCodingPromptUserMessage(value)) {
      setFieldValue(value.userMessage);
      setServiceId(value.serviceId ?? null);
      setSelectedHintIds(value.selectedHintIds ?? []);
    } else if (typeof value === "string") {
      setFieldValue(value);
    }
  }, [value]);

  // Initialize with empty value on mount to make field optional
  useEffect(() => {
    if (!value) {
      onChange?.({
        userMessage: "",
        type: "CODING_PROMPTS",
        nextAction: "ACCEPT",
        serviceId: undefined,
        selectedHintIds: [],
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleServiceChange = (newServiceId: string | null) => {
    setServiceId(newServiceId);
    // Clear selected hints when service changes
    setSelectedHintIds([]);

    onChange?.({
      userMessage: fieldValue,
      type: "CODING_PROMPTS",
      nextAction: "ACCEPT",
      serviceId: newServiceId ?? undefined,
      selectedHintIds: [],
    });
  };

  const handleHintsChange = (newHintIds: string[]) => {
    setSelectedHintIds(newHintIds);

    onChange?.({
      userMessage: fieldValue,
      type: "CODING_PROMPTS",
      nextAction: "ACCEPT",
      serviceId: serviceId ?? undefined,
      selectedHintIds: newHintIds,
    });
  };

  const handleFeedbackChange = (text: string) => {
    setFieldValue(text);
    onChange?.({
      userMessage: text,
      type: "CODING_PROMPTS",
      nextAction: "ACCEPT",
      serviceId: serviceId ?? undefined,
      selectedHintIds,
    });
  };

  return (
    <Box
      data-testid={`coding-prompt-field-${config.field}`}
      sx={{ display: "flex", flexDirection: "column", gap: 2 }}
    >
      <ServiceSelector
        organizationId={context.organizationId}
        projectId={context.projectId}
        value={serviceId}
        onChange={handleServiceChange}
        disabled={disabled || isSubmitted}
        label={t("coding.serviceLabel", "Service")}
        placeholder={t("coding.servicePlaceholder", "Select a service")}
        helperText={t(
          "coding.serviceHelperText",
          "Optional: Select a service to associate with this coding prompt"
        )}
      />

      {serviceId && (
        <ImplementationHintsSelector
          organizationId={context.organizationId}
          serviceId={serviceId}
          value={selectedHintIds}
          onChange={handleHintsChange}
          disabled={disabled || isSubmitted}
          label={t("coding.hintsLabel", "Implementation Hints")}
          placeholder={t(
            "coding.hintsPlaceholder",
            "Select hints to reference"
          )}
          helperText={t(
            "coding.hintsHelperText",
            "Optional: Select implementation hints to include as context"
          )}
        />
      )}

      {isCodingPromptSystemMessageData(value) && value.steps.length > 0 && (
        <Box>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
            {t("coding.stepsLabel", "Steps")}
          </Typography>
          <Box
            component="ul"
            sx={{
              m: 0,
              pl: 2.5,
              display: "flex",
              flexDirection: "column",
              gap: 0.5,
            }}
          >
            {value.steps.map((step, idx) => (
              <Typography component="li" variant="body1" key={idx}>
                {step}
              </Typography>
            ))}
          </Box>
        </Box>
      )}

      {isCodingPromptSystemMessageData(value) && value.outcomes.length > 0 && (
        <Box>
          <Typography variant="subtitle1" fontWeight={600} sx={{ mb: 0.5 }}>
            {t("coding.outcomesLabel", "Outcomes")}
          </Typography>
          <Box
            component="ul"
            sx={{
              m: 0,
              pl: 2.5,
              display: "flex",
              flexDirection: "column",
              gap: 0.5,
            }}
          >
            {value.outcomes.map((outcome, idx) => (
              <Typography component="li" variant="body1" key={idx}>
                {outcome}
              </Typography>
            ))}
          </Box>
        </Box>
      )}

      <SmartTextAreaCard
        value={fieldValue}
        onChange={handleFeedbackChange}
        mentionConversationId={context.conversationId}
        headerText={config.description}
        placeholder={t(
          "coding.feedbackPlaceholder",
          "Provide feedback or additional context about this coding prompt..."
        )}
        saveStatus={isSubmitted ? "complete" : "draft"}
        saveMode={null}
        isSaving={false}
        hasUnsavedChanges={!isSubmitted}
        disabled={disabled || isSubmitted}
        error={!!error}
        helperText={error}
        minRows={4}
        maxRows={12}
        data-testid="coding-prompt-feedback-textarea"
      />
    </Box>
  );
};
