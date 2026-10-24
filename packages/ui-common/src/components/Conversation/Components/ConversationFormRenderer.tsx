import { latestCodingPlanVersionMessageId } from "../utils/codingPlanConversation";
import type { ResolvedConversationForm } from "../utils/conversationResponseModel";
import React, { memo } from "react";
import {
  MessageStatus,
  MessageType,
  ReportType,
  type QuestionsSystemMessageData,
  type SecondaryActionConfig,
  type SystemMessageData,
} from "../../../api";
import { useUserAction } from "../../../contexts/TrackingContext";
import type { ConversationMessage } from "../../../types/conversation";
import { DynamicForm } from "../../LlmForms/DynamicForm";
import type { FormValue } from "../../LlmForms/types";
import {
  createFormContext,
  getButtonSecondActions,
  isFinalStep,
  prepareFormInitialData,
} from "../utils/conversationFormHelpers";
import { calculateMessageStatus } from "../utils/messageStatusCalculator";
import { useConversationContext } from "./ConversationContext";
import type {
  FieldComponentContext,
  SecondaryActionSubmitOptions,
} from "../../LlmForms/Registry/types";
import { useConversationEvents } from "../hooks/useConversationEvents";
import { ReportViewer } from "../../Reports/ReportViewer";
import type { FeatureSyncDecisionReportInteractionContext } from "../../Reports/viewer/FeatureSyncDecisionReport";
import { log } from "../../../utils/logger";
import { useRepositoryGroundingAnalysisLaunch } from "../../../data/hooks/useRepositoryGroundingAnalysisLaunch";

interface ConversationFormRendererProps {
  conversationMessage: ConversationMessage;
  messageIndex: number;
  totalMessages: number;
  resolvedForm: ResolvedConversationForm;
  /** Preserve data attributes for testing */
  "data-testid"?: string;
}

/**
 * Handles form rendering logic for conversation messages.
 * Now uses ConversationContext to eliminate prop drilling.
 *
 * @param props - Component props (significantly reduced due to context)
 * @returns JSX element with appropriate form rendering
 */
export const ConversationFormRenderer: React.FC<ConversationFormRendererProps> =
  memo(
    ({
      conversationMessage,
      messageIndex,
      totalMessages,
      resolvedForm,
      "data-testid": dataTestId,
    }) => {
      // Get context data instead of props
      const {
        activeConversation,
        messages,
        project,
        agentSessionId,
        planId,
        stepId,
        isSubmitting,
        workflowStatus,
        handleNext,
        isReadOnly,
        composerResetMode,
        isCliInputDisabled,
        onFocusComposer,
        onGoalPmAction,
        proposalInteraction,
        currentVisualPreviewProposalIds,
        latestTurnToolCalls,
      } = useConversationContext();

      const { trackUI } = useUserAction();
      const { emit } = useConversationEvents(activeConversation.id);
      const { launchRepositoryGroundingAnalysis } =
        useRepositoryGroundingAnalysisLaunch();

      const status = calculateMessageStatus({
        conversationMessage,
        isSubmitting,
      });

      const {
        resolution: formResolution,
        formUiElements,
        inlineReports,
        interactiveReportAttachments,
        isSubmitted,
        isFormReadOnly,
        shouldRenderForm,
      } = resolvedForm;
      const sourceNodeId =
        conversationMessage.message.type === MessageType.System
          ? conversationMessage.message.data.nodeId?.trim() || undefined
          : undefined;
      const handleMessageNext = (
        data: Record<string, FormValue>,
        messageId: string,
        options?: SecondaryActionSubmitOptions,
      ) => {
        const resolvedOptions = sourceNodeId
          ? { ...options, nodeId: options?.nodeId ?? sourceNodeId }
          : options;

        if (resolvedOptions) {
          return handleNext(data, messageId, resolvedOptions);
        }
        return handleNext(data, messageId);
      };
      // Determine appropriate secondAction buttons for footer
      const getSecondActions = (context: FieldComponentContext) => {
        if (conversationMessage.message.type === "USER") {
          return [];
        }

        // Use enhanced helper that supports API-driven secondary actions
        return getButtonSecondActions(
          conversationMessage.message.data as {
            secondaryActions?: SecondaryActionConfig[];
          },
          formUiElements,
          conversationMessage.message.id,
          trackUI,
          handleMessageNext,
          context,
        );
      };

      const isSubmittable = resolvedForm.isCurrent;

      const { uiHints, type: messageType } = (conversationMessage.message
        .data ?? {}) as QuestionsSystemMessageData;
      const showSkeleton =
        messageType === "QUESTIONS" &&
        conversationMessage.message.status === MessageStatus.StreamingReady;

      const onNext = (
        data: Record<string, FormValue>,
        options?: SecondaryActionSubmitOptions,
      ) => {
        if (formResolution) {
          void formResolution
            .submit(data)
            .then(() => {
              emit({
                type: "submission-success",
                payload: {
                  messageId: conversationMessage.message.id,
                  data,
                },
              });
            })
            .catch((error: unknown) => {
              emit({
                type: "submission-error",
                payload: {
                  error,
                  data,
                  parentMessageId: conversationMessage.message.id,
                },
              });
            });
          return;
        }
        if (options) {
          handleMessageNext(data, conversationMessage.message.id, options);
        } else {
          handleMessageNext(data, conversationMessage.message.id);
        }
      };

      const fieldContext = createFormContext(
        activeConversation.id,
        project.id,
        project.organizationId,
        agentSessionId,
        activeConversation.workflowAboutId ?? undefined,
        conversationMessage.message.id,
        conversationMessage.message.parentMessageId,
        activeConversation.workflowAboutType ?? undefined,
        planId,
        stepId,
        conversationMessage.message.createdAt,
        conversationMessage.message.data as unknown as SystemMessageData,
        conversationMessage.message.parentMessage?.type === MessageType.System
          ? (conversationMessage.message.parentMessage
              .data as SystemMessageData)
          : undefined,
        isFinalStep(messageIndex, totalMessages),
        proposalInteraction,
        currentVisualPreviewProposalIds,
        latestTurnToolCalls,
        onFocusComposer,
      );
      fieldContext.codingPlanVersionMessageId =
        latestCodingPlanVersionMessageId(messages);
      fieldContext.onGoalPmAction = onGoalPmAction;
      fieldContext.onRepositoryGroundingLaunch = async (submission) => {
        const workflowId = activeConversation.workflowId;
        const messageData = conversationMessage.message
          .data as SystemMessageData;
        const nodeId = messageData.nodeId?.trim();
        if (!workflowId || !nodeId) {
          throw new Error(
            "Repository analysis cannot start until its workflow step is available.",
          );
        }
        await launchRepositoryGroundingAnalysis({
          organizationId: project.organizationId,
          projectId: project.id,
          conversationId: activeConversation.id,
          workflowId,
          nodeId,
          parentMessageId: conversationMessage.message.id,
          submission,
        });
        emit({
          type: "submission-success",
          payload: {
            messageId: conversationMessage.message.id,
            data: { repository_grounding: submission },
          },
        });
      };
      const canInteractWithReport = !isFormReadOnly;
      const shouldRenderDynamicForm =
        shouldRenderForm &&
        (interactiveReportAttachments.length === 0 ||
          formUiElements.length > 0 ||
          showSkeleton);

      React.useEffect(() => {
        if (interactiveReportAttachments.length === 0) {
          return;
        }

        log.debug(
          "conversation_viewer",
          "[interactive-plan-report] evaluating conversation interaction eligibility",
          {
            messageId: conversationMessage.message.id,
            reportIds: interactiveReportAttachments.map(
              ({ report }) => report.id,
            ),
            canInteractWithReport,
            messageCanEdit: conversationMessage.canEdit,
            isFormReadOnly,
            isReadOnly,
            isCliInputDisabled,
            workflowCanSubmit: workflowStatus.canSubmit,
            isSubmitting,
          },
        );
      }, [
        canInteractWithReport,
        conversationMessage.canEdit,
        conversationMessage.message.id,
        interactiveReportAttachments,
        isCliInputDisabled,
        isFormReadOnly,
        isReadOnly,
        isSubmitting,
        workflowStatus.canSubmit,
      ]);

      return (
        <div data-testid={dataTestId}>
          {/* Render inline secondary actions before form */}

          {/* Show form if message has UI elements and message is not processing */}
          {shouldRenderDynamicForm && (
            <DynamicForm
              context={fieldContext}
              uiElements={formUiElements}
              inlineReports={inlineReports}
              initialData={prepareFormInitialData(
                conversationMessage,
                formUiElements,
              )}
              showSkeleton={showSkeleton}
              disabled={isFormReadOnly}
              isSubmitted={isSubmitted}
              isSubmittable={isSubmittable}
              secondActions={getSecondActions(fieldContext)}
              status={status}
              composerResetMode={
                formResolution?.composerResetMode ?? composerResetMode
              }
              onNext={onNext}
              conversationMessage={conversationMessage}
              uiHints={uiHints}
            />
          )}
          {interactiveReportAttachments.map(({ report, responseUiElement }) => {
            const ownsEmbeddedResponse = resolvedForm.declarations.some(
              (declaration) =>
                declaration.ownership === "exclusive" &&
                declaration.currentFieldId === responseUiElement.id,
            );
            return (
              <ReportViewer
                key={report.id}
                report={report}
                renderHeader={false}
                featureSyncDecisionInteraction={
                  report.reportType === ReportType.FeatureSyncDecision &&
                  !isReadOnly &&
                  ownsEmbeddedResponse
                    ? createFeatureSyncDecisionInteraction({
                        conversationId: activeConversation.id,
                        disabled: !canInteractWithReport,
                        handleNext: handleMessageNext,
                        parentMessageId: conversationMessage.message.id,
                      })
                    : undefined
                }
                planInteraction={
                  report.reportType === ReportType.Plan &&
                  !isReadOnly &&
                  ownsEmbeddedResponse
                    ? {
                        sourceUiElement: responseUiElement,
                        parentMessageId: conversationMessage.message.id,
                        fieldContext,
                        disabled: !canInteractWithReport,
                        submit: (values, parentMessageId) =>
                          handleMessageNext(values, parentMessageId),
                      }
                    : undefined
                }
              />
            );
          })}
        </div>
      );
    },
  );

const createFeatureSyncDecisionInteraction = (input: {
  conversationId: string;
  disabled: boolean;
  handleNext: (
    data: Record<string, FormValue>,
    parentMessageId: string,
  ) => Promise<void>;
  parentMessageId: string;
}): FeatureSyncDecisionReportInteractionContext => ({
  conversationId: input.conversationId,
  disabled: input.disabled,
  parentMessageId: input.parentMessageId,
  submit: (response, parentMessageId) => {
    void input.handleNext({ response }, parentMessageId);
  },
});
