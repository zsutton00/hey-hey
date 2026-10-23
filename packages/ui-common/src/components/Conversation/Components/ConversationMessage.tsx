import { Box, Button, Typography, useTheme } from "@mui/material";
import React, { memo, useMemo } from "react";
import type {
  AgentSystemMessageData,
  AnalysisSystemMessageData,
  QuestionsSystemMessageData,
  SystemMessage as SystemMessageType,
  TaskMonitorInterventionSystemMessageData,
  TaskMonitorSupervisionSystemMessageData,
  UserMessage,
  UserMessageData,
} from "../../../api";
import {
  AgentSessionCurrentState,
  MessageType,
  SystemMessageDataTypeEnum,
} from "../../../api";
import type { ConversationMessage as ConversationMessageType } from "../../../types/conversation";
import { readUserMessageDisplayText } from "../../../utils/conversationMessageText";
import { AnalysisMessage } from "../AnalysisMessage";
import { useConversationContext } from "./ConversationContext";
import { ConversationFormRenderer } from "./ConversationFormRenderer";
import { MessageAuthorCaption } from "./MessageAuthorCaption";
import { MessageProposals } from "./MessageProposals";
import {
  getMonitorVisualTreatmentSx,
  UserMessageBubble,
} from "./UserMessageBubble";
import { SystemMessageWithRetry } from "./SystemMessageWithRetry";
import { SupervisionDecisionMessage } from "./SupervisionDecisionMessage";
import { TaskMonitorInterventionMessage } from "./TaskMonitorInterventionMessage";
import { ReportActions } from "../../shared/ReportActions";
import {
  FIELD_REGISTRY,
  getProposalsRenderConfig,
  getRegistryType,
  isInterstitialMessageData,
} from "../../LlmForms/Registry";
import { getInterstitialTiming } from "./interstitialTiming";
import { useRetryConversationOpenTrigger } from "../../../data/hooks";

const TERMINAL_CAPACITY_MESSAGE =
  "The provider is temporarily at capacity for the selected model. Please retry.";

interface ConversationMessageProps {
  conversationMessage: ConversationMessageType;
  messageIndex: number;
  totalMessages: number;
  enableTypingAnimation?: boolean;
  renderTimestamp?: boolean;
  /** Preserve data attributes from original implementation */
  "data-testid"?: string;
}

type TaskMonitorSupervisionMessage = SystemMessageType & {
  data: TaskMonitorSupervisionSystemMessageData;
};

type TaskMonitorInterventionMessageType = SystemMessageType & {
  data: TaskMonitorInterventionSystemMessageData;
};

const isTaskMonitorSupervisionMessage = (
  message: ConversationMessageType["message"],
): message is TaskMonitorSupervisionMessage =>
  message.type === MessageType.System &&
  message.data.type === SystemMessageDataTypeEnum.TaskMonitorSupervision;

const isTaskMonitorInterventionMessage = (
  message: ConversationMessageType["message"],
): message is TaskMonitorInterventionMessageType =>
  message.type === MessageType.System &&
  message.data.type === SystemMessageDataTypeEnum.TaskMonitorIntervention;
const toUserMessageDisplayText = (
  message: ConversationMessageType["message"],
): string | null => {
  if (message.type !== MessageType.User) {
    throw new Error("Expected USER message.");
  }

  const messageData = message.data as UserMessageData;
  return readUserMessageDisplayText(messageData);
};

/**
 * Renders a single conversation message with system responses, analysis, and forms.
 * Now uses ConversationContext to eliminate prop drilling.
 * CRITICAL: Maintains exact message rendering logic and conditional display.
 *
 * @param props - Component props (significantly reduced due to context)
 * @returns JSX element displaying a single conversation message
 */
export const ConversationMessage: React.FC<ConversationMessageProps> = memo(
  ({
    conversationMessage,
    messageIndex,
    totalMessages,
    enableTypingAnimation = true,
    renderTimestamp = false,
    "data-testid": dataTestId,
  }) => {
    // Get context data instead of props
    const {
      project,
      activeConversation,
      conversationTimeline,
      resolvedForms,
      agentSessionCurrentState,
      agentSessionId,
      animationType,
      isSubmitting,
      handleAnalysisAcknowledged,
      handleRetrySuccess,
      isReadOnly,
      hideAnalysisAction,
    } = useConversationContext();
    const retryOpenTrigger = useRetryConversationOpenTrigger({
      onSuccess: handleRetrySuccess,
    });

    const { uiHints } = conversationMessage.message
      .data as QuestionsSystemMessageData;
    const isUserMessage = conversationMessage.message.type === MessageType.User;
    const userMessage = isUserMessage
      ? (conversationMessage.message as UserMessage)
      : undefined;
    const userMessageProvenance = userMessage?.data.agentInput?.provenance;
    const userMessageDisplayText = isUserMessage
      ? toUserMessageDisplayText(conversationMessage.message)
      : null;

    const shouldHideSystemMessage = useMemo(() => {
      const uiElements = (
        conversationMessage.message.data as
          QuestionsSystemMessageData | undefined
      )?.uiElements;
      if (!uiElements?.length) return false;
      return uiElements.some((el) => {
        const type = getRegistryType(el);
        const entry = type ? FIELD_REGISTRY[type] : undefined;
        return entry?.hideSystemMessage === true;
      });
    }, [conversationMessage.message.data]);

    const proposalsRenderConfig = useMemo(() => {
      const uiElements = (
        conversationMessage.message.data as
          QuestionsSystemMessageData | undefined
      )?.uiElements;
      return getProposalsRenderConfig(uiElements);
    }, [conversationMessage.message.data]);

    const resolvedForm = resolvedForms.get(conversationMessage.message.id);
    const inlineReports = resolvedForm?.inlineReports ?? [];
    const modalReports = resolvedForm?.modalReports ?? [];

    const theme = useTheme();

    const isInterstitialSystemMessage =
      conversationMessage.message.type === MessageType.System &&
      isInterstitialMessageData(conversationMessage.message.data);
    const isAgentSystemMessage =
      conversationMessage.message.type === MessageType.System &&
      (conversationMessage.message.data?.type === "AGENT" ||
        conversationMessage.message.data?.type === "SESSION_MONITOR") &&
      conversationMessage.state !== "system_processing";
    const agentMessageData = isAgentSystemMessage
      ? (conversationMessage.message.data as AgentSystemMessageData)
      : isInterstitialSystemMessage
        ? (conversationMessage.message.data as AgentSystemMessageData)
        : undefined;
    const parsedInterstitialTiming = isInterstitialSystemMessage
      ? getInterstitialTiming(
          conversationMessage.message.type === MessageType.System
            ? conversationMessage.message.data.response
            : null,
        )
      : null;
    const nextTimelineMessage = conversationTimeline[messageIndex + 1]?.message;
    const isTrailingInterstitial =
      isInterstitialSystemMessage && !nextTimelineMessage;
    const isPhaseControlledInterstitial =
      agentSessionId !== undefined || agentSessionCurrentState !== undefined;
    const interstitialTiming =
      parsedInterstitialTiming &&
      (!parsedInterstitialTiming.endAt ||
        parsedInterstitialTiming.endAt === parsedInterstitialTiming.startAt) &&
      nextTimelineMessage
        ? {
            ...parsedInterstitialTiming,
            endAt: nextTimelineMessage.createdAt,
          }
        : parsedInterstitialTiming;
    const isInterstitialActive =
      isInterstitialSystemMessage &&
      isTrailingInterstitial &&
      messageIndex === totalMessages - 1 &&
      (isPhaseControlledInterstitial
        ? agentSessionCurrentState === AgentSessionCurrentState.Thinking
        : conversationMessage.state !== "completed" &&
          conversationMessage.state !== "error");
    const taskMonitorSupervisionData = isTaskMonitorSupervisionMessage(
      conversationMessage.message,
    )
      ? conversationMessage.message.data
      : undefined;
    const taskMonitorInterventionData = isTaskMonitorInterventionMessage(
      conversationMessage.message,
    )
      ? conversationMessage.message.data
      : undefined;

    return (
      <Box
        sx={{ mb: 10, minWidth: 0, maxWidth: "100%" }}
        data-testid={dataTestId || conversationMessage.message.id}
        data-message-id={conversationMessage.message.id}
        data-operation-id={
          conversationMessage.message.executionOperationId ?? undefined
        }
        data-step-index={messageIndex}
      >
        {conversationMessage.message.executionStatus === "failed" && (
          <Typography role="status" variant="caption" color="text.secondary">
            Could not start
          </Typography>
        )}
        <Box>
          {isUserMessage ? (
            <UserMessageBubble
              identity={conversationMessage.message.id}
              data-testid={`user-message-${conversationMessage.message.id}`}
              text={userMessageDisplayText}
              provenance={userMessageProvenance}
              attachments={userMessage?.data.attachments}
              author={
                userMessage?.user?.name
                  ? {
                      name: userMessage.user.name,
                      id: userMessage.userId ?? null,
                    }
                  : null
              }
              createdAt={conversationMessage.message.createdAt}
              renderTimestamp={
                renderTimestamp &&
                conversationMessage.state !== "system_processing"
              }
              projectId={project.id}
              delivery={{ state: "delivered" }}
            >
              {proposalsRenderConfig.autoRender && (
                <MessageProposals
                  conversationMessage={conversationMessage}
                  disabled={isReadOnly}
                />
              )}
            </UserMessageBubble>
          ) : (
            <>
              {taskMonitorInterventionData ? (
                <TaskMonitorInterventionMessage
                  data={taskMonitorInterventionData}
                />
              ) : taskMonitorSupervisionData ? (
                <SupervisionDecisionMessage data={taskMonitorSupervisionData} />
              ) : (
                /* Show system response with typing animation */
                (conversationMessage.message.data?.response ||
                  inlineReports.length > 0 ||
                  conversationMessage.state === "error") &&
                !shouldHideSystemMessage && (
                  <SystemMessageWithRetry
                    animationType={animationType}
                    enableTypingAnimation={enableTypingAnimation}
                    uiHints={uiHints}
                    message={conversationMessage.message}
                    state={conversationMessage.state}
                    project={project}
                    onRetrySuccess={handleRetrySuccess}
                    renderTimestamp={renderTimestamp}
                    sx={
                      conversationMessage.message.data?.type ===
                      "SESSION_MONITOR"
                        ? getMonitorVisualTreatmentSx(theme)
                        : undefined
                    }
                    inlineReports={inlineReports}
                  />
                )
              )}

              {conversationMessage.message.type === MessageType.System &&
                conversationMessage.message.data?.response ===
                  TERMINAL_CAPACITY_MESSAGE && (
                  <Button
                    sx={{ mt: 1 }}
                    variant="outlined"
                    disabled={retryOpenTrigger.isPending || isReadOnly}
                    onClick={() =>
                      void retryOpenTrigger.mutate({
                        organizationId: project.organizationId,
                        projectId: project.id,
                        conversationId: activeConversation.id,
                      })
                    }
                  >
                    {retryOpenTrigger.isPending ? "Retrying…" : "Retry"}
                  </Button>
                )}

              {/* Show analysis display for ANALYSIS type messages */}
              {!hideAnalysisAction &&
                conversationMessage.message.data?.type === "ANALYSIS" &&
                conversationMessage.message.type === MessageType.System &&
                (conversationMessage.message as SystemMessageType)
                  .awaitingResponse && (
                  <AnalysisMessage
                    data={
                      conversationMessage.message
                        .data as AnalysisSystemMessageData
                    }
                    response={conversationMessage.message.data?.response || ""}
                    onAcknowledge={() => {
                      handleAnalysisAcknowledged(
                        conversationMessage.message.id,
                      );
                    }}
                    isSubmitting={isSubmitting || isReadOnly}
                  />
                )}

              {proposalsRenderConfig.autoRender &&
                proposalsRenderConfig.placement === "above-element" && (
                  <MessageProposals
                    conversationMessage={conversationMessage}
                    disabled={isReadOnly}
                  />
                )}

              {/* Render forms (skeleton and dynamic forms) */}
              {resolvedForm && (
                <ConversationFormRenderer
                  conversationMessage={conversationMessage}
                  messageIndex={messageIndex}
                  totalMessages={totalMessages}
                  resolvedForm={resolvedForm}
                />
              )}

              {proposalsRenderConfig.autoRender &&
                proposalsRenderConfig.placement === "below-element" && (
                  <MessageProposals
                    conversationMessage={conversationMessage}
                    disabled={isReadOnly}
                  />
                )}

              <ReportActions reports={modalReports} topMargin={1} />
            </>
          )}

          {/* Debug: show search logs for this message */}
          {/* {isDebugEnabled && (
                <Box sx={{ mt: 1 }}>
                  <SearchDebugDialog
                    messageId={
                      conversationMessage.message.responses?.[0]?.id as string
                    }
                    organizationId={project.organizationId}
                    projectId={project.id}
                  />
                </Box>
              )} */}
          {!isUserMessage && (
            <MessageAuthorCaption
              messageId={conversationMessage.message.id}
              createdAt={conversationMessage.message.createdAt}
              renderTimestamp={
                renderTimestamp &&
                (isInterstitialSystemMessage ||
                  conversationMessage.state !== "system_processing")
              }
              isInterstitialMessage={isInterstitialSystemMessage}
              interstitialActive={isInterstitialActive}
              interstitialTiming={interstitialTiming}
              messageData={agentMessageData}
              projectId={project.id}
              sx={{
                display: "block",
                ...(isInterstitialSystemMessage
                  ? { ml: 5, mt: 0.5, mb: 2.5 }
                  : { mt: 1, mb: 2 }),
              }}
            />
          )}
        </Box>
      </Box>
    );
  },
);
