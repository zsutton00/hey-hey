import { Alert, Box } from "@mui/material";
import React from "react";
import { TaskSuggestedContent } from "../../SuggestedContent/TaskSuggestedContent";
import { isTaskContentApplyPayload } from "../../../types/secondaryActions";
import type {
  SecondaryActionConfigWithHandler,
  SecondaryActionContext,
} from "../../LlmForms/Registry/types";
import type { SuggestionDecisionStatus } from "../hooks/useSuggestionDecisions";
import { log } from "../../../utils/logger";

interface TaskContentApplyActionProps {
  action: SecondaryActionConfigWithHandler;
  context: SecondaryActionContext;
  suggestionDecision?: SuggestionDecisionStatus;
  onDecision: (accepted: boolean) => void;
  enableInteractiveDiffReview?: boolean;
}

export const TaskContentApplyAction: React.FC<TaskContentApplyActionProps> = ({
  action,
  context,
  suggestionDecision,
  onDecision,
  enableInteractiveDiffReview,
}) => {
  if (!isTaskContentApplyPayload(action.payload)) {
    log.warn("ui", "Invalid payload for task_content_apply handler", {
      actionId: action.id,
      handler: action.handler,
      payload: action.payload,
    });
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        Invalid payload for task_content_apply handler
      </Alert>
    );
  }

  const payload = action.payload;
  const taskId = context.workflowAboutId;
  const initiativeId = payload.initiativeId;

  if (!taskId || !initiativeId) {
    log.error("ui", "Missing identifiers for task_content_apply handler", {
      actionId: action.id,
      handler: action.handler,
      taskId,
      initiativeId,
    });
    return (
      <Alert severity="warning" sx={{ mb: 2 }}>
        Missing task or initiative identifier for task_content_apply handler
      </Alert>
    );
  }

  return (
    <Box sx={{ mb: 2 }}>
      <TaskSuggestedContent
        secondaryAction={action}
        title={action.label}
        taskId={taskId}
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
