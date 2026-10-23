import { Alert, Box } from "@mui/material";
import React from "react";
import type { InitiativeContentApplyPayload } from "../../../api";
import { InitiativeSuggestedContent } from "../../SuggestedContent/InitiativeSuggestedContent";
import type {
  SecondaryActionConfigWithHandler,
  SecondaryActionContext,
} from "../../LlmForms/Registry/types";
import type { SuggestionDecisionStatus } from "../hooks/useSuggestionDecisions";
import { log } from "../../../utils/logger";

interface InitiativeContentApplyActionProps {
  action: SecondaryActionConfigWithHandler;
  context: SecondaryActionContext;
  suggestionDecision?: SuggestionDecisionStatus;
  onDecision: (accepted: boolean) => void;
  enableInteractiveDiffReview?: boolean;
}

const isInitiativeContentPayload = (
  payload: unknown,
): payload is InitiativeContentApplyPayload => {
  return (
    payload !== null &&
    payload !== undefined &&
    typeof payload === "object" &&
    "handlerType" in payload &&
    (payload as { handlerType: unknown }).handlerType ===
      "initiative_content_apply"
  );
};

export const InitiativeContentApplyAction: React.FC<
  InitiativeContentApplyActionProps
> = ({
  action,
  context,
  suggestionDecision,
  onDecision,
  enableInteractiveDiffReview,
}) => {
  if (!isInitiativeContentPayload(action.payload)) {
    log.warn("ui", "Invalid payload for initiative_content_apply handler", {
      actionId: action.id,
      handler: action.handler,
      payload: action.payload,
    });
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        Invalid payload for initiative_content_apply handler
      </Alert>
    );
  }

  return (
    <Box sx={{ mb: 2 }}>
      <InitiativeSuggestedContent
        secondaryAction={action}
        title={action.label}
        initiativeId={context.workflowAboutId}
        organizationId={context.organizationId}
        projectId={context.projectId}
        messageId={context.messageId}
        enableInteractiveDiffReview={enableInteractiveDiffReview}
        suggestionDecision={suggestionDecision}
        onDecision={onDecision}
      />
    </Box>
  );
};
