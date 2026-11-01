import React from "react";
import { findCodingPlanApproval } from "../../LlmForms/Registry/codingPlanApprovalEvidence";
import type {
  QuestionsSystemMessageData,
  SecondaryActionConfig,
  SkipAction,
  SystemMessageData,
  UIElement,
  UserMessageData,
  MessageResponseDto,
} from "../../../api";
import {
  MessageType,
  SecondaryActionConfigPresentationEnum,
  SecondaryActionHandler,
  WorkflowReviewAction,
} from "../../../api";
import type { UITrackingData } from "../../../contexts/TrackingContext";
import type { ConversationMessage } from "../../../types/conversation";
import type { UIAction } from "../../../types/userTracking";
import { log } from "../../../utils/logger";
import type { FieldComponentContext } from "../../LlmForms";
import {
  FIELD_REGISTRY,
  getRegistryType,
  getSecondaryActionFieldId,
  getSecondaryActionBehavior,
} from "../../LlmForms/Registry";
import {
  type SecondaryActionConfigWithHandler,
  type SecondaryActionContext,
  type SecondaryActionSubmitOptions,
  PlanShapingFeatureSyncReviewDoneHandler,
  PlanShapingFeatureSyncReviewRequestRevisionsHandler,
} from "../../LlmForms/Registry/types";
import type { FormValue, SecondAction } from "../../LlmForms/types";
import { projectStartupPlanSubmission } from "../../LlmForms/Registry/startupPlanApprovalMarkdown";
import { isStartupPlanStructuredResponseValue } from "../../LlmForms/Registry/StartupPlanStructuredField";
import type { LatestTurnToolCallsState } from "../../AgentSession/runtime/hooks/useLatestTurnToolCalls";

/**
 * Prepares initial data for form rendering based on message type and existing data.
 * Extracted from ConversationViewer.tsx lines 910-931.
 *
 * @param conversationMessage - The conversation message containing form data
 * @param _isWorkItemMessage - Deprecated: type is now derived from message data
 * @param uiElements - The UI elements for the form
 * @returns Prepared initial form data
 */
export const prepareFormInitialData = (
  conversationMessage: ConversationMessage,
  uiElements: Array<Pick<UIElement, "type" | "id" | "payload">> = [],
  messages: readonly MessageResponseDto[] = [],
): Record<string, FormValue> => {
  const messageData = conversationMessage.message
    .data as QuestionsSystemMessageData;
  let baseData: Record<string, FormValue> = {};
  let responseData: UserMessageData | undefined;
  if (
    (messageData as { originalData?: Record<string, FormValue> })?.originalData
  ) {
    baseData = (
      messageData as unknown as { originalData: Record<string, FormValue> }
    ).originalData;
  }

  // Look for user response data in the message responses
  // Separate field answers can arrive as separate linked USER messages.
  if (
    conversationMessage.message.responses &&
    conversationMessage.message.responses.length > 0
  ) {
    const userResponses = conversationMessage.message.responses.filter(
      (response) => response.type === MessageType.User,
    );
    for (const userResponse of userResponses) {
      if (!userResponse.data) continue;
      responseData = { ...responseData, ...userResponse.data };
      // Merge user response data into baseData
      Object.assign(baseData, userResponse.data);
    }
  }

  uiElements.forEach((element) => {
    if (element.type === "coding_plan_version") {
      const approval = findCodingPlanApproval(
        [...messages, conversationMessage.message],
        conversationMessage.message.id,
      );
      if (approval) baseData[element.id] = approval;
    }
    const registryType = getRegistryType(element);
    const entry = registryType ? FIELD_REGISTRY[registryType] : undefined;
    if (!entry?.prepareInitialValue) {
      return;
    }

    const nextValue = entry.prepareInitialValue({
      messageData,
      uiElement: element,
      baseValue: baseData[element.id],
      responseData,
    });

    if (nextValue !== undefined) {
      baseData[element.id] = nextValue;
    }
  });

  return baseData;
};

/**
 * Determines if form submission is disabled based on message and workflow state.
 *
 * @param conversationMessage - The conversation message
 * @param workflowCanSubmit - Whether workflow allows submission
 * @param isSubmitting - Whether currently submitting
 * @param hasOptimisticMessage - Whether there's an optimistic message
 * @returns Whether form submission should be disabled
 */
export const isFormSubmissionDisabled = (
  conversationMessage: ConversationMessage,
  workflowCanSubmit: boolean,
  isSubmitting: boolean,
): boolean => {
  return !conversationMessage.canEdit || !workflowCanSubmit || isSubmitting;
};

/** Persisted answer evidence; unlike readiness, this releases response ownership. */
export const hasPersistedFormResponse = (
  conversationMessage: ConversationMessage,
): boolean =>
  Boolean(
    conversationMessage.message.responses?.some(
      (response) => response.type === "USER",
    ),
  );

/**
 * Determines if form is in submitted state (read-only mode).
 *
 * @param conversationMessage - The conversation message
 * @param workflowCanSubmit - Whether workflow allows submission
 * @returns Whether form is submitted/read-only
 */
export const isFormSubmitted = (
  conversationMessage: ConversationMessage,
  workflowCanSubmit: boolean,
): boolean => {
  return !conversationMessage.canEdit || !workflowCanSubmit;
};

/**
 * Determines if this is the final step in the conversation timeline.
 *
 * @param currentIndex - Current message index in timeline
 * @param timelineLength - Total timeline length
 * @returns Whether this is the final step
 */
export const isFinalStep = (
  currentIndex: number,
  timelineLength: number,
): boolean => {
  return currentIndex === timelineLength - 1;
};

/**
 * Extracts skippable flag from message data.
 *
 * @param messageData - The message data object
 * @returns Whether the message/form is skippable
 */
const isMessageSkippable = (messageData: unknown): boolean => {
  return (messageData as QuestionsSystemMessageData)?.skippable || false;
};

/**
 * Creates form context data needed by DynamicForm component.
 *
 * @param conversationId - The conversation ID
 * @param projectId - The project ID
 * @param organizationId - The organization ID
 * @param workflowAboutId - Optional workflow about ID (e.g., design doc ID)
 * @param messageId - Optional message ID
 * @returns Form context object
 */
export const createFormContext = (
  conversationId: string,
  projectId: string,
  organizationId: string,
  agentSessionId: string | undefined,
  workflowAboutId: string | undefined,
  messageId: string | undefined,
  parentMessageId: string | undefined,
  workflowAboutType: string | undefined,
  planId: string | undefined,
  stepId: string | undefined,
  messageCreatedAt: string | undefined,
  messageData: SystemMessageData | undefined,
  parentMessageData: SystemMessageData | undefined,
  isLastInTimeline: boolean | undefined,
  interaction: FieldComponentContext["interaction"],
  currentVisualPreviewProposalIds: string[] | undefined,
  latestTurnToolCalls: LatestTurnToolCallsState | undefined,
  onFocusComposer?: () => void,
): FieldComponentContext => ({
  conversationId,
  projectId,
  organizationId,
  agentSessionId,
  workflowAboutId,
  workflowAboutType,
  messageId,
  parentMessageId,
  planId,
  stepId,
  messageCreatedAt,
  messageData,
  parentMessageData,
  isLastInTimeline,
  latestTurnToolCalls,
  onFocusComposer,
  interaction,
  currentVisualPreviewProposalIds,
});

/**
 * Creates a skip SecondAction based on message skippable state.
 *
 * @param messageData - The message data object to check for skippable flag
 * @param handleNext - Function to call when skip action is triggered
 * @param messageId - ID of the message being skipped
 * @param trackUI - Function to track UI interactions
 * @param context - Conversation context for logging
 * @returns SecondAction object for skip functionality, or undefined if not skippable
 */
const createSkipSecondAction = (
  handleNext: (
    data: Record<string, FormValue>,
    messageId: string,
    options?: SecondaryActionSubmitOptions,
  ) => void,
  messageId: string,
  trackUI: (action: UIAction, data: UITrackingData) => void,
  context: {
    conversationId: string;
    projectId: string;
    organizationId: string;
  },
): SecondAction => {
  return {
    type: "skip",
    label: "Skip",
    submitsForm: true,
    presentation: SecondaryActionConfigPresentationEnum.Button,
    onExecute: () => {
      log.info("dynamic_form", "Skip button clicked via secondAction", {
        conversationId: context.conversationId,
        messageId,
      });

      // Track skip button click
      trackUI("button_click", {
        elementType: "form_navigation",
        elementText: "skip",
      });

      // Create SkipAction instead of user message
      const skipAction: SkipAction = {
        type: "skip",
        payload: {
          reason: "user_skipped",
        },
      };

      log.info("dynamic_form", "Skip action created via secondAction", {
        conversationId: context.conversationId,
        messageId,
        skipAction,
      });

      handleNext(
        { action: skipAction } as Record<string, FormValue>,
        messageId,
      );
    },
    variant: "text",
    testId: "dynamic-form-skip-button",
  };
};

// /**
//  * Creates a task generation SecondAction for forms with task_generation fields.
//  *
//  * @param uiElements - Array of UI elements to check for task generation fields
//  * @param trackUI - Function to track UI interactions
//  * @param context - Conversation context for logging
//  * @returns SecondAction object for task generation functionality, or undefined if no task generation fields
//  */
// export const createTaskGenerationSecondAction = (
//   uiElements: UIElement[],
//   trackUI: (action: UIAction, data: UITrackingData) => void,
//   context: { conversationId: string; projectId: string; organizationId: string }
// ): SecondAction | undefined => {
//   const hasTaskGenerationField = uiElements.some(
//     (el) => el.type === "task_generation"
//   );

//   if (!hasTaskGenerationField) {
//     return undefined;
//   }

//   return {
//     type: "field_action",
//     label: "Generate Tasks",
//     presentation: SecondaryActionConfigPresentationEnum.Button,
//     onClick: () => {
//       log.info(
//         "dynamic_form",
//         "Generate Tasks button clicked via secondAction",
//         {
//           conversationId: context.conversationId,
//         }
//       );

//       // Track generate tasks button click
//       trackUI("button_click", {
//         elementType: "task_generation",
//         elementText: "generate_tasks",
//       });

//       // TODO: Implement task generation logic
//       // This will need to trigger the onGenerateTasks callback on the TaskGenerationField
//       // For now, we'll log that this functionality needs to be implemented
//       log.info("dynamic_form", "Task generation triggered via secondAction", {
//         conversationId: context.conversationId,
//         message:
//           "Task generation logic needs to be implemented in field component",
//       });
//     },
//     variant: "contained",
//     icon: React.createElement("span", { children: "✨" }), // Placeholder for GenerateTasksIcon
//     testId: "dynamic-form-generate-tasks-button",
//   };
// };

/**
 * Creates a SecondAction from API-provided SecondaryActionConfig.
 *
 * @param config - Secondary action configuration from API
 * @param context - Context for action execution
 * @param trackUI - Function to track UI interactions
 * @param messageId - ID of the current message
 * @param handleNext - Form submission handler
 * @param uiElements - UI elements for the current form
 * @returns SecondAction object for use by DynamicForm
 */
export const createSecondActionFromAPI = (
  config: SecondaryActionConfigWithHandler,
  context: SecondaryActionContext,
  trackUI: (action: UIAction, data: UITrackingData) => void,
  messageId: string,
  handleNext: (
    data: Record<string, FormValue>,
    messageId: string,
    options?: SecondaryActionSubmitOptions,
  ) => void,
  uiElements: UIElement[],
): SecondAction => {
  const resolvedFieldId = getSecondaryActionFieldId({
    handler: config.handler,
    fieldId: config.fieldId,
    uiElements,
  });
  const resolvedConfig =
    resolvedFieldId && resolvedFieldId !== config.fieldId
      ? { ...config, fieldId: resolvedFieldId }
      : config;
  if (resolvedConfig.fieldId !== config.fieldId) {
    log.warn("dynamic_form", "Secondary action fieldId normalized", {
      actionId: config.id,
      handler: config.handler,
      requestedFieldId: config.fieldId,
      resolvedFieldId: resolvedConfig.fieldId,
    });
  }
  const behavior = getSecondaryActionBehavior({
    handler: resolvedConfig.handler,
    fieldId: resolvedConfig.fieldId,
    uiElements,
  });

  const executeAction = (formValues?: Record<string, FormValue>) => {
    log.info("dynamic_form", "API SecondAction executed", {
      conversationId: context.conversationId,
      actionId: resolvedConfig.id,
      actionType: resolvedConfig.type,
      handler: resolvedConfig.handler,
    });

    // Track action execution
    trackUI("button_click", {
      elementType: resolvedConfig.type,
      elementText: resolvedConfig.handler,
      actionId: resolvedConfig.id,
    });

    if (!formValues) {
      log.warn("dynamic_form", "Secondary action called without form values", {
        conversationId: context.conversationId,
        messageId,
        actionId: resolvedConfig.id,
        handler: resolvedConfig.handler,
      });
      return;
    }

    if (!behavior?.apply) {
      log.warn("dynamic_form", "Secondary action handler not supported", {
        conversationId: context.conversationId,
        handler: resolvedConfig.handler,
        actionId: resolvedConfig.id,
        fieldId: resolvedConfig.fieldId,
      });
      return;
    }

    const payload = behavior.apply({
      config: resolvedConfig,
      formValues,
    });

    if (!payload) {
      return;
    }

    const sourceNodeId = context.messageData?.nodeId?.trim();
    const submitOptions: SecondaryActionSubmitOptions = {
      handler: resolvedConfig.handler,
      ...(sourceNodeId ? { nodeId: sourceNodeId } : {}),
    };

    handleNext(payload, messageId, submitOptions);
  };

  return {
    type: resolvedConfig.type as SecondAction["type"],
    label: resolvedConfig.label,
    submitsForm: !!behavior?.apply,
    presentation:
      resolvedConfig.presentation ??
      SecondaryActionConfigPresentationEnum.Button,
    onExecute: executeAction,
    disabled: !!resolvedConfig.disabled,
    getAvailability: behavior?.getAvailability
      ? (formValues) =>
          behavior.getAvailability!({
            config: resolvedConfig,
            formValues,
            context,
          })
      : undefined,
    render: behavior?.render
      ? (formValues, { isSubmissionLocked }) =>
          behavior.render!({
            action: resolvedConfig,
            context,
            trackUI,
            messageId,
            handleNext,
            formValues,
            isSubmissionLocked,
            onExecute: executeAction,
            suggestionDecision: undefined,
            recordDecision: () => undefined,
          })
      : undefined,
    handler: resolvedConfig.handler,
    fieldId: resolvedConfig.fieldId,
    variant:
      resolvedConfig.handler ===
        PlanShapingFeatureSyncReviewRequestRevisionsHandler ||
      (resolvedConfig.handler === PlanShapingFeatureSyncReviewDoneHandler &&
        resolvedConfig.label === "Ready for Plan") ||
      resolvedConfig.handler ===
        SecondaryActionHandler.PlanGenerationVisualPreviewApprove
        ? "contained"
        : "text",
    icon: resolvedConfig.icon
      ? React.createElement("span", { children: resolvedConfig.icon })
      : undefined,
    testId: `dynamic-form-api-action-${resolvedConfig.id}`,
  };
};

const getSecondaryActions = (
  messageData: { secondaryActions?: SecondaryActionConfig[] },
  uiElements: UIElement[],
  messageId: string,
  trackUI: (action: UIAction, data: UITrackingData) => void,
  handleNext: (
    data: Record<string, FormValue>,
    messageId: string,
    options?: SecondaryActionSubmitOptions,
  ) => void,
  context: {
    conversationId: string;
    projectId: string;
    organizationId: string;
  },
) => {
  const secondaryActions: Array<SecondAction | SecondaryActionConfig> = [];
  if (messageData.secondaryActions?.length) {
    secondaryActions.push(...messageData.secondaryActions);
  }
  for (const uiElement of uiElements) {
    if (uiElement.secondaryAction) {
      if (uiElement.secondaryAction.fieldId !== uiElement.id) {
        log.warn("dynamic_form", "Secondary action fieldId mismatch", {
          conversationId: context.conversationId,
          messageId,
          actionId: uiElement.secondaryAction.id,
          handler: uiElement.secondaryAction.handler,
          fieldId: uiElement.secondaryAction.fieldId,
          uiElementId: uiElement.id,
        });
      }

      secondaryActions.push({
        ...uiElement.secondaryAction,
        fieldId: uiElement.id,
      });
    }
  }

  if (isMessageSkippable(messageData)) {
    secondaryActions.push(
      createSkipSecondAction(handleNext, messageId, trackUI, context),
    );
  }
  return secondaryActions;
};

/**
 * Gets inline secondary actions from message data.
 *
 * Returns all secondary actions with presentation='INLINE' to be rendered
 * as components before form fields (e.g., suggestions, informational cards).
 *
 * @param messageData - Message data that may contain secondary actions
 * @returns Array of inline secondary action configurations
 */
const getInlineSecondaryActions = (
  messageData: { secondaryActions?: SecondaryActionConfig[] },
  uiElements: UIElement[],
  messageId: string,
  trackUI: (action: UIAction, data: UITrackingData) => void,
  handleNext: (
    data: Record<string, FormValue>,
    messageId: string,
    options?: SecondaryActionSubmitOptions,
  ) => void,
  context: {
    conversationId: string;
    projectId: string;
    organizationId: string;
  },
): SecondaryActionConfig[] => {
  const actions = getSecondaryActions(
    messageData,
    uiElements,
    messageId,
    trackUI,
    handleNext,
    context,
  );

  return actions.filter(
    (action: SecondAction | SecondaryActionConfig | undefined) => {
      if (!action) {
        return false;
      }
      if ((action as SecondaryActionConfig).handler) {
        return action.presentation === "INLINE";
      }
      return false;
    },
  ) as SecondaryActionConfig[];
};

export const getMessageInlineSecondaryActions = (
  messageData: { secondaryActions?: SecondaryActionConfig[] },
  messageId: string,
  trackUI: (action: UIAction, data: UITrackingData) => void,
  handleNext: (
    data: Record<string, FormValue>,
    messageId: string,
    options?: SecondaryActionSubmitOptions,
  ) => void,
  context: {
    conversationId: string;
    projectId: string;
    organizationId: string;
  },
): SecondaryActionConfig[] => {
  return getInlineSecondaryActions(
    messageData,
    [],
    messageId,
    trackUI,
    handleNext,
    context,
  );
};

export const getUIElementInlineSecondaryActions = (
  uiElement: UIElement,
  messageId: string,
  trackUI: (action: UIAction, data: UITrackingData) => void,
  handleNext: (
    data: Record<string, FormValue>,
    messageId: string,
    options?: SecondaryActionSubmitOptions,
  ) => void,
  context: {
    conversationId: string;
    projectId: string;
    organizationId: string;
  },
): SecondaryActionConfig[] => {
  return getInlineSecondaryActions(
    {
      secondaryActions: [],
    },
    [uiElement],
    messageId,
    trackUI,
    handleNext,
    context,
  );
};

const isSecondaryActionConfig = (
  b: SecondaryActionConfig | SecondAction,
): b is SecondaryActionConfig => "handler" in (b as SecondaryActionConfig);

const createStartupPlanContinueRefiningSecondAction = (input: {
  uiElements: UIElement[];
  messageId: string;
  handleNext: (
    data: Record<string, FormValue>,
    messageId: string,
    options?: SecondaryActionSubmitOptions,
  ) => void;
  trackUI: (action: UIAction, data: UITrackingData) => void;
}): SecondAction | undefined => {
  const startupPlanFieldId = input.uiElements.find(
    (element) => getRegistryType(element) === "coding_prompt_startup_plan",
  )?.id;

  if (!startupPlanFieldId) {
    return undefined;
  }

  return {
    type: "field_action",
    label: "Continue Refining",
    submitsForm: true,
    presentation: SecondaryActionConfigPresentationEnum.Button,
    onExecute: (formValues) => {
      input.trackUI("button_click", {
        elementType: "form_navigation",
        elementText: "continue_refining",
      });

      const nextValues = { ...formValues };
      const startupPlanValue = nextValues[startupPlanFieldId];
      if (isStartupPlanStructuredResponseValue(startupPlanValue)) {
        nextValues[startupPlanFieldId] = projectStartupPlanSubmission(
          startupPlanValue,
          WorkflowReviewAction.Refine,
        ).value;
      }

      input.handleNext(nextValues, input.messageId);
    },
    variant: "text",
    testId: "dynamic-form-startup-continue-refining-button",
  };
};

/**
 * Creates a footer button secondary action from message data.
 *
 * Checks message.secondaryActions array for actions with presentation='BUTTON'
 * and returns the first one as a footer button action.
 *
 * Field-level secondary actions (uiElement.secondaryAction) are handled
 * independently by field components.
 *
 * Inline secondary actions (presentation='INLINE') are rendered separately
 * by ConversationFormRenderer using getInlineSecondaryActions().
 *
 * @param messageData - Message data that may contain secondary actions
 * @param uiElements - UI elements for the form
 * @param messageId - ID of the current message
 * @param trackUI - Function to track UI interactions
 * @param context - Context for action execution
 * @returns SecondAction object or undefined
 */
export const getButtonSecondActions = (
  messageData: { secondaryActions?: SecondaryActionConfig[] },
  uiElements: UIElement[],
  messageId: string,
  trackUI: (action: UIAction, data: UITrackingData) => void,
  handleNext: (
    data: Record<string, FormValue>,
    messageId: string,
    options?: SecondaryActionSubmitOptions,
  ) => void,
  context: SecondaryActionContext,
): SecondAction[] => {
  const secondaryActions = getSecondaryActions(
    messageData,
    uiElements,
    messageId,
    trackUI,
    handleNext,
    context,
  );

  // Collect all actions with BUTTON presentation (or no presentation specified)
  const buttonActions = secondaryActions.filter(
    (action) => action.presentation === "BUTTON" || !action.presentation,
  );

  if (buttonActions.length > 0) {
    return buttonActions
      .map((action) => {
        if (isSecondaryActionConfig(action)) {
          return createSecondActionFromAPI(
            action,
            context,
            trackUI,
            messageId,
            handleNext,
            uiElements,
          );
        }
        return action;
      })
      .filter((action): action is SecondAction => !!action);
  }

  const fallback = createStartupPlanContinueRefiningSecondAction({
    uiElements,
    messageId,
    handleNext,
    trackUI,
  });
  return fallback ? [fallback] : [];
};

export type WorkflowSubmission =
  | {
      kind: "structured-answer";
      action: string;
      payload: Record<string, unknown>;
    }
  | { kind: "conversational-text"; userMessage: string };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const getStructuredWorkflowSubmission = (
  data: Record<string, FormValue>,
): Extract<WorkflowSubmission, { kind: "structured-answer" }> | null => {
  for (const value of Object.values(data)) {
    if (
      isRecord(value) &&
      typeof value.action === "string" &&
      isRecord(value.payload)
    ) {
      return {
        kind: "structured-answer",
        action: value.action,
        payload: value.payload,
      };
    }
  }

  return null;
};

const hasInvalidStructuredCandidate = (
  data: Record<string, FormValue>,
): boolean =>
  Object.values(data).some(
    (value) => isRecord(value) && ("action" in value || "decision" in value),
  );

const getConversationalText = (
  data: Record<string, FormValue>,
): string | null => {
  const textValues = Object.values(data)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return textValues.length > 0 ? textValues.join("\n\n") : null;
};

export const classifyWorkflowSubmission = (
  data: Record<string, FormValue>,
): WorkflowSubmission => {
  const structuredSubmission = getStructuredWorkflowSubmission(data);
  if (structuredSubmission) return structuredSubmission;

  if (hasInvalidStructuredCandidate(data)) {
    throw new Error(
      "A workflow action must provide an explicit action and object payload.",
    );
  }

  const userMessage = getConversationalText(data);
  if (userMessage) return { kind: "conversational-text", userMessage };

  throw new Error(
    "The workflow submission contains neither a structured action nor conversational text.",
  );
};
