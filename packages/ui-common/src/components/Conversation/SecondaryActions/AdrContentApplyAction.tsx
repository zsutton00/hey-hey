import { Alert, Box } from "@mui/material";
import React from "react";
import type { AdrContentApplyPayload } from "../../../api";
import { DesignDocSuggestedContent } from "../../SuggestedContent/DesignDocSuggestedContent";
import type {
  SecondaryActionConfigWithHandler,
  SecondaryActionContext,
} from "../../LlmForms/Registry/types";
import type { SuggestionDecisionStatus } from "../hooks/useSuggestionDecisions";
import { log } from "../../../utils/logger";

interface AdrContentApplyActionProps {
  action: SecondaryActionConfigWithHandler;
  context: SecondaryActionContext;
  suggestionDecision?: SuggestionDecisionStatus;
  onDecision: (accepted: boolean) => void;
  enableInteractiveDiffReview?: boolean;
}

const isAdrContentPayload = (
  payload: unknown,
): payload is AdrContentApplyPayload => {
  return (
    payload !== null &&
    payload !== undefined &&
    typeof payload === "object" &&
    "handlerType" in payload &&
    (payload as { handlerType: unknown }).handlerType === "adr_content_apply"
  );
};

export const AdrContentApplyAction: React.FC<AdrContentApplyActionProps> = ({
  action,
  context,
  suggestionDecision,
  onDecision,
  enableInteractiveDiffReview,
}) => {
  if (!isAdrContentPayload(action.payload)) {
    log.warn("ui", "Invalid payload for adr_content_apply handler", {
      actionId: action.id,
      handler: action.handler,
      payload: action.payload,
    });
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        Invalid payload for adr_content_apply handler
      </Alert>
    );
  }

  return (
    <Box sx={{ mb: 2 }}>
      <DesignDocSuggestedContent
        secondaryAction={action}
        title={action.label}
        designDocId={context.workflowAboutId}
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
