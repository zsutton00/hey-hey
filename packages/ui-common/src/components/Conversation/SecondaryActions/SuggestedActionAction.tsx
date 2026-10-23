import { Box, Button } from "@mui/material";
import React, { useCallback } from "react";
import { useTranslation } from "react-i18next";
import type {
  SuggestedActionPayload,
  SuggestionDecisionMetadata,
} from "../../../api";
import { SuggestedActionNextAction } from "../../../api";
import { unifiedApiClient } from "../../../clients/serviceClients";
import type { UITrackingData } from "../../../contexts";
import { useModalService } from "../../../contexts/ModalService";
import type { UIAction } from "../../../types/userTracking";
import { log } from "../../../utils/logger";
import {
  getSecondaryActionSuggestionId,
  type SuggestionDecisionStatus,
} from "../hooks/useSuggestionDecisions";
import type {
  SecondaryActionConfigWithHandler,
  SecondaryActionContext,
} from "../../LlmForms/Registry/types";
interface SuggestedActionActionProps {
  action: SecondaryActionConfigWithHandler;
  context: SecondaryActionContext;
  messageId: string;
  suggestionDecision?: SuggestionDecisionStatus;
  recordDecision: (
    accepted: boolean,
    metadata?: SuggestionDecisionMetadata,
  ) => void;
  trackUI: (action: UIAction, data: UITrackingData) => void;
}

const getSuggestedActionNextAction = (
  payload: SuggestedActionPayload,
): SuggestedActionNextAction => {
  const normalized = payload.suggestedAction.trim().toLowerCase();
  if (normalized === "generate_design_doc") {
    return SuggestedActionNextAction.GenerateDesignDoc;
  }
  return SuggestedActionNextAction.GenerateTask;
};

export const SuggestedActionAction: React.FC<SuggestedActionActionProps> = ({
  action,
  context,
  messageId,
  suggestionDecision,
  recordDecision,
  trackUI,
}) => {
  const { t } = useTranslation();
  const modalService = useModalService();

  const payload = action.payload as SuggestedActionPayload;

  const actionLabel = payload.suggestedAction.replace(/_/g, " ");
  const isSuggestionAccepted = suggestionDecision?.accepted === true;
  const isSuggestionRejected = suggestionDecision?.accepted === false;
  const generatedLabel = t("conversation.suggestedAction.generated");
  const rejectedLabel = t("conversation.suggestedAction.rejected");
  const suggestionId = getSecondaryActionSuggestionId(messageId, action);

  const nextAction = getSuggestedActionNextAction(payload);

  const handleOpenModal = useCallback(() => {
    if (isSuggestionAccepted || isSuggestionRejected) {
      return;
    }

    if (!modalService || !action.fieldId) {
      log.warn("ui", "Cannot open modal: missing modalService or fieldId", {
        actionId: action.id,
        hasModalService: !!modalService,
        hasFieldId: !!action.fieldId,
      });
      return;
    }

    if (!context.projectId) {
      log.error("ui", "No projectId in context for suggested action", {
        actionId: action.id,
      });
      return;
    }

    if (!suggestionId) {
      log.error("ui", "Missing suggestionId for suggested action", {
        actionId: action.id,
        messageId,
      });
      return;
    }

    if (nextAction === SuggestedActionNextAction.GenerateDesignDoc) {
      if (!context.conversationId || !context.messageId) {
        log.error("ui", "Missing required context for suggested design doc", {
          actionId: action.id,
          hasConversationId: !!context.conversationId,
          hasMessageId: !!context.messageId,
        });
        return;
      }

      modalService.showCreateDocument({
        projectId: context.projectId,
        mode: "suggested_doc",
        sourceConversationId: context.conversationId,
        sourceMessageId: context.messageId,
        suggestionId,
        initialTitle: actionLabel,
        trigger: actionLabel,
        onSuccess: () => {
          recordDecision(true);
        },
      });

      trackUI("button_click", {
        elementType: "button",
        elementText: actionLabel,
        componentName: "SecondaryActionRenderer",
      });

      return;
    }

    modalService.showSuggestedActionTask({
      projectId: context.projectId,
      conversationId: context.conversationId,
      actionLabel,
      nextAction,
      onSubmit: (data) => {
        if (!context.conversationId || !context.messageId) {
          log.error("ui", "Missing required context for suggested task", {
            actionId: action.id,
            hasConversationId: !!context.conversationId,
            hasMessageId: !!context.messageId,
          });
          return;
        }

        recordDecision(true, {
          kind: "CREATE_SUGGESTED_TASK",
        });

        unifiedApiClient
          .generateSuggestedTask({
            organizationId: context.organizationId,
            createSuggestedTaskRequestDto: {
              suggestionId,
              name: data.name,
              projectId: context.projectId,
              initiativeId: data.initiativeId,
              parentTaskId: data.parentTaskId,
              sourceConversationId: context.conversationId,
              sourceMessageId: context.messageId,
              trigger: actionLabel,
            },
          })
          .then((response) => {
            log.info("ui", "Suggested task workflow initiated successfully", {
              actionId: action.id,
              workflowId: response.data.data?.workflowId,
            });
            const workflowId = response.data.data?.workflowId;
            if (workflowId) {
              recordDecision(true, {
                kind: "CREATE_SUGGESTED_TASK",
                workflowId,
              });
            }
            modalService.close();
          })
          .catch((error) => {
            log.error("ui", "Failed to generate suggested task", {
              error,
              actionId: action.id,
            });
          });
      },
    });

    trackUI("button_click", {
      elementType: "button",
      elementText: actionLabel,
      componentName: "SecondaryActionRenderer",
    });
  }, [
    action.fieldId,
    action.id,
    actionLabel,
    context.conversationId,
    context.messageId,
    context.organizationId,
    context.projectId,
    isSuggestionAccepted,
    isSuggestionRejected,
    messageId,
    modalService,
    nextAction,
    recordDecision,
    suggestionId,
    trackUI,
  ]);

  return (
    <Box sx={{ mb: 2 }}>
      <Button
        variant="outlined"
        onClick={handleOpenModal}
        data-testid={`suggested-action-${action.id}`}
        disabled={isSuggestionAccepted || isSuggestionRejected}
      >
        {isSuggestionAccepted
          ? generatedLabel
          : isSuggestionRejected
            ? rejectedLabel
            : actionLabel}
      </Button>
    </Box>
  );
};
