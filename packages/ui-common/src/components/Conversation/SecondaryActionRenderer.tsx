import { Alert } from "@mui/material";
import { VerifyFeatureAction } from "./SecondaryActions/VerifyFeatureAction";
import { isVerifyFeaturePayload } from "../../types/secondaryActions";
import React from "react";
import type { SuggestionDecisionMetadata, SuggestionType } from "../../api";
import {
  SecondaryActionHandler,
  SuggestionType as SuggestionTypeEnum,
} from "../../api";
import { useSuggestionDecision } from "../../data/hooks/useSuggestionDecision";
import { log } from "../../utils/logger";
import { useConversationContext } from "./Components/ConversationContext";
import { createSecondActionFromAPI } from "./utils/conversationFormHelpers";
import type { UIAction } from "../../types/userTracking";
import type { UITrackingData } from "../../contexts";
import type { UIElement } from "../../api";
import type { FormValue } from "../LlmForms/types";
import { getSecondaryActionBehavior } from "../LlmForms/Registry";
import type {
  SecondaryActionConfigWithHandler,
  SecondaryActionContext,
  SecondaryActionHandlerKey,
  SecondaryActionSubmitOptions,
} from "../LlmForms/Registry/types";
import {
  getSecondaryActionSuggestionId,
  type SuggestionDecisionStatus,
} from "./hooks/useSuggestionDecisions";

const getSuggestionTypeForAction = (
  handler: SecondaryActionHandlerKey
): SuggestionType | null => {
  switch (handler) {
    case SecondaryActionHandler.AdrContentApply:
      return SuggestionTypeEnum.AdrContentApply;
    case SecondaryActionHandler.InitiativeContentApply:
      return SuggestionTypeEnum.InitiativeContentApply;
    case SecondaryActionHandler.TaskContentApply:
      return SuggestionTypeEnum.TaskContentApply;
    case SecondaryActionHandler.TaskGenerationGenerate:
      return SuggestionTypeEnum.TaskGenerationGenerate;
    case SecondaryActionHandler.TaskStubGenerationGenerate:
      return SuggestionTypeEnum.TaskStubGenerationGenerate;
    case SecondaryActionHandler.CompleteOnboarding:
      return SuggestionTypeEnum.CompleteOnboarding;
    case SecondaryActionHandler.CodingPromptAccept:
      return SuggestionTypeEnum.CodingPromptAccept;
    case SecondaryActionHandler.SuggestedAction:
      return SuggestionTypeEnum.SuggestedActionTask;
    case SecondaryActionHandler.RelatedEntities:
      return SuggestionTypeEnum.RelatedEntities;
    default:
      return null;
  }
};

export interface SecondaryActionRendererProps {
  /** The secondary action configuration to render */
  action: SecondaryActionConfigWithHandler;
  /** Context for the action (conversation, project, org IDs, etc.) */
  context: SecondaryActionContext;
  trackUI: (action: UIAction, data: UITrackingData) => void;
  messageId: string;
  handleNext: (
    data: Record<string, FormValue>,
    messageId: string,
    options?: SecondaryActionSubmitOptions
  ) => void;
  formValues: Record<string, FormValue>;
  /** True while the form's answer or another secondary action is in flight. */
  isSubmissionLocked: boolean;
  uiElements: UIElement[];
}

/**
 * SecondaryActionRenderer component maps secondary action handler types
 * to their corresponding UI components.
 *
 * Supported handlers:
 * - adr_content_apply: Renders DesignDocSuggestedContent for ADR suggestions
 * - initiative_content_apply: Renders InitiativeSuggestedContent for Initiative field suggestions
 * - task_content_apply: Renders TaskSuggestedContent for Task field suggestions
 * - next_step: Renders NextStepInfo for informational next step guidance
 * - coding_prompt_accept: Renders CodingPromptSummary for coding prompts
 * - related_entities: Renders RelatedEntities for entity relationships
 * - suggested_action: Renders button that opens modal for task creation or design docs
 * - task_generation_generate: Returns null (not supported as inline component)
 *
 * This component enables rendering multiple secondary actions as inline
 * components before form fields, with handler-specific rendering logic.
 */
export const SecondaryActionRenderer: React.FC<
  SecondaryActionRendererProps
> = ({
  action,
  context,
  trackUI,
  handleNext,
  messageId,
  formValues,
  isSubmissionLocked,
  uiElements,
}) => {
  const { suggestionDecisions } = useConversationContext();
  const decisionMutation = useSuggestionDecision();
  const handler = action.handler;
  const { onExecute } = createSecondActionFromAPI(
    action,
    context,
    trackUI,
    messageId,
    handleNext,
    uiElements
  );

  const suggestionId = getSecondaryActionSuggestionId(messageId, action);
  const suggestionType = getSuggestionTypeForAction(handler);
  const suggestionDecision = suggestionDecisions.getDecision(suggestionId);

  const upsertDecision = (
    decision: SuggestionDecisionStatus,
    metadata?: SuggestionDecisionMetadata
  ) => {
    suggestionDecisions.upsertDecision({
      ...decision,
      metadata: metadata ?? decision.metadata,
    });
  };

  const recordDecision = (
    accepted: boolean,
    metadata?: SuggestionDecisionMetadata
  ) => {
    if (!suggestionId || !suggestionType) {
      return;
    }

    const sourceMessageId = context.messageId ?? messageId;
    if (!context.conversationId || !sourceMessageId) {
      log.warn("ui", "Missing conversation context for suggestion decision", {
        actionId: action.id,
        handler,
        hasConversationId: !!context.conversationId,
        hasMessageId: !!sourceMessageId,
      });
      return;
    }

    const optimisticDecision: SuggestionDecisionStatus = {
      id: suggestionId,
      type: suggestionType,
      accepted,
      decidedBy: null,
      createdAt: new Date().toISOString(),
      sourceConversationId: context.conversationId,
      sourceMessageId,
      metadata,
    };

    upsertDecision(optimisticDecision, metadata);

    decisionMutation
      .mutate({
        organizationId: context.organizationId,
        type: suggestionType,
        suggestionId,
        accepted,
        sourceConversationId: context.conversationId,
        sourceMessageId,
        metadata,
      })
      .then((decision) => {
        upsertDecision(decision);
      })
      .catch((error) => {
        log.error("ui", "Failed to record suggestion decision", {
          actionId: action.id,
          handler,
          error,
        });
      });
  };

  if (handler === SecondaryActionHandler.VerifyFeature) {
    const field = uiElements.find(
      (element) =>
        element.id === action.fieldId && element.type === "verify_feature"
    );
    return field && isVerifyFeaturePayload(field.payload) ? (
      <VerifyFeatureAction check={field.payload} context={context} />
    ) : (
      <Alert severity="error">
        Feature verification details are unavailable.
      </Alert>
    );
  }

  const behavior = getSecondaryActionBehavior({
    handler,
    fieldId: action.fieldId,
    uiElements,
  });

  if (behavior?.render) {
    return behavior.render({
      action,
      context,
      trackUI,
      messageId,
      handleNext,
      formValues,
      isSubmissionLocked,
      onExecute,
      suggestionDecision,
      recordDecision,
    });
  }

  if (behavior) {
    log.warn("ui", "Secondary action handler has no renderer", {
      actionId: action.id,
      handler,
    });
    return null;
  }

  // Unknown handler
  log.warn("ui", "Unknown secondary action handler", {
    actionId: action.id,
    handler,
    availableHandlers: Object.values(SecondaryActionHandler),
  });

  return (
    <Alert severity="info" sx={{ mb: 2 }}>
      Unknown action handler: {handler}
    </Alert>
  );
};
