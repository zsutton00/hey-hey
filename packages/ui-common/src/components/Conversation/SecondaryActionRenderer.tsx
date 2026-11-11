import { Alert, Button, Stack } from "@mui/material";
import { useQueryClient } from "@tanstack/react-query";
import { ProjectTopologyViewSessionButton } from "../shared/ProjectTopologyButton";
import { conversationKeys } from "../../data/collections/conversations";
import { VerifyFeatureAction } from "./SecondaryActions/VerifyFeatureAction";
import { isVerifyFeaturePayload } from "../../types/secondaryActions";
import React, { useState } from "react";
import type { SuggestionDecisionMetadata, SuggestionType } from "../../api";
import {
  SecondaryActionHandler,
  SuggestionType as SuggestionTypeEnum,
} from "../../api";
import { useSuggestionDecision } from "../../data/hooks/useSuggestionDecision";
import { log } from "../../utils/logger";
import { usePathService } from "../../contexts";
import { useConversationContext } from "./Components/ConversationContext";
import { createSecondActionFromAPI } from "./utils/conversationFormHelpers";
import type { UIAction } from "../../types/userTracking";
import type { UITrackingData } from "../../contexts";
import type { UIElement } from "../../api";
import type { FormValue } from "../LlmForms/types";
import { getSecondaryActionBehavior } from "../LlmForms/Registry";
import {
  toOpenApiConversationId,
  toOpenApiMessageId,
} from "../../clients/contractIdentifierAdapters";
import type {
  SecondaryActionConfigWithHandler,
  SecondaryActionContext,
  SecondaryActionHandlerKey,
  SecondaryActionSubmitOptions,
} from "../LlmForms/Registry/types";
import {
  buildSuggestionId,
  getSecondaryActionSuggestionId,
  type SuggestionDecisionStatus,
} from "./hooks/useSuggestionDecisions";

const getSuggestionTypeForAction = (
  handler: SecondaryActionHandlerKey,
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
    case SecondaryActionHandler.VerifyFeature:
      return SuggestionTypeEnum.VerifyFeature;
    default:
      return null;
  }
};

/**
 * A verification session that was created but whose started state has not
 * been saved yet. Keeping its id lets the user retry the save without
 * launching verification again.
 */
interface UnsavedVerifyFeatureStart {
  agentSessionId: string;
  status: "saving" | "failed";
}

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
    options?: SecondaryActionSubmitOptions,
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
  const paths = usePathService();
  const queryClient = useQueryClient();
  const [unsavedStart, setUnsavedStart] =
    useState<UnsavedVerifyFeatureStart | null>(null);
  const handler = action.handler;
  const { onExecute } = createSecondActionFromAPI(
    action,
    context,
    trackUI,
    messageId,
    handleNext,
    uiElements,
  );

  // The Verify Feature decision is keyed by message and element, never by
  // concern text or list position.
  const suggestionId =
    handler === SecondaryActionHandler.VerifyFeature
      ? buildSuggestionId(messageId, action.fieldId)
      : getSecondaryActionSuggestionId(messageId, action);
  const suggestionType = getSuggestionTypeForAction(handler);
  const suggestionDecision = suggestionDecisions.getDecision(suggestionId);

  const upsertDecision = (
    decision: SuggestionDecisionStatus,
    metadata?: SuggestionDecisionMetadata,
  ) => {
    suggestionDecisions.upsertDecision({
      ...decision,
      metadata: metadata ?? decision.metadata,
    });
  };

  /** Resolves true once the decision is saved; false when it could not be. */
  const persistDecision = async (
    accepted: boolean,
    metadata: SuggestionDecisionMetadata | undefined,
    optimistic: boolean,
  ): Promise<boolean> => {
    if (!suggestionId || !suggestionType) {
      return false;
    }

    const sourceMessageId = context.messageId ?? messageId;
    if (!context.conversationId || !sourceMessageId) {
      log.warn("ui", "Missing conversation context for suggestion decision", {
        actionId: action.id,
        handler,
        hasConversationId: !!context.conversationId,
        hasMessageId: !!sourceMessageId,
      });
      return false;
    }

    if (optimistic) {
      upsertDecision(
        {
          id: suggestionId,
          type: suggestionType,
          accepted,
          decidedBy: null,
          createdAt: new Date().toISOString(),
          sourceConversationId: toOpenApiConversationId(context.conversationId),
          sourceMessageId: toOpenApiMessageId(sourceMessageId),
          metadata,
        },
        metadata,
      );
    }

    try {
      const decision = await decisionMutation.mutate({
        organizationId: context.organizationId,
        type: suggestionType,
        suggestionId,
        accepted,
        sourceConversationId: context.conversationId,
        sourceMessageId,
        metadata,
      });
      upsertDecision(decision);
      return true;
    } catch (error) {
      log.error("ui", "Failed to record suggestion decision", {
        actionId: action.id,
        handler,
        suggestionId,
        error,
      });
      return false;
    }
  };

  const recordDecision = (
    accepted: boolean,
    metadata?: SuggestionDecisionMetadata,
  ) => {
    void persistDecision(accepted, metadata, true);
  };

  // Verify Feature is not saved optimistically: the started state must only
  // look saved once it is, otherwise a failed save would silently vanish on
  // reload. Until then the created session stays linked and the save can be
  // retried without launching again.
  const saveVerifyFeatureStart = async (agentSessionId: string) => {
    setUnsavedStart({ agentSessionId, status: "saving" });
    const saved = await persistDecision(
      true,
      { kind: "VERIFY_FEATURE", agentSessionId },
      false,
    );
    setUnsavedStart(saved ? null : { agentSessionId, status: "failed" });

    // Launching navigates to the new session, which unmounts this suggestion
    // and drops its local state. Refreshing the cached conversation is what
    // lets the started state show when the user comes back.
    if (saved && context.conversationId) {
      await queryClient.invalidateQueries({
        queryKey: conversationKeys.conversation(
          context.organizationId,
          context.projectId,
          context.conversationId,
        ),
      });
    }
  };

  if (handler === SecondaryActionHandler.VerifyFeature) {
    const field = uiElements.find(
      (element) =>
        element.id === action.fieldId && element.type === "verify_feature",
    );
    if (!field || !isVerifyFeaturePayload(field.payload)) {
      return (
        <Alert severity="error">
          Feature verification details are unavailable.
        </Alert>
      );
    }

    const savedMetadata =
      suggestionDecision?.accepted &&
      suggestionDecision.metadata?.kind === "VERIFY_FEATURE"
        ? suggestionDecision.metadata
        : null;
    const startedSessionId =
      savedMetadata?.agentSessionId ?? unsavedStart?.agentSessionId;
    if (startedSessionId) {
      return (
        <Stack spacing={1} alignItems="flex-start">
          <ProjectTopologyViewSessionButton
            to={paths.agentSession({
              projectId: context.projectId,
              agentSessionId: startedSessionId,
            })}
          />
          {!savedMetadata && unsavedStart?.status === "failed" && (
            <Alert
              severity="warning"
              data-testid="verify-feature-save-failed"
              action={
                <Button
                  color="inherit"
                  size="small"
                  data-testid="verify-feature-retry-save"
                  onClick={() => void saveVerifyFeatureStart(startedSessionId)}
                >
                  Retry saving
                </Button>
              }
            >
              Verification started, but we could not save that for others.
              Retrying only saves it; it does not start verification again.
            </Alert>
          )}
        </Stack>
      );
    }

    return (
      <VerifyFeatureAction
        check={field.payload}
        context={context}
        onLaunched={(agentSessionId) =>
          void saveVerifyFeatureStart(agentSessionId)
        }
      />
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
