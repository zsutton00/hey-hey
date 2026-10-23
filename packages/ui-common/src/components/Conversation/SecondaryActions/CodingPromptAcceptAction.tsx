import { Alert } from "@mui/material";
import React from "react";
import type { SecondaryActionPayload } from "../../../api";
import type { SecondaryActionConfigWithHandler } from "../../LlmForms/Registry/types";
import { CodingPromptSummary } from "./CodingPromptSummary";
import { log } from "../../../utils/logger";

interface CodingPromptAcceptPayload {
  handlerType: "coding_prompt_accept";
  steps: string[];
  outcomes: string[];
}

interface CodingPromptAcceptActionProps {
  action: SecondaryActionConfigWithHandler;
  onAccept: () => void;
}

const isCodingPromptAcceptPayload = (
  payload: SecondaryActionPayload | null | undefined,
): payload is CodingPromptAcceptPayload => {
  return (
    payload !== null &&
    payload !== undefined &&
    typeof payload === "object" &&
    (payload as { handlerType?: string }).handlerType ===
      "coding_prompt_accept" &&
    Array.isArray((payload as { steps?: unknown }).steps) &&
    Array.isArray((payload as { outcomes?: unknown }).outcomes)
  );
};

export const CodingPromptAcceptAction: React.FC<
  CodingPromptAcceptActionProps
> = ({ action, onAccept }) => {
  if (!isCodingPromptAcceptPayload(action.payload)) {
    log.warn("ui", "Invalid payload for coding_prompt_accept handler", {
      actionId: action.id,
      handler: action.handler,
      payload: action.payload,
    });
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        Invalid payload for coding_prompt_accept handler
      </Alert>
    );
  }

  return (
    <CodingPromptSummary
      action={
        action as SecondaryActionConfigWithHandler & {
          payload: {
            handlerType: "coding_prompt_accept";
            productGoal: string;
            productOutcome: string;
            steps: string[];
            outcomes: string[];
          };
        }
      }
      onAccept={onAccept}
    />
  );
};
