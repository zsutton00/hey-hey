import { useState, useCallback, useEffect } from "react";
import { useConversationEvents } from "./useConversationEvents";
import type {
  ConversationResponseDto,
  ProjectResponseDto,
  CreateUserMessage,
  MessageResponseDto,
  OnboardingReplyAnswers,
  RepositoryImportReplyAnswers,
  UserMessageDataWorkflowDefined,
} from "../../../api";
import {
  MessageType,
  MessageStatus,
  UserMessageDataWorkflowDefinedPromptTypeEnum,
} from "../../../api";
import type {
  VersionConflictError,
  VersionConflictDialogState,
} from "../../../types/conversation";
import { isVersionConflictError } from "../../../types/conversation";
import { createVersionAwareUserMessage } from "../../../utils/conversationVersionHelpers";
import { useRetryWithBackoff } from "../../../hooks/useRetryWithBackoff";
import { logVersionInfo } from "../../../utils/versionUtils";
import type { FormValue } from "../../LlmForms/types";
import type { SecondaryActionSubmitOptions } from "../../LlmForms/Registry/types";
import { submitControllerAuthorizedWorkflowAnswer } from "../../../data/hooks/submitControllerAuthorizedWorkflowAnswer";
import { useConversationMessages } from "../../../data/hooks/useConversationMessages";
import { classifyWorkflowSubmission } from "../utils/conversationFormHelpers";
import {
  projectOnboardingReviewAnswers,
  projectRepositoryImportReviewAnswers,
} from "../utils/onboardingReviewSubmission";

export interface OnboardingReplySubmission {
  parentMessageId: string;
  answers: OnboardingReplyAnswers;
}

export interface RepositoryImportReplySubmission {
  parentMessageId: string;
  expectedConversationVersion: number;
  answers: RepositoryImportReplyAnswers;
}

const getLatestSystemNodeId = (
  orderedMessages: readonly MessageResponseDto[]
): string | null => {
  for (let index = orderedMessages.length - 1; index >= 0; index -= 1) {
    const message = orderedMessages[index];
    if (message?.type !== MessageType.System) continue;
    const nodeId = message.data.nodeId?.trim();
    if (nodeId) return nodeId;
  }
  return null;
};

const LEGACY_REPOSITORY_IMPORT_NODE_IDS = new Set([
  "onboarding-repository-grounding-prerequisites",
  "onboarding-repository-grounding-configuration",
  "onboarding-repository-grounding-start",
  "onboarding-repository-grounding-analysis",
  "onboarding-repository-feature-enrichment",
  "onboarding-repository-feature-enrichment-questions",
  "onboarding-repository-feature-enrichment-recovery",
  "onboarding-repository-grounding-recovery",
  "onboarding-repository-placement-strategy",
  "onboarding-repository-placement-agent",
  "onboarding-repository-placement-review",
]);

const findMessageById = (
  messages: readonly MessageResponseDto[],
  messageId: string
): MessageResponseDto | undefined => {
  for (const message of messages) {
    if (message.id === messageId) return message;
    const nested = findMessageById(message.responses ?? [], messageId);
    if (nested) return nested;
  }
  return undefined;
};

const isLegacyRepositoryImportReply = (
  conversation: ConversationResponseDto,
  messages: readonly MessageResponseDto[],
  parentMessageId: string
): boolean => {
  if (conversation.workflowName !== "onboarding") return false;
  const parent = findMessageById(messages, parentMessageId);
  if (!parent || parent.type !== MessageType.System) return false;
  const nodeId = parent.data.nodeId;
  if (!nodeId) return false;
  if (LEGACY_REPOSITORY_IMPORT_NODE_IDS.has(nodeId)) return true;

  // The pre-cutover flow shared this node with ordinary onboarding. Only the
  // repository form carries the typed analysis completion, so ordinary
  // onboarding must remain on onboarding admission.
  return (
    nodeId === "shared-generate-features" &&
    "repositoryGroundingCompletion" in parent.data &&
    parent.data.repositoryGroundingCompletion !== undefined
  );
};

/**
 * A resolved submission request only means the reply was handed off; the
 * workflow may persist it later. The submission stays locked until the
 * answered message carries a USER reply — the same signal that makes the form
 * read as completed — so the form never re-enables in between. Other workflow
 * activity (a status flip or a new message) can land before the reply and
 * must not unlock it.
 */
const hasObservedProgress = (
  parentMessageId: string,
  conversation: ConversationResponseDto,
  messages: readonly MessageResponseDto[]
): boolean => {
  if (conversation.status === "FAILED") return true;
  const parent = findMessageById(messages, parentMessageId);
  if (!parent) return true;
  return Boolean(parent.responses?.some((r) => r.type === MessageType.User));
};

const addWorkflowFollowupInput = (
  data: Record<string, FormValue>,
  userMessage: string
): Record<string, FormValue> => {
  const agentInput = {
    promptType: UserMessageDataWorkflowDefinedPromptTypeEnum.WorkflowDefined,
    userMessage,
  } satisfies UserMessageDataWorkflowDefined;

  return { ...data, agentInput };
};

interface UseConversationSubmissionProps {
  activeConversation: ConversationResponseDto;
  project: ProjectResponseDto;
  agentSessionId?: string;
  onDirectTrigger?: (message: CreateUserMessage) => Promise<void>;
  onPersistMessage?: (message: CreateUserMessage) => Promise<void>;
  onSubmitOnboardingReply?: (
    submission: OnboardingReplySubmission
  ) => Promise<void>;
  onSubmitRepositoryImportReply?: (
    submission: RepositoryImportReplySubmission
  ) => Promise<void>;
  onConversationUpdated?: () => Promise<void>;
}

interface UseConversationSubmissionReturn {
  isSubmitting: boolean;
  versionConflictDialog: VersionConflictDialogState | null;
  handleNext: (
    data: Record<string, FormValue>,
    parentMessageId: string,
    options?: SecondaryActionSubmitOptions
  ) => Promise<void>;
  handleRetrySuccess: () => Promise<void>;
  handleAnalysisAcknowledged: (messageId: string) => Promise<void>;
}

/**
 * Manages form submission, optimistic updates, and error handling for conversation interactions.
 * Extracted from ConversationViewer.tsx handleNext function and related state management.
 *
 * CRITICAL: Maintains exact submission flow while breaking circular dependencies using events.
 *
 * @param props Configuration for submission handling
 * @returns Submission state and handlers
 */
export const useConversationSubmission = ({
  activeConversation,
  project,
  agentSessionId,
  onDirectTrigger,
  onPersistMessage,
  onSubmitOnboardingReply,
  onSubmitRepositoryImportReply,
  onConversationUpdated,
}: UseConversationSubmissionProps): UseConversationSubmissionReturn => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [awaitingProgress, setAwaitingParentMessageId] = useState<string | null>(
    null
  );
  const [versionConflictDialog, setVersionConflictDialog] =
    useState<VersionConflictDialogState | null>(null);

  const { emit, on } = useConversationEvents(activeConversation.id);
  const { retryWithBackoff } = useRetryWithBackoff();
  // Observes the conversation's shared message cache; the viewer owns fetching.
  const conversationMessages = useConversationMessages(
    project.organizationId,
    project.id,
    activeConversation.id,
    {
      refetchOnMount: false,
      refetchOnStale: false,
    }
  );

  const isAwaitingProgress =
    awaitingProgress !== null &&
    !hasObservedProgress(
      awaitingProgress,
      activeConversation,
      conversationMessages.data
    );

  useEffect(() => {
    if (awaitingProgress && !isAwaitingProgress) setAwaitingParentMessageId(null);
  }, [awaitingProgress, isAwaitingProgress]);

  // Handle version conflicts with dialog
  const handleVersionConflict = useCallback(
    (
      error: VersionConflictError,
      originalFormData: Record<string, FormValue>,
      parentMessageId: string,
      options?: SecondaryActionSubmitOptions
    ) => {
      logVersionInfo("Handling version conflict in ConversationViewer", {
        conversationId: activeConversation.id,
        expectedVersion: error.expectedVersion,
        currentVersion: error.currentVersion,
        action: "version_conflict_dialog",
      });

      // Show conflict resolution dialog
      setVersionConflictDialog({
        isOpen: true,
        expectedVersion: error.expectedVersion,
        currentVersion: error.currentVersion,
        latestConversation: error.latestConversation,
        originalFormData,
        onRetry: (updatedFormData) => {
          setVersionConflictDialog(null);
          // Emit retry event instead of direct call to break circular dependency
          emit({
            type: "retry-requested",
            payload: {
              data: updatedFormData as Record<string, FormValue>,
              parentId: parentMessageId,
              options,
            },
          });
        },
        onCancel: () => {
          setVersionConflictDialog(null);
        },
      });
    },
    [activeConversation.id, emit]
  );

  // Enhanced handle form submission with version checking
  const handleNext = useCallback(
    async (
      data: Record<string, FormValue>,
      parentMessageId: string,
      options?: SecondaryActionSubmitOptions
    ) => {
      if (!activeConversation || !project) {
        console.error("Missing required data for message submission");
        return;
      }

      const isLegacyRepositoryImport = isLegacyRepositoryImportReply(
        activeConversation,
        conversationMessages.data,
        parentMessageId
      );
      const isRepositoryImportConversation =
        activeConversation.workflowName === "repository-import" ||
        isLegacyRepositoryImport;
      const isOnboardingConversation =
        activeConversation.workflowName === "onboarding" &&
        !isLegacyRepositoryImport;
      const workflowSubmission =
        !isOnboardingConversation &&
        !isRepositoryImportConversation &&
        activeConversation.workflowId
          ? classifyWorkflowSubmission(data)
          : null;
      const messageData =
        workflowSubmission?.kind === "conversational-text"
          ? addWorkflowFollowupInput(data, workflowSubmission.userMessage)
          : data;

      // Create version-aware user message
      const userMessage = createVersionAwareUserMessage(
        messageData,
        parentMessageId,
        activeConversation,
        project.id,
        options?.handler as CreateUserMessage["handler"] | undefined
      );

      setIsSubmitting(true);
      setAwaitingParentMessageId(null);
      const workflowAnswerOperationId =
        workflowSubmission?.kind === "structured-answer"
          ? crypto.randomUUID()
          : null;

      try {
        if (isOnboardingConversation) {
          if (!onSubmitOnboardingReply) {
            throw new Error(
              "This onboarding conversation has no reply submission owner."
            );
          }

          await onSubmitOnboardingReply({
            parentMessageId,
            answers: projectOnboardingReviewAnswers(data),
          });
        } else if (isRepositoryImportConversation) {
          if (!onSubmitRepositoryImportReply) {
            throw new Error(
              "This repository import has no reply submission owner."
            );
          }
          await onSubmitRepositoryImportReply({
            parentMessageId,
            expectedConversationVersion: activeConversation.version,
            answers: projectRepositoryImportReviewAnswers(data),
          });
        } else if (workflowSubmission?.kind === "structured-answer") {
          // Workflow answers reuse the operation identity allocated above, so
          // transport retries remain safe on their dedicated durable rail.
          await retryWithBackoff(
            async () => {
              if (!workflowAnswerOperationId) {
                throw new Error(
                  "The workflow answer is missing its operation identity."
                );
              }
              if (!agentSessionId) {
                throw new Error(
                  "Agent session is required before submitting a workflow answer."
                );
              }
              const nodeId =
                options?.nodeId?.trim() ||
                getLatestSystemNodeId(conversationMessages.orderedData);
              if (!nodeId) {
                throw new Error(
                  "The workflow answer is missing the source message nodeId."
                );
              }
              await submitControllerAuthorizedWorkflowAnswer({
                operationId: workflowAnswerOperationId,
                organizationId: project.organizationId,
                projectId: project.id,
                agentSessionId,
                conversationId: activeConversation.id,
                workflowName: activeConversation.workflowName,
                nodeId,
                parentMessageId,
                action: workflowSubmission.action,
                payload: workflowSubmission.payload,
              });
            },
            { maxRetries: 3, baseDelay: 1000, maxDelay: 5000 },
            `workflow-answer-${activeConversation.id}`
          );
        } else {
          if (onDirectTrigger) {
            // One explicit gesture creates one operation. A changed-intent
            // conflict is surfaced for a fresh user-confirmed submission rather
            // than replaying operation creation under generic backoff.
            await onDirectTrigger(userMessage);
          } else if (onPersistMessage) {
            await retryWithBackoff(
              () => onPersistMessage(userMessage),
              {
                maxRetries: 3,
                baseDelay: 1000,
                maxDelay: 5000,
                onRetry: (_attempt: number, error: unknown) => {
                  if (
                    isVersionConflictError(error) &&
                    error.latestConversation
                  ) {
                    userMessage.expectedConversationVersion =
                      error.latestConversation.version;
                  }
                },
              },
              `message-persistence-${activeConversation.id}`
            );
          } else {
            throw new Error(
              "This conversation has no message submission owner."
            );
          }
        }

        console.log("📤 Message sent successfully, waiting for updates...");

        setAwaitingParentMessageId(parentMessageId);
        await onConversationUpdated?.();

        // Emit success event
        emit({
          type: "submission-success",
          payload: {
            messageId: userMessage.parentMessageId || "unknown",
            data,
          },
        });
      } catch (error) {
        if (isVersionConflictError(error)) {
          // Emit version conflict event instead of direct function call
          emit({
            type: "version-conflict",
            payload: {
              error,
              retryFn: async (retryData: Record<string, FormValue>) => {
                await handleNext(retryData, parentMessageId, options);
              },
              originalFormData: data,
              parentMessageId,
              options,
            },
          });
        } else {
          console.error("Failed to send user message:", error);

          // Emit error event
          emit({
            type: "submission-error",
            payload: { error, data, parentMessageId },
          });
        }
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      activeConversation,
      project,
      agentSessionId,
      onDirectTrigger,
      onPersistMessage,
      onSubmitOnboardingReply,
      onSubmitRepositoryImportReply,
      onConversationUpdated,
      emit,
      retryWithBackoff,
      conversationMessages.data,
      conversationMessages.orderedData,
    ]
  );

  // Handle analysis acknowledgment
  const handleAnalysisAcknowledged = useCallback(
    async (messageId: string) => {
      if (!activeConversation || !project) {
        console.error("Missing required data for analysis acknowledgment");
        return;
      }

      const userMessage: CreateUserMessage = {
        projectId: project.id,
        data: { message: "acknowledged" },
        type: MessageType.User,
        conversationId: activeConversation.id,
        status: MessageStatus.Completed,
        parentMessageId: messageId,
      };

      setIsSubmitting(true);
      setAwaitingParentMessageId(null);

      try {
        if (activeConversation.workflowName === "onboarding") {
          if (!onSubmitOnboardingReply) {
            throw new Error(
              "This onboarding conversation has no reply submission owner."
            );
          }

          await onSubmitOnboardingReply({
            parentMessageId: messageId,
            answers: { message: "acknowledged" },
          });
        } else if (onDirectTrigger) {
          await onDirectTrigger(userMessage);
        } else if (onPersistMessage) {
          await onPersistMessage(userMessage);
        } else {
          throw new Error("This conversation has no message submission owner.");
        }

        console.log("📤 Analysis acknowledged, waiting for updates...");

        setAwaitingParentMessageId(messageId);
        await onConversationUpdated?.();

        // Emit acknowledgment event
        emit({
          type: "analysis-acknowledged",
          payload: { messageId },
        });
      } catch (error) {
        console.error("Failed to send acknowledgment:", error);

        // Emit error event
        emit({
          type: "submission-error",
          payload: {
            error,
            data: { message: "acknowledged" },
            parentMessageId: messageId,
          },
        });
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      activeConversation,
      project,
      onConversationUpdated,
      onDirectTrigger,
      onPersistMessage,
      onSubmitOnboardingReply,
      emit,
    ]
  );

  // Handle retry success after system message retry
  const handleRetrySuccess = useCallback(async () => {
    console.log("📤 Retry successful, waiting for updates...");

    await onConversationUpdated?.();

    // Emit retry success event
    emit({
      type: "retry-success",
      payload: { messageId: "retry-success" },
    });
  }, [onConversationUpdated, emit]);

  // Handle version conflicts via events instead of circular calls
  useEffect(() => {
    const unsubscribeConflict = on("version-conflict", (event) => {
      if (event.type === "version-conflict") {
        handleVersionConflict(
          event.payload.error,
          event.payload.originalFormData,
          event.payload.parentMessageId,
          event.payload.options
        );
      }
    });

    const unsubscribeRetry = on("retry-requested", async (event) => {
      if (event.type === "retry-requested") {
        await handleNext(
          event.payload.data,
          event.payload.parentId,
          event.payload.options
        );
      }
    });

    return () => {
      unsubscribeConflict();
      unsubscribeRetry();
    };
  }, [on, handleNext, handleVersionConflict]);

  return {
    isSubmitting: isSubmitting || isAwaitingProgress,
    versionConflictDialog,
    handleNext,
    handleRetrySuccess,
    handleAnalysisAcknowledged,
  };
};
