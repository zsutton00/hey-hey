import { Alert, Box } from "@mui/material";
import React from "react";
import type { SecondaryActionConfigWithHandler } from "../../LlmForms/Registry/types";
import { NextStepInfo } from "../../SuggestedContent/NextStepInfo";
import { log } from "../../../utils/logger";

/**
 * Type for NextStepPayload (not yet in official API types)
 */
interface NextStepPayload {
  handlerType: "next_step";
  nextStep: string;
}

/**
 * Type guard to check if payload has nextStep property
 */
const hasNextStepProperty = (payload: unknown): payload is NextStepPayload => {
  return (
    payload !== null &&
    payload !== undefined &&
    typeof payload === "object" &&
    "handlerType" in payload &&
    (payload as { handlerType: unknown }).handlerType === "next_step" &&
    "nextStep" in payload &&
    typeof (payload as { nextStep: unknown }).nextStep === "string"
  );
};

interface NextStepActionProps {
  action: SecondaryActionConfigWithHandler;
}

export const NextStepAction: React.FC<NextStepActionProps> = ({ action }) => {
  if (!hasNextStepProperty(action.payload)) {
    log.warn("ui", "Invalid payload for next_step handler", {
      actionId: action.id,
      handler: action.handler,
      payload: action.payload,
    });
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        Invalid payload for next_step handler
      </Alert>
    );
  }

  const payload = action.payload as NextStepPayload;
  return (
    <Box sx={{ mb: 2 }}>
      <NextStepInfo content={payload.nextStep} title={action.label} />
    </Box>
  );
};
