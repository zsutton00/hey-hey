import type { TriageApplicationCoordinator } from "../../../data/triage/application";
import type { OpenItemsTriageItem } from "../../../api";
import { useConversationMessages } from "../../../data/hooks/useConversationMessages";
import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { selectAtom } from "jotai/utils";
import type {
  ConversationResponseDto,
  CreateUserMessage,
  GoalPmRoutingSelectionPayload,
  GoalPmRoutingCreation,
  GoalPmRoutingEnactmentResponse,
  MessageResponseDto,
  ProjectResponseDto,
} from "../../../api";
import {
  AgentSessionCurrentState,
  ConversationStatus,
  MessageStatus,
  MessageType,
} from "../../../api";
import type { SystemMessageData } from "../../../api";
import { useUserIdentity } from "../../../hooks";
import { useCliRequired } from "../../AgentSession/runtime/hooks/useCliRequired";
import {
  useLatestTurnToolCalls,
  type LatestTurnToolCallsState,
} from "../../AgentSession/runtime/hooks/useLatestTurnToolCalls";
import { isInterstitialMessageData } from "../../LlmForms/Registry/InterstitialField";
import { useWorkflowStatus } from "../../../hooks/useWorkflowStatus";
import type {
  ConversationMessage,
  VersionConflictDialogState,
} from "../../../types/conversation";
import type { WorkflowState } from "../../../types/WorkflowState";
import type { FormValue } from "../../LlmForms/types";
import type {
  GoalPmConversationLink,
  SecondaryActionSubmitOptions,
} from "../../LlmForms/Registry/types";
import type { DiffViewMode } from "../../SuggestedContent";
import { useConversationScrolling, useConversationSubmission } from "../hooks";
import type {
  OnboardingReplySubmission,
  RepositoryImportReplySubmission,
} from "../hooks/useConversationSubmission";
import {
  ConversationScrollPolicyContext,
  type ConversationScrollPolicy,
} from "../hooks/useConversationScrolling";
import {
  isEmptyExternalAgentCompletionMessage,
  isAgentHiddenSystemMessage,
  isExternalAgentTriggerMessage,
  isHiddenQuestionsMessage,
  isRoutingMessage,
} from "../utils";
import { determineMessageState } from "../utils/messageStateUtils";
import {
  applyVisualPreviewPresentationState,
  resolveCurrentVisualPreviewProposalIds,
} from "../utils/visualPreviewPresentation";
import type { SuggestionDecisionState } from "../hooks/useSuggestionDecisions";
import type {
  ProposalsAcceptedHandler,
  MessageInteractionContext,
} from "../hooks/proposalsAcceptedTypes";
import { useConversationProposalInteraction } from "../hooks/useConversationProposalInteraction";
import type {
  ConversationFormResolver,
  ConversationResponseTarget,
  ResponseTargetChangeHandler,
} from "./conversationFormTypes";
import {
  NO_RESPONSE_TARGET,
  resolveConversationResponseModel,
  type ResolvedConversationForm,
} from "../utils/conversationResponseModel";
import {
  clearConversationRealtimePatches,
  clearMessageRealtimePatches,
  messageRealtimeByConversationAtom,
  type ConversationRealtimeState,
  type MessageRealtimePatch,
} from "../../../data/websockets/messageRealtimeState";

/**
 * Centralized context value for conversation state and actions.
 * Eliminates prop drilling and provides clean separation of concerns.
 */
interface ConversationContextValue {
  // Core Data
  conversationTimeline: ConversationMessage[];
  /** Proposal IDs of the current visual-preview round, if one is presented. */
  currentVisualPreviewProposalIds?: string[];
  resolvedForms: Map<string, ResolvedConversationForm>;
  activeConversation: ConversationResponseDto;
  messages: MessageResponseDto[];
  messagesError: Error | null;
  messagesReady: boolean;
  initialScrollReady: boolean;
  hasOlderMessages: boolean;
  isLoadingOlderMessages: boolean;
  olderMessagesError: Error | null;
  project: ProjectResponseDto;
  agentSessionCurrentState?: AgentSessionCurrentState;
  /** The current Turn's tool calls, polled once for the whole conversation. */
  latestTurnToolCalls: LatestTurnToolCallsState;
  /** True once the timeline contains an interstitial (narration) message. */
  hasInterstitialInTimeline: boolean;
  workflowStatus: WorkflowState;
  agentSessionId?: string;
  taskMonitorId?: string;
  conversationFormResolver?: ConversationFormResolver;
  planId?: string;
  stepId?: string;
  navigate?: (url: string) => void;
  triageApplication?: TriageApplicationCoordinator;
  triageItemHref?: (item: OpenItemsTriageItem) => string;
  onGoalPmAction?: (
    selection: GoalPmRoutingSelectionPayload,
    sourceConversationId: string,
    creation?: GoalPmRoutingCreation,
  ) => Promise<GoalPmRoutingEnactmentResponse>;
  goalPmConversationLink?: GoalPmConversationLink;
  onFocusComposer?: () => void;

  // Submission State
  isSubmitting: boolean;
  versionConflictDialog: VersionConflictDialogState | null;

  // Actions
  handleNext: (
    data: Record<string, FormValue>,
    parentMessageId: string,
    options?: SecondaryActionSubmitOptions,
  ) => Promise<void>;
  handleRetrySuccess: () => Promise<void>;
  handleAnalysisAcknowledged: (messageId: string) => Promise<void>;
  handleStepClick: (stepIndex: number, message: MessageResponseDto) => void;
  loadOlderMessages: () => Promise<void>;

  // UI Props
  animationType: "fun" | "minimal";
  isGeneratingResponse: boolean;

  // Suggestion decisions
  suggestionDecisions: SuggestionDecisionState;

  // Read-only mode
  isReadOnly: boolean;
  composerResetMode: "preserve" | "clearOnSuccess";

  /**
   * When true, all conversation input surfaces (forms, secondary action
   * buttons) must render with `disabled`. Set by CLI-presence gating for
   * agent-driven conversations: while the server has not confirmed that the
   * selected machine is execution-ready, inputs are disabled (fail-closed). Always
   * `false` for non-agent conversations (no `agentSessionId`).
   */
  isCliInputDisabled: boolean;
  selectedMachineId: string | null;

  // Hide analysis action button
  hideAnalysisAction: boolean;

  // Default view mode applied to diffs rendered inside UPDATE proposals.
  proposalDiffDefaultViewMode?: DiffViewMode;

  // Fired by MessageProposals when an approval drives all proposals on a
  // single SystemMessage to a terminal state.
  onProposalsAccepted?: ProposalsAcceptedHandler;
  proposalInteraction: MessageInteractionContext;
}

const ConversationContext = createContext<ConversationContextValue | null>(
  null,
);

interface ConversationProviderProps {
  children: React.ReactNode;
  conversation: ConversationResponseDto | null;
  project: ProjectResponseDto;
  agentSessionId?: string;
  agentSessionCurrentState?: AgentSessionCurrentState;
  taskMonitorId?: string;
  conversationFormResolver?: ConversationFormResolver;
  onResponseTargetChange?: ResponseTargetChangeHandler;
  planId?: string;
  stepId?: string;
  animationType?: "fun" | "minimal";
  renderNestedUserMessages?: boolean;
  scrollPolicy: ConversationScrollPolicy;
  readOnly?: boolean;
  composerResetMode?: "preserve" | "clearOnSuccess";
  hideAnalysisAction?: boolean;
  navigate?: (url: string) => void;
  onDirectTrigger?: (message: CreateUserMessage) => Promise<void>;
  onPersistMessage?: (message: CreateUserMessage) => Promise<void>;
  onSubmitOnboardingReply?: (
    submission: OnboardingReplySubmission,
  ) => Promise<void>;
  onSubmitRepositoryImportReply?: (
    submission: RepositoryImportReplySubmission,
  ) => Promise<void>;
  onConversationUpdated?: () => Promise<void>;
  suggestionDecisions: SuggestionDecisionState;
  proposalDiffDefaultViewMode?: DiffViewMode;
  onProposalsAccepted?: ProposalsAcceptedHandler;
  triageApplication?: TriageApplicationCoordinator;
  triageItemHref?: (item: OpenItemsTriageItem) => string;
  onGoalPmAction?: (
    selection: GoalPmRoutingSelectionPayload,
    sourceConversationId: string,
    creation?: GoalPmRoutingCreation,
  ) => Promise<GoalPmRoutingEnactmentResponse>;
  goalPmConversationLink?: GoalPmConversationLink;
  onFocusComposer?: () => void;
}

type SystemConversationMessage = Extract<
  MessageResponseDto,
  { type: "SYSTEM" }
>;

const ACTIVE_TURN_STATES: readonly AgentSessionCurrentState[] = [
  AgentSessionCurrentState.Starting,
  AgentSessionCurrentState.GatheringContext,
  AgentSessionCurrentState.Thinking,
  AgentSessionCurrentState.Writing,
];

const EMPTY_REALTIME_PATCHES: Record<string, MessageRealtimePatch> = {};

const getOverlayResponse = (
  realtimePatch: MessageRealtimePatch | undefined,
): string | null => {
  const overlayResponse =
    realtimePatch?.response ??
    realtimePatch?.loadingText ??
    realtimePatch?.currentStep ??
    realtimePatch?.status ??
    realtimePatch?.error;

  return typeof overlayResponse === "string" && overlayResponse.length > 0
    ? overlayResponse
    : null;
};

const filterRoutingMessages = (
  timeline: ConversationMessage[],
): ConversationMessage[] => {
  return timeline.filter((conversationMessage, index) => {
    if (conversationMessage.message.type !== MessageType.System) {
      return true;
    }

    const isRouting = isRoutingMessage(conversationMessage.message);
    if (!isRouting) {
      return true;
    }

    return index === timeline.length - 1;
  });
};

const hasNonEmptyStringField = (
  value: unknown,
  key: "comment" | "text",
): boolean => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const fieldValue = (value as Record<string, unknown>)[key];
  return typeof fieldValue === "string" && fieldValue.trim().length > 0;
};

// Genuine user-typed text now lives in the `agentInput.userMessage` envelope —
// the run-kickoff path stamps the same field the follow-up path does, after the
// coordinated drop of `additionalInstructions` from the start-run payloads.
// Unlike form-submission data, this is real prose the user wrote, so it renders
// as a bubble at any depth — not just at the top level.
const hasAgentInputText = (value: unknown): boolean => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const agentInput = (value as { agentInput?: unknown }).agentInput;
  if (typeof agentInput !== "object" || agentInput === null) {
    return false;
  }

  const { userMessage } = agentInput as { userMessage?: unknown };

  return typeof userMessage === "string" && userMessage.trim().length > 0;
};

const USER_MESSAGE_METADATA_KEYS = new Set([
  "type",
  "triggersAgent",
  "comment",
  "text",
]);

const isDisplayableUserMessage = (
  message: MessageResponseDto,
  isTopLevel: boolean,
): boolean => {
  if (message.type !== MessageType.User) {
    return false;
  }

  if (typeof message.data !== "object" || message.data === null) {
    return false;
  }

  if (hasNonEmptyStringField(message.data, "comment")) {
    return true;
  }

  if (hasNonEmptyStringField(message.data, "text")) {
    return true;
  }

  if (hasAgentInputText(message.data)) {
    return true;
  }

  // No comment/text content. Form-submission data shows as a bubble only
  // at the top level — nested form responses are already rehydrated into
  // the parent QUESTIONS form, so a separate bubble would duplicate them.
  // This also keeps `{comment: ""}` gate-advancing submissions filtered.
  if (!isTopLevel) {
    return false;
  }

  const data = message.data as Record<string, unknown>;
  return Object.keys(data).some((key) => !USER_MESSAGE_METADATA_KEYS.has(key));
};

const appendMessageTreeToTimeline = (
  message: MessageResponseDto,
  timeline: ConversationMessage[],
  renderNestedUserMessages: boolean,
  depth = 0,
): void => {
  const isTopLevelMessage = depth === 0;

  if (
    message.type === MessageType.User &&
    isDisplayableUserMessage(message, isTopLevelMessage) &&
    (isTopLevelMessage || renderNestedUserMessages)
  ) {
    timeline.push({
      message,
      state: determineMessageState(message),
      canEdit: false,
    });
  }

  if (message.type === MessageType.System) {
    const hasUserResponse = Boolean(
      message.responses?.some((response) => response.type === MessageType.User),
    );

    const isWorkflowPlumbing =
      isAgentHiddenSystemMessage(message) ||
      isExternalAgentTriggerMessage(message) ||
      isEmptyExternalAgentCompletionMessage(message) ||
      isHiddenQuestionsMessage(message);

    if (!isWorkflowPlumbing) {
      timeline.push({
        message,
        state: determineMessageState(message),
        canEdit: !hasUserResponse,
      });
    }
  }

  for (const response of message.responses ?? []) {
    appendMessageTreeToTimeline(
      response,
      timeline,
      renderNestedUserMessages,
      depth + 1,
    );
  }
};

const buildBaseConversationTimeline = (
  messages: MessageResponseDto[],
  renderNestedUserMessages: boolean,
): ConversationMessage[] => {
  if (messages.length === 0) {
    return [];
  }

  const timeline: ConversationMessage[] = [];

  for (const topLevelMessage of messages) {
    appendMessageTreeToTimeline(
      topLevelMessage,
      timeline,
      renderNestedUserMessages,
    );
  }

  return applyVisualPreviewPresentationState(
    filterRoutingMessages(timeline),
    messages,
  );
};

/**
 * The CLI doesn't always thread the next message as a nested response —
 * sometimes a follow-up arrives as a top-level sibling while the previous
 * SYSTEM message is still in `system_processing` (its status was never
 * flipped to completed). Demote any non-last `system_processing` entry to
 * `completed` so the thinking spinner stops once the conversation has
 * moved on, regardless of how the next message is threaded.
 */
const normalizeStaleProcessingState = (
  timeline: ConversationMessage[],
): ConversationMessage[] => {
  if (timeline.length < 2) {
    return timeline;
  }

  let hasStale = false;
  const normalized = timeline.map((entry, index) => {
    if (entry.state !== "system_processing") {
      return entry;
    }
    if (index === timeline.length - 1) {
      return entry;
    }
    hasStale = true;
    return { ...entry, state: "completed" as const };
  });

  return hasStale ? normalized : timeline;
};

const applyRealtimeOverlays = (
  baseConversationTimeline: ConversationMessage[],
  realtimePatchesByMessageId: Record<string, MessageRealtimePatch>,
): ConversationMessage[] => {
  if (
    baseConversationTimeline.length === 0 ||
    Object.keys(realtimePatchesByMessageId).length === 0
  ) {
    return baseConversationTimeline;
  }

  let hasOverlay = false;
  const overlayedTimeline = baseConversationTimeline.map(
    (conversationMessage) => {
      if (conversationMessage.message.type !== MessageType.System) {
        return conversationMessage;
      }

      const realtimePatch =
        realtimePatchesByMessageId[conversationMessage.message.id];
      const overlayResponse = getOverlayResponse(realtimePatch);
      const hasRealtimeMetadata = realtimePatch?.metadata !== undefined;
      if (!overlayResponse && !hasRealtimeMetadata) {
        return conversationMessage;
      }

      hasOverlay = true;
      const mergedMessage: SystemConversationMessage = {
        ...conversationMessage.message,
        ...(overlayResponse
          ? {
              data: {
                ...conversationMessage.message.data,
                response: overlayResponse,
              },
            }
          : {}),
      };

      return {
        ...conversationMessage,
        message: mergedMessage,
        state: overlayResponse
          ? determineMessageState(mergedMessage)
          : conversationMessage.state,
        ...(hasRealtimeMetadata
          ? {
              data: {
                ...conversationMessage.data,
                realtimeMetadata: realtimePatch.metadata,
              },
            }
          : {}),
      };
    },
  );

  return hasOverlay ? overlayedTimeline : baseConversationTimeline;
};

/**
 * Provides conversation context to all child components.
 * Centralizes state management from Phase 4 hooks and eliminates prop drilling.
 *
 * CRITICAL: Uses Phase 4 hooks for state management while providing clean
 * context interface to child components.
 *
 * @param props - Provider configuration props
 * @returns Context provider wrapping children
 */
export const ConversationProvider: React.FC<ConversationProviderProps> = ({
  children,
  conversation,
  project,
  agentSessionId,
  agentSessionCurrentState,
  taskMonitorId,
  conversationFormResolver,
  onResponseTargetChange,
  planId,
  stepId,
  animationType = "minimal",
  renderNestedUserMessages = false,
  scrollPolicy,
  readOnly = false,
  composerResetMode = "preserve",
  hideAnalysisAction = false,
  navigate,
  onDirectTrigger,
  onPersistMessage,
  onSubmitOnboardingReply,
  onSubmitRepositoryImportReply,
  onConversationUpdated,
  suggestionDecisions,
  proposalDiffDefaultViewMode,
  onProposalsAccepted,
  onGoalPmAction,
  triageApplication,
  triageItemHref,
  goalPmConversationLink,
  onFocusComposer,
}) => {
  const activeConversation = conversation;
  const activeConversationId = activeConversation?.id;
  const messageQuery = useConversationMessages(
    conversation?.organizationId,
    conversation?.projectId,
    conversation?.id,
    { refetchOnWindowFocus: true },
  );
  const messages = messageQuery.data;
  const proposalInteraction = useConversationProposalInteraction(messages);

  const activeConversationRealtimeAtom = useMemo(
    () =>
      selectAtom(
        messageRealtimeByConversationAtom,
        (realtimeStateByConversation): ConversationRealtimeState | undefined =>
          activeConversationId
            ? realtimeStateByConversation[activeConversationId]
            : undefined,
      ),
    [activeConversationId],
  );

  const activeConversationRealtimeState = useAtomValue(
    activeConversationRealtimeAtom,
  );
  const realtimePatchesByMessageId =
    activeConversationRealtimeState?.patchesByMessageId ??
    EMPTY_REALTIME_PATCHES;
  const setRealtimeStateByConversation = useSetAtom(
    messageRealtimeByConversationAtom,
  );
  const lastCanonicalConversationRef = useRef<{
    conversationId?: string;
    updatedAt?: string;
  }>({});

  const baseConversationTimeline = useMemo(
    () => buildBaseConversationTimeline(messages, renderNestedUserMessages),
    [activeConversationId, messages, renderNestedUserMessages],
  );
  const conversationTimeline = useMemo(
    () =>
      normalizeStaleProcessingState(
        applyRealtimeOverlays(
          baseConversationTimeline,
          realtimePatchesByMessageId,
        ),
      ),
    [baseConversationTimeline, realtimePatchesByMessageId],
  );
  const currentVisualPreviewProposalIds = useMemo(
    () => resolveCurrentVisualPreviewProposalIds(conversationTimeline),
    [conversationTimeline],
  );

  const terminalMessageIds = useMemo(() => {
    return baseConversationTimeline
      .filter(
        (message) =>
          message.message.status === MessageStatus.Completed ||
          message.message.status === MessageStatus.Failed,
      )
      .map((message) => message.message.id);
  }, [baseConversationTimeline]);

  useEffect(() => {
    if (!activeConversation?.id || terminalMessageIds.length === 0) {
      return;
    }

    setRealtimeStateByConversation((currentState) =>
      clearMessageRealtimePatches(
        currentState,
        activeConversation.id,
        terminalMessageIds,
      ),
    );
  }, [
    activeConversation?.id,
    terminalMessageIds,
    setRealtimeStateByConversation,
  ]);

  useEffect(() => {
    if (!activeConversation?.id) {
      return;
    }

    const previous = lastCanonicalConversationRef.current;
    const currentConversationId = activeConversation.id;
    const currentUpdatedAt = activeConversation.updatedAt;

    if (
      previous.conversationId &&
      previous.conversationId !== currentConversationId
    ) {
      setRealtimeStateByConversation((currentState) =>
        clearConversationRealtimePatches(
          currentState,
          previous.conversationId!,
        ),
      );
    }

    if (
      previous.conversationId === currentConversationId &&
      previous.updatedAt &&
      previous.updatedAt !== currentUpdatedAt
    ) {
      setRealtimeStateByConversation((currentState) =>
        clearConversationRealtimePatches(currentState, currentConversationId),
      );
    }

    lastCanonicalConversationRef.current = {
      conversationId: currentConversationId,
      updatedAt: currentUpdatedAt,
    };
  }, [
    activeConversation?.id,
    activeConversation?.updatedAt,
    setRealtimeStateByConversation,
  ]);

  // Get current user identity for workflow status
  const interstitialBodies = useMemo(
    () =>
      conversationTimeline.flatMap(({ message }) => {
        if (message.type !== MessageType.System) return [];
        const data = message.data as SystemMessageData;
        if (!isInterstitialMessageData(data)) return [];
        return [typeof data.response === "string" ? data.response : ""];
      }),
    [conversationTimeline],
  );
  const hasInterstitialInTimeline = interstitialBodies.length > 0;
  const latestTurnToolCalls = useLatestTurnToolCalls({
    organizationId: project.organizationId,
    projectId: project.id,
    agentSessionId,
    activityKey: interstitialBodies[interstitialBodies.length - 1] ?? "",
    enabled:
      agentSessionCurrentState !== undefined &&
      ACTIVE_TURN_STATES.includes(agentSessionCurrentState),
  });

  const userIdentity = useUserIdentity();
  const currentUserId = userIdentity?.userId || "";

  // CLI-presence gating: only fetched (and only relevant) for agent-driven
  // conversations. Fail-closed — inputs stay disabled until the server
  // confirms the selected machine is execution-ready.
  const cliStatusEnabled = !!agentSessionId && !!activeConversation?.id;
  const cliResult = useCliRequired(
    activeConversation?.organizationId,
    activeConversation?.projectId,
    activeConversation?.id,
    { enabled: cliStatusEnabled },
  );
  const isCliInputDisabled = cliStatusEnabled && cliResult.type !== "ready";

  // Get workflow status
  const workflowStatus = useWorkflowStatus({
    conversation: activeConversation || undefined,
    messages,
    currentUserId,
    isLoading: !messageQuery.isFetched,
  });

  const handleConversationUpdated = useCallback(async () => {
    await messageQuery.refetch();
    await onConversationUpdated?.();
  }, [messageQuery.refetch, onConversationUpdated]);

  // Phase 4 hooks integration
  const submissionState = useConversationSubmission({
    activeConversation: activeConversation!,
    project,
    ...(agentSessionId ? { agentSessionId } : {}),
    onDirectTrigger,
    onPersistMessage,
    onSubmitOnboardingReply,
    onSubmitRepositoryImportReply,
    onConversationUpdated: handleConversationUpdated,
  });

  const { handleStepClick, loadOlderMessages, initialScrollReady } =
    useConversationScrolling({
      scrollPolicy,
      conversationTimeline,
      conversationId: activeConversation?.id ?? null,
    });
  const loadOlderMessagesPreservingPosition = useCallback(
    () => loadOlderMessages(messageQuery.loadOlder),
    [loadOlderMessages, messageQuery.loadOlder],
  );

  const responseModel = useMemo(
    () =>
      resolveConversationResponseModel(conversationTimeline, messages, {
        resolver: conversationFormResolver,
        workflowCanSubmit: workflowStatus.canSubmit,
        isSubmitting: submissionState.isSubmitting,
        readOnly,
        isCliInputDisabled,
      }),
    [
      conversationTimeline,
      messages,
      conversationFormResolver,
      workflowStatus.canSubmit,
      submissionState.isSubmitting,
      readOnly,
      isCliInputDisabled,
    ],
  );
  const target = responseModel.target;
  const targetMessageId =
    target.ownership === "none" ? undefined : target.messageId;
  const targetFieldId =
    target.ownership === "none" ? undefined : target.currentFieldId;
  const targetSubmissionKind =
    target.ownership === "none" ? undefined : target.submissionKind;
  const targetUsable = target.ownership === "none" ? undefined : target.usable;
  const ownership = target.ownership;
  const publishedTarget = useMemo<ConversationResponseTarget>(() => {
    if (
      ownership === "none" ||
      targetMessageId === undefined ||
      targetFieldId === undefined ||
      targetSubmissionKind === undefined ||
      targetUsable === undefined
    ) {
      return NO_RESPONSE_TARGET;
    }
    return {
      ownership,
      messageId: targetMessageId,
      currentFieldId: targetFieldId,
      submissionKind: targetSubmissionKind,
      usable: targetUsable,
    };
  }, [
    ownership,
    targetMessageId,
    targetFieldId,
    targetSubmissionKind,
    targetUsable,
  ]);
  // A failed load settles with no target, so owners are never left waiting on it.
  useEffect(() => {
    if (activeConversationId)
      onResponseTargetChange?.(
        publishedTarget,
        activeConversationId,
        messageQuery.isFetched || Boolean(messageQuery.error),
      );
  }, [
    activeConversationId,
    publishedTarget,
    onResponseTargetChange,
    messageQuery.isFetched,
    messageQuery.error,
  ]);

  // Memoize context value to prevent unnecessary re-renders
  const contextValue = useMemo<ConversationContextValue>(() => {
    const isGeneratingResponse =
      activeConversation?.status === ConversationStatus.GeneratingResponse;

    if (!activeConversation) {
      // Return minimal context for loading state
      return {
        messages,
        messagesError: messageQuery.error,
        messagesReady: messageQuery.isFetched,
        initialScrollReady,
        hasOlderMessages: messageQuery.hasOlder,
        isLoadingOlderMessages: messageQuery.isLoadingOlder,
        olderMessagesError: messageQuery.olderError,
        conversationTimeline: [],
        resolvedForms: responseModel.forms,
        activeConversation: activeConversation!,
        project,
        agentSessionCurrentState,
        latestTurnToolCalls,
        hasInterstitialInTimeline,
        workflowStatus: {
          status: "loading",
          message: "Loading workflow status...",
          canSubmit: false,
          showLoader: true,
        },
        agentSessionId,
        taskMonitorId,
        conversationFormResolver,
        planId,
        stepId,
        navigate,
        isSubmitting: false,
        versionConflictDialog: null,
        handleNext: async () => {},
        handleRetrySuccess: async () => {},
        handleAnalysisAcknowledged: async () => {},
        handleStepClick: () => {},
        loadOlderMessages: loadOlderMessagesPreservingPosition,
        animationType,
        isGeneratingResponse: false,
        suggestionDecisions,
        isReadOnly: readOnly,
        composerResetMode,
        isCliInputDisabled,
        selectedMachineId:
          cliResult.type === "ready" ? cliResult.machine.machineId : null,
        hideAnalysisAction,
        proposalDiffDefaultViewMode,
        onProposalsAccepted,
        proposalInteraction,
        onGoalPmAction,
        triageApplication,
        triageItemHref,
        goalPmConversationLink,
        onFocusComposer,
      };
    }

    return {
      // Core Data
      messages,
      messagesError: messageQuery.error,
      messagesReady: messageQuery.isFetched,
      initialScrollReady,
      hasOlderMessages: messageQuery.hasOlder,
      isLoadingOlderMessages: messageQuery.isLoadingOlder,
      olderMessagesError: messageQuery.olderError,
      conversationTimeline,
      currentVisualPreviewProposalIds,
      resolvedForms: responseModel.forms,
      activeConversation,
      project,
      agentSessionCurrentState,
      latestTurnToolCalls,
      hasInterstitialInTimeline,
      workflowStatus,
      agentSessionId,
      taskMonitorId,
      conversationFormResolver,
      planId,
      stepId,
      navigate,

      // Submission State from Phase 4 hooks
      isSubmitting: submissionState.isSubmitting,
      versionConflictDialog: submissionState.versionConflictDialog,

      // Actions from Phase 4 hooks
      handleNext: submissionState.handleNext,
      handleRetrySuccess: submissionState.handleRetrySuccess,
      handleAnalysisAcknowledged: submissionState.handleAnalysisAcknowledged,
      handleStepClick,
      loadOlderMessages: loadOlderMessagesPreservingPosition,

      // UI Props
      animationType,
      isGeneratingResponse,

      // Suggestion decisions
      suggestionDecisions,

      // Read-only mode
      isReadOnly: readOnly,
      composerResetMode,
      isCliInputDisabled,
      selectedMachineId:
        cliResult.type === "ready" ? cliResult.machine.machineId : null,
      hideAnalysisAction,
      proposalDiffDefaultViewMode,
      onProposalsAccepted,
      proposalInteraction,
      onGoalPmAction,
      triageApplication,
      triageItemHref,
      goalPmConversationLink,
      onFocusComposer,
    };
  }, [
    messages,
    responseModel,
    messageQuery.error,
    messageQuery.isFetched,
    messageQuery.hasOlder,
    messageQuery.isLoadingOlder,
    messageQuery.olderError,
    messageQuery.loadOlder,
    conversationTimeline,
    currentVisualPreviewProposalIds,
    activeConversation,
    project,
    agentSessionCurrentState,
    latestTurnToolCalls,
    hasInterstitialInTimeline,
    workflowStatus,
    agentSessionId,
    taskMonitorId,
    conversationFormResolver,
    planId,
    stepId,
    navigate,
    submissionState.isSubmitting,
    submissionState.versionConflictDialog,
    submissionState.handleNext,
    submissionState.handleRetrySuccess,
    submissionState.handleAnalysisAcknowledged,
    handleStepClick,
    loadOlderMessagesPreservingPosition,
    initialScrollReady,
    animationType,
    suggestionDecisions,
    readOnly,
    composerResetMode,
    isCliInputDisabled,
    cliResult,
    hideAnalysisAction,
    proposalDiffDefaultViewMode,
    onProposalsAccepted,
    proposalInteraction,
    onGoalPmAction,
    triageApplication,
    triageItemHref,
    goalPmConversationLink,
    onFocusComposer,
  ]);

  // Don't render if no active conversation (could be loading state)
  if (!activeConversation) {
    return null;
  }

  return (
    <ConversationScrollPolicyContext.Provider value={scrollPolicy}>
      <ConversationContext.Provider value={contextValue}>
        {children}
      </ConversationContext.Provider>
    </ConversationScrollPolicyContext.Provider>
  );
};

/**
 * Hook to consume conversation context.
 * Provides type-safe access to all conversation state and actions.
 *
 * @throws Error if used outside ConversationProvider
 * @returns Conversation context value
 */
export const useConversationContext = (): ConversationContextValue => {
  const context = useContext(ConversationContext);
  if (!context) {
    throw new Error(
      "useConversationContext must be used within a ConversationProvider",
    );
  }
  return context;
};
