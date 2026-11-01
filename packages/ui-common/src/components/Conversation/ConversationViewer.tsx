import { useModalState } from "../Modals/useModalState";
import { ModalWorkOwner } from "../Modals/ModalWorkOwner";
import type { TriageApplicationCoordinator } from "../../data/triage/application";
import type { OpenItemsTriageItem } from "../../api";
import { SubmissionPreviews } from "./SubmissionPreviews";
import { DataStateBoundary } from "../shared/DataStateBoundary";
import ReplayOutlinedIcon from "@mui/icons-material/ReplayOutlined";
import type { PaperProps } from "@mui/material";
import {
  Alert,
  Box,
  CircularProgress,
  IconButton,
  Paper,
  Tab,
  Tabs,
  Tooltip,
} from "@mui/material";
import type { SxProps, Theme } from "@mui/material/styles";
import SvgIcon from "@mui/material/SvgIcon";

import React from "react";
import { useTranslation } from "react-i18next";
import { AgentSessionCurrentState, MessageType } from "../../api";
import type {
  ConversationResponseDto,
  CreateUserMessage,
  GoalPmRoutingSelectionPayload,
  GoalPmRoutingCreation,
  GoalPmRoutingEnactmentResponse,
  ProjectResponseDto,
  SystemMessageData,
} from "../../api";
import type { GoalPmConversationLink } from "../LlmForms/Registry/types";
import { useWorkflowConversations } from "../../data/hooks/useWorkflowConversations";
import { useActionGuard, useUserIdentity } from "../../hooks";
import { useMessageRetry } from "../../hooks/useMessageRetry";
import { useWorkflowStatus } from "../../hooks/useWorkflowStatus";
import type {
  ConversationMessage,
  ConversationPreviewInput,
  VersionConflictDialogState,
} from "../../types/conversation";
import log from "../../utils/logger";
import type { DiffViewMode } from "../SuggestedContent";
import {
  ConversationProvider,
  useConversationContext,
} from "./Components/ConversationContext";
import type {
  ConversationFormResolver,
  ResponseTargetChangeHandler,
} from "./Components/conversationFormTypes";
import { ConversationHistoryList } from "./Components/ConversationHistoryList";
import { ConversationStatusIndicator } from "./Components/ConversationStatusIndicator";
import { SentAttachmentOpenProvider } from "./Components/SentAttachmentOpenContext";
import {
  ConversationTimeline,
  type ConversationTimelineAnimationMode,
} from "./Components/ConversationTimeline";
import { SystemMessage } from "./Components/SystemMessage";
import { ConversationDebugPanel } from "./ConversationDebugPanel";
import type { ConversationNavigatorOrientation } from "./ConversationNavigator";
import { ConversationNavigator } from "./ConversationNavigator";
import { ConversationToolbar, type ToolbarButton } from "./ConversationToolbar";
import type { ProposalsAcceptedHandler } from "./hooks/proposalsAcceptedTypes";
import {
  DISABLED_CONVERSATION_SCROLL_POLICY,
  type ConversationScrollPolicy,
} from "./hooks/useConversationScrolling";
import { useSuggestionDecisions } from "./hooks/useSuggestionDecisions";
import { NewConversationConfirmationDialog } from "./NewConversationConfirmationDialog";
import {
  LatestTurnToolCalls,
  TOOL_CALLS_BEFORE_NARRATION_LIMIT,
} from "../LlmForms/Registry/LatestTurnToolCalls";
import {
  isInterstitialMessageData,
  splitInterstitialThoughts,
} from "../LlmForms/Registry/InterstitialField";
import { AgentSessionCurrentStateIndicator } from "../AgentSession/AgentSessionCurrentStateIndicator";
import type {
  OnboardingReplySubmission,
  RepositoryImportReplySubmission,
} from "./hooks/useConversationSubmission";
export type {
  OnboardingReplySubmission,
  RepositoryImportReplySubmission,
} from "./hooks/useConversationSubmission";
import { getConversationSystemThread } from "./utils";
export type { ConversationFormResolver } from "./Components/conversationFormTypes";
export type { ProposalsAcceptedHandler } from "./hooks/proposalsAcceptedTypes";
export {
  DISABLED_CONVERSATION_SCROLL_POLICY,
  type ConversationScrollPolicy,
} from "./hooks/useConversationScrolling";

/**
 * Slots for customizing internal components of ConversationViewer
 */
interface ConversationViewerSlots {
  /** Custom Paper component */
  paper?: React.ElementType;
}

/**
 * Props for customizing slot components
 */
export interface ConversationViewerSlotProps {
  /** Props passed to the Paper component */
  paper?: Partial<PaperProps> & { sx?: SxProps<Theme> };
}

export interface PersistedConversationViewerProps {
  triageApplication?: TriageApplicationCoordinator;
  triageItemHref?: (item: OpenItemsTriageItem) => string;
  onGoalPmAction?: (
    selection: GoalPmRoutingSelectionPayload,
    sourceConversationId: string,
    creation?: GoalPmRoutingCreation,
  ) => Promise<GoalPmRoutingEnactmentResponse>;
  goalPmConversationLink?: GoalPmConversationLink;
  /**
   * Controls whether composer field values are preserved or cleared after successful submission.
   */
  composerResetMode?: "preserve" | "clearOnSuccess";
  /**
   * the type of loading animation to show. fun gives bubbles and games
   */
  animationType: "fun" | "minimal";
  /**
   * Active conversation containing messages
   */
  conversation: ConversationResponseDto;

  /**
   * Project information for message handling
   */
  project: ProjectResponseDto;

  /**
   * Navigation orientation
   */
  navigationOrientation?: ConversationNavigatorOrientation;

  /**
   * Optional title for the conversation
   */
  title?: string;

  /**
   * Optional subtitle
   */
  subtitle?: string;

  /**
   * Optionally set the step count or use -1 to indicate indeterminate
   */
  stepCount?: number;

  /**
   * Callback when conversation is updated (for websocket integration)
   */
  onConversationUpdated?: () => Promise<void>;

  /**
   * Whether to show navigation
   */
  showNavigation?: boolean;

  /**
   * Whether conversation has new data (for animations)
   */
  hasNewData?: boolean;

  /**
   * Custom className
   */
  className?: string;

  /** Declares the sole element this viewer may move, or disables automatic scrolling. */
  scrollPolicy: ConversationScrollPolicy;

  /**
   * Whether the conversation is still waiting for initial messages (shows loading state)
   */
  isWaitingForMessages?: boolean;

  /**
   * Feature-owned submission boundary. When supplied, user messages are
   * already admitted by the owner and must not be authorized again here.
   */
  onDirectTrigger?: (message: CreateUserMessage) => Promise<void>;

  /** Persists a non-executable USER message without creating an operation. */
  onPersistMessage?: (message: CreateUserMessage) => Promise<void>;

  /** Admits a reply to the canonical onboarding workflow. */
  onSubmitOnboardingReply?: (
    submission: OnboardingReplySubmission,
  ) => Promise<void>;
  onSubmitRepositoryImportReply?: (
    submission: RepositoryImportReplySubmission,
  ) => Promise<void>;

  /**
   * Optional toolbar buttons to display at the bottom of the conversation
   */
  toolbarButtons?: ToolbarButton[];

  /**
   * Slots for customizing internal components
   */
  slots?: ConversationViewerSlots;

  /**
   * Props for slot components
   */
  slotProps?: ConversationViewerSlotProps;

  /**
   * Enable conversation history tab (requires workflow context)
   */
  enableHistory?: boolean;

  /**
   * Callback when user selects a historical conversation
   */
  onHistoryConversationSelected?: (
    conversation: ConversationResponseDto,
  ) => void;

  /**
   * When true, hide input forms and prevent submissions.
   */
  readOnly?: boolean;

  /**
   * Timeline rendering mode for the conversation content.
   */
  sidebarMode?: "full" | "minimal";

  /**
   * When true, combine repeated sections and link to the latest entry.
   */
  combineSameSections?: boolean;

  /**
   * Controls whether all timeline messages animate, or only newly added messages.
   */
  timelineAnimationMode?: ConversationTimelineAnimationMode;

  /**
   * When true, render nested user messages within the conversation timeline.
   */
  renderNestedUserMessages?: boolean;

  /**
   * When true, render a timestamp for each timeline message.
   */
  renderTimestamp?: boolean;

  /**
   * When true, hide the "Next" button on analysis messages.
   */
  hideAnalysisAction?: boolean;

  /**
   * Active coding session context for agent-session-scoped forms.
   */
  agentSessionId?: string;
  /** Current Run-owned phase used to close a trailing interstitial. */
  agentSessionCurrentState?: AgentSessionCurrentState;
  /** Render the shared Agent Session current-state indicator in this viewer. */
  showAgentSessionCurrentStateIndicator?: boolean;
  /** Explicit Task Monitor command target for monitor-owned conversation forms. */
  taskMonitorId?: string;
  /** Owner-supplied resolver for conversation-specific structured forms. */
  conversationFormResolver?: ConversationFormResolver;
  onResponseTargetChange?: ResponseTargetChangeHandler;
  /**
   * Plan ID when this conversation is for a plan step task.
   */
  planId?: string;
  /**
   * Plan step ID when this conversation is for a plan step task.
   */
  stepId?: string;
  /**
   * Callback to create a new conversation. When provided, a "New conversation"
   * button is shown in the toolbar. Omit to hide the button.
   */
  onCreateNewConversation?: (draftText: string) => Promise<void>;
  /** Whether starting a new conversation requires an explicit confirmation. */
  confirmBeforeNewConversation?: boolean;
  /**
   * When true, hide the retry last message button in the toolbar.
   */
  hideRetryButton?: boolean;
  /**
   * Callback fired when any proposal surfaced by a SystemMessage in this
   * conversation transitions to approved or rejected. Invoked once per
   * message whose proposals transitioned since the last observation, with
   * the triggering message and aggregate counts.
   */
  onProposalsAccepted?: ProposalsAcceptedHandler;
  /** Focuses the shared composer when a read-only review action requests clarification. */
  onFocusComposer?: () => void;
  /**
   * Default view mode for diffs rendered inside UPDATE proposals in this
   * conversation. Narrow panel contexts (e.g. refiner chat) should pass
   * "inline" so diffs open inline by default. When unset, proposals fall
   * back to "split" to preserve the existing default.
   */
  proposalDiffDefaultViewMode?: DiffViewMode;
}

const NewConversationIcon: React.FC<React.ComponentProps<typeof SvgIcon>> = (
  props,
) => (
  <SvgIcon {...props} viewBox="0 0 24 24">
    <path d="M2.5 3h19v14h-15l-4 3.5z" fill="none" />
    <path
      stroke="currentColor"
      strokeLinecap="square"
      strokeWidth="2"
      fill="none"
      d="M2.5 3h19v14h-15l-4 3.5zm12.329 4.172L12 10m0 0l-2.828 2.828M12 10l2.829 2.828M12 10L9.172 7.172"
    />
  </SvgIcon>
);

const SHOW_DEBUG_PANEL = false;

/**
 * Internal component that uses the ConversationContext to render the conversation.
 * This is separated from the main component to ensure context is available.
 */
const ConversationViewerContent: React.FC<{
  navigationOrientation: ConversationNavigatorOrientation;
  showNavigation: boolean;
  stepCount?: number;
  className?: string;
  isWaitingForMessages: boolean;
  title?: string;
  subtitle?: string;
  toolbarButtons?: ToolbarButton[];
  slots?: ConversationViewerSlots;
  slotProps?: ConversationViewerSlotProps;
  enableHistory?: boolean;
  allConversations?: ConversationResponseDto[];
  isHistoryLoading?: boolean;
  onHistoryConversationSelected?: (
    conversation: ConversationResponseDto,
  ) => void;
  sidebarMode?: "full" | "minimal";
  combineSameSections?: boolean;
  timelineAnimationMode?: ConversationTimelineAnimationMode;
  renderTimestamp?: boolean;
  onCreateNewConversation?: (draftText: string) => Promise<void>;
  confirmBeforeNewConversation?: boolean;
  hideRetryButton?: boolean;
  showAgentSessionCurrentStateIndicator?: boolean;
}> = ({
  navigationOrientation,
  showNavigation,
  stepCount,
  className,
  isWaitingForMessages,
  title,
  subtitle,
  toolbarButtons,
  slots: _slots,
  slotProps,
  enableHistory = false,
  allConversations = [],
  isHistoryLoading = false,
  onHistoryConversationSelected,
  sidebarMode = "full",
  combineSameSections = false,
  timelineAnimationMode = "all",
  renderTimestamp = false,
  onCreateNewConversation,
  confirmBeforeNewConversation = false,
  hideRetryButton = false,
  showAgentSessionCurrentStateIndicator = false,
}) => {
  const { t } = useTranslation();
  const { guard } = useActionGuard();
  const {
    activeConversation,
    messages,
    messagesError,
    messagesReady,
    conversationTimeline,
    animationType,
    isSubmitting,
    versionConflictDialog,
    handleStepClick,
    project,
    handleRetrySuccess,
    isReadOnly,
    agentSessionId,
    agentSessionCurrentState,
    latestTurnToolCalls,
  } = useConversationContext();

  const isTurnActive =
    agentSessionCurrentState === AgentSessionCurrentState.Starting ||
    agentSessionCurrentState === AgentSessionCurrentState.GatheringContext ||
    agentSessionCurrentState === AgentSessionCurrentState.Thinking ||
    agentSessionCurrentState === AgentSessionCurrentState.Writing;

  const liveToolCalls =
    latestTurnToolCalls.status === "available"
      ? {
          toolCalls: latestTurnToolCalls.result.toolCalls,
          hiddenCount:
            latestTurnToolCalls.result.omittedEarlierCount +
            latestTurnToolCalls.result.evictedCount,
        }
      : null;

  const latestTimelineMessage = conversationTimeline.at(-1)?.message;
  const latestMessageData =
    latestTimelineMessage?.type === MessageType.System
      ? (latestTimelineMessage.data as SystemMessageData | undefined)
      : undefined;
  const latestMessageHostsToolCalls =
    latestMessageData !== undefined &&
    isInterstitialMessageData(latestMessageData) &&
    typeof latestMessageData.response === "string" &&
    splitInterstitialThoughts(latestMessageData.response).length > 0;

  // Ref to track the last message for scrolling
  const lastMessageRef = React.useRef<HTMLDivElement>(null);

  const { userId: currentUserId } = useUserIdentity() ?? {};

  // History tab state
  type TabValue = "active" | "history";
  const [activeTab, setActiveTab] = React.useState<TabValue>("active");

  // Filter out current conversation from history
  const historyConversations = React.useMemo(() => {
    return allConversations.filter((conv) => conv.id !== activeConversation.id);
  }, [allConversations, activeConversation.id]);

  const showHistoryTab = enableHistory && historyConversations.length > 0;

  const handleTabChange = (
    _event: React.SyntheticEvent,
    newValue: TabValue,
  ) => {
    setActiveTab(newValue);
  };

  const handleHistorySelect = (conversation: ConversationResponseDto) => {
    onHistoryConversationSelected?.(conversation);
  };

  // Get last message for retry functionality
  const lastMessage = React.useMemo(() => {
    if (conversationTimeline.length > 0) {
      return conversationTimeline[conversationTimeline.length - 1].message;
    }
    return null;
  }, [conversationTimeline]);

  // Retry hook for development button
  const retryState = useMessageRetry({
    organizationId: project?.organizationId || "",
    projectId: project?.id || "",
    messageId: lastMessage?.id || "",
    onRetrySuccess: handleRetrySuccess,
    onRetryError: (error) => {
      console.error("[DEV] Retry error:", error);
    },
  });

  // New conversation state
  const [isCreatingConversation, setIsCreatingConversation] =
    React.useState(false);
  const [
    isNewConversationDialogOpen,
    setIsNewConversationDialogOpen,
    isNewConversationDialogOpenOwnerKey,
  ] = useModalState(false);

  const onCreateNewConversationRef = React.useRef(onCreateNewConversation);
  onCreateNewConversationRef.current = onCreateNewConversation;

  const handleNewConversation = React.useCallback(async () => {
    setIsNewConversationDialogOpen(false);
    setIsCreatingConversation(true);
    try {
      await onCreateNewConversationRef.current?.("");
    } finally {
      setIsCreatingConversation(false);
    }
  }, []);

  const handleNewConversationRequest = React.useCallback(() => {
    if (!confirmBeforeNewConversation) {
      void handleNewConversation();
      return;
    }

    setIsNewConversationDialogOpen(true);
  }, [confirmBeforeNewConversation, handleNewConversation]);

  // Component mount and props logging
  useLogging(
    activeConversation,
    navigationOrientation,
    showNavigation,
    stepCount,
    isWaitingForMessages,
    title,
    subtitle,
    animationType,
    currentUserId,
    isSubmitting,
    versionConflictDialog,
    conversationTimeline,
  );

  // Calculate active step from nested conversation structure
  const activeStep = React.useMemo(() => {
    if (messages && messages.length > 0) {
      return getConversationSystemThread(messages).activeStep;
    }
    return 0;
  }, [messages]);

  // Use workflow status hook for debug panel (separate from context)
  const debugWorkflowStatus = useWorkflowStatus({
    conversation: activeConversation,
    messages,
    currentUserId: currentUserId || "",
    isLoading: false,
  });

  const isHorizontal = navigationOrientation === "horizontal";
  const showContent = true;
  const hasToolbar = toolbarButtons && toolbarButtons.length > 0;
  const sidebarWidth = sidebarMode === "minimal" ? 280 : undefined;

  return (
    <>
      <Box
        sx={{
          width: "100%",
          minWidth: 0,
          maxWidth: "100%",
          overflowX: "hidden",
          display: "flex",
          flexDirection: {
            xs: "column", // Always vertical on mobile
            sm: isHorizontal ? "column" : "row",
            md: isHorizontal ? "column" : "row",
          },
          alignItems: "flex-start",
          gap: { xs: 2, sm: 3 },
        }}
        data-testid="conversation-viewer-cont"
        className={className}
      >
        {/* Navigation */}
        {showNavigation && (
          <Box
            sx={{
              position: isHorizontal ? undefined : "sticky",
              top: isHorizontal ? undefined : "0",
              left: isHorizontal ? undefined : "0",
              flex: {
                xs: "0 0 auto", // Auto height on mobile
                sm: isHorizontal
                  ? "0 0 auto"
                  : sidebarMode === "minimal"
                    ? "0 0 280px"
                    : "0 0 240px",
                md: isHorizontal
                  ? "0 0 auto"
                  : sidebarMode === "minimal"
                    ? "0 0 280px"
                    : "0 0 280px",
                lg: isHorizontal
                  ? "0 0 auto"
                  : sidebarMode === "minimal"
                    ? "0 0 280px"
                    : "0 0 320px",
                xl: isHorizontal
                  ? "0 0 auto"
                  : sidebarMode === "minimal"
                    ? "0 0 280px"
                    : "0 0 480px",
              },
              width: {
                xs: "100%", // Full width on mobile
                sm: isHorizontal
                  ? "100%"
                  : sidebarMode === "minimal"
                    ? "280px"
                    : "auto",
              },
              maxWidth: {
                xs: "100%",
                sm: isHorizontal
                  ? "100%"
                  : sidebarMode === "minimal"
                    ? "280px"
                    : "320px",
                xl: isHorizontal
                  ? "100%"
                  : sidebarMode === "minimal"
                    ? "280px"
                    : "480px",
              },
              minWidth: {
                xs: "100%",
                sm: isHorizontal
                  ? "100%"
                  : sidebarMode === "minimal"
                    ? "280px"
                    : "200px",
                xl: isHorizontal
                  ? "100%"
                  : sidebarMode === "minimal"
                    ? "280px"
                    : "320px",
              },
            }}
          >
            <ConversationNavigator
              messages={messages}
              orientation={navigationOrientation}
              activeStep={activeStep}
              onStepClick={handleStepClick}
              stepCount={stepCount}
              showProgress={true}
              sidebarMode={sidebarMode}
              combineSameSections={combineSameSections}
            />
            {SHOW_DEBUG_PANEL && (
              <ConversationDebugPanel
                workflowStatus={debugWorkflowStatus}
                isSubmitting={isSubmitting}
                conversationTimeline={conversationTimeline}
                sidebarWidth={sidebarWidth}
              />
            )}
          </Box>
        )}

        {/* Conversation Content */}
        <Paper
          elevation={slotProps?.paper?.elevation ?? 2}
          data-conversation-content
          {...slotProps?.paper}
          sx={{
            p: { xs: 2, sm: 3, md: 4 },
            flex: 1,
            minWidth: 0, // Prevent flex item from overflowing
            maxWidth: "100%",
            overflow: "auto", // Allow scrolling within conversation
            maxHeight: "100%", // Ensure it respects container height
            display: "flex",
            flexDirection: "column",
            position: "relative",
            ...slotProps?.paper?.sx,
          }}
        >
          {/* History Tab Navigation */}
          {showHistoryTab && (
            <Box sx={{ borderBottom: 1, borderColor: "divider", mb: 2 }}>
              <Tabs value={activeTab} onChange={handleTabChange}>
                <Tab label={t("conversation.tabs.active")} value="active" />
                <Tab
                  label={`${t("conversation.tabs.history")} (${
                    historyConversations.length
                  })`}
                  value="history"
                />
              </Tabs>
            </Box>
          )}

          {activeTab === "active" ? (
            messagesError ? (
              <Alert severity="error" data-testid="conversation-messages-error">
                {messagesError.message}
              </Alert>
            ) : !messagesReady || isWaitingForMessages ? (
              <DataStateBoundary loading fetched={false}>
                {null}
              </DataStateBoundary>
            ) : showContent ? (
              <ConversationTimeline
                data-testid="conversation-timeline"
                messageAnimationMode={timelineAnimationMode}
                renderTimestamp={renderTimestamp}
                lastMessageRef={lastMessageRef}
              />
            ) : null
          ) : (
            <ConversationHistoryList
              conversations={historyConversations}
              activeConversationId={activeConversation.id}
              onConversationSelect={handleHistorySelect}
              isLoading={isHistoryLoading}
              projectId={project?.id}
            />
          )}

          {activeTab === "active" && agentSessionId && project && (
            <SubmissionPreviews
              organizationId={project.organizationId}
              projectId={project.id}
              conversationId={activeConversation.id}
              agentSessionId={agentSessionId}
            />
          )}

          {agentSessionId &&
          !latestMessageHostsToolCalls &&
          isTurnActive &&
          liveToolCalls ? (
            <LatestTurnToolCalls
              toolCalls={liveToolCalls.toolCalls}
              visibleLimit={TOOL_CALLS_BEFORE_NARRATION_LIMIT}
              newestEntryId={liveToolCalls.toolCalls.at(-1)?.entryId ?? null}
              hiddenCount={liveToolCalls.hiddenCount}
            />
          ) : null}

          {showAgentSessionCurrentStateIndicator &&
          agentSessionId &&
          agentSessionCurrentState ? (
            <AgentSessionCurrentStateIndicator
              currentState={agentSessionCurrentState}
              presentation="animated"
              sx={{ marginTop: "20px", marginBottom: "40px" }}
            />
          ) : null}

          {/* Workflow status indicator */}
          <ConversationStatusIndicator data-testid="conversation-status" />

          {/* Toolbar buttons at bottom */}
          {(hasToolbar || !isReadOnly) && (
            <Box
              sx={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                p: 2,
                paddingBottom: 0,
                zIndex: 10,
              }}
            >
              {/* Left side: configured toolbar buttons */}
              {hasToolbar && <ConversationToolbar buttons={toolbarButtons} />}

              {/* Right side: retry, new conversation */}
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  ml: "auto",
                }}
              >
                {!isReadOnly && (
                  <>
                    {!hideRetryButton && (
                      <Tooltip
                        title={t(
                          "conversation.retry.tooltip",
                          "Retry last message",
                        )}
                      >
                        <span>
                          <IconButton
                            aria-label={t(
                              "conversation.retry.tooltip",
                              "Retry last message",
                            )}
                            onClick={guard("retry", () => {
                              if (lastMessage) {
                                retryState.retry();
                              }
                            })}
                            disabled={!lastMessage || retryState.isRetrying}
                            size="small"
                            color="primary"
                          >
                            {retryState.isRetrying ? (
                              <CircularProgress size={18} />
                            ) : (
                              <ReplayOutlinedIcon />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                    {onCreateNewConversation && (
                      <Tooltip
                        title={t(
                          "conversation.newConversation.tooltip",
                          "New conversation",
                        )}
                      >
                        <span>
                          <IconButton
                            aria-label={t(
                              "conversation.newConversation.tooltip",
                              "New conversation",
                            )}
                            onClick={guard(
                              "new-conv-open",
                              handleNewConversationRequest,
                            )}
                            disabled={isCreatingConversation}
                            size="small"
                            color="primary"
                          >
                            {isCreatingConversation ? (
                              <CircularProgress size={18} />
                            ) : (
                              <NewConversationIcon />
                            )}
                          </IconButton>
                        </span>
                      </Tooltip>
                    )}
                  </>
                )}
              </Box>
            </Box>
          )}

          <ModalWorkOwner.Provider value={isNewConversationDialogOpenOwnerKey}>
            <NewConversationConfirmationDialog
              open={isNewConversationDialogOpen}
              onClose={() => setIsNewConversationDialogOpen(false)}
              onConfirm={guard("new-conv-confirm", handleNewConversation)}
              isConfirming={isCreatingConversation}
            />
          </ModalWorkOwner.Provider>
        </Paper>
      </Box>
    </>
  );
};

/**
 * Phase 5 Refactored ConversationViewer component.
 * Uses ConversationProvider context architecture to eliminate prop drilling.
 * Persisted Message state is owned by the shared provider.
 *
 * @param props - Component props matching the original ConversationViewer interface
 * @returns JSX element displaying the conversation with context-driven architecture
 */
const PersistedConversationViewer: React.FC<
  PersistedConversationViewerProps
> = ({
  animationType = "minimal",
  conversation,
  project,
  navigationOrientation = "horizontal",
  title,
  subtitle,
  stepCount,
  onConversationUpdated,
  showNavigation = true,
  hasNewData: _hasNewData = false,
  className,
  scrollPolicy = DISABLED_CONVERSATION_SCROLL_POLICY,
  isWaitingForMessages = false,
  onDirectTrigger,
  onPersistMessage,
  onSubmitOnboardingReply,
  onSubmitRepositoryImportReply,
  toolbarButtons,
  slots,
  slotProps,
  enableHistory = false,
  onHistoryConversationSelected,
  readOnly = false,
  composerResetMode = "preserve",
  sidebarMode = "full",
  combineSameSections = false,
  timelineAnimationMode = "all",
  renderNestedUserMessages = false,
  renderTimestamp = false,
  hideAnalysisAction = false,
  agentSessionId,
  agentSessionCurrentState,
  showAgentSessionCurrentStateIndicator = false,
  taskMonitorId,
  conversationFormResolver,
  onResponseTargetChange,
  planId,
  stepId,
  onCreateNewConversation,
  confirmBeforeNewConversation = false,
  hideRetryButton = false,
  onProposalsAccepted,
  onGoalPmAction,
  triageApplication,
  triageItemHref,
  goalPmConversationLink,
  onFocusComposer,
  proposalDiffDefaultViewMode,
}) => {
  const suggestionDecisions = useSuggestionDecisions(conversation);

  // Fetch workflow conversations for history tab (if enabled)
  const shouldFetchHistory =
    enableHistory &&
    !!conversation.workflowName &&
    !!conversation.workflowAboutId;

  const { data: allConversationsData, isLoading: isHistoryLoading } =
    useWorkflowConversations(
      conversation.organizationId,
      conversation.projectId,
      conversation.workflowName,
      conversation.workflowAboutId || undefined,
      {
        enabled: shouldFetchHistory,
        sortBy: "createdAt",
        sortOrder: "desc",
      },
    );

  // Ensure we always have an array (never null or undefined)
  const allConversations = allConversationsData || [];
  // Component mount logging
  React.useEffect(() => {
    log.info("conversation_viewer", "ConversationViewer mounted", {
      conversationId: conversation.id,
      projectId: project.id,
      animationType,
      navigationOrientation,
      title,
      subtitle,
      stepCount,
      showNavigation,
      scrollPolicy,
      isWaitingForMessages,
      renderNestedUserMessages,
      renderTimestamp,
    });

    return () => {
      log.info("conversation_viewer", "ConversationViewer unmounting", {
        conversationId: conversation.id,
      });
    };
  }, [
    conversation.id,
    project.id,
    animationType,
    navigationOrientation,
    title,
    subtitle,
    stepCount,
    showNavigation,
    scrollPolicy,
    isWaitingForMessages,
    renderNestedUserMessages,
    renderTimestamp,
  ]);

  return (
    <ConversationProvider
      key={conversation.id}
      conversation={conversation}
      project={project}
      agentSessionId={agentSessionId}
      agentSessionCurrentState={agentSessionCurrentState}
      taskMonitorId={taskMonitorId}
      conversationFormResolver={conversationFormResolver}
      onResponseTargetChange={onResponseTargetChange}
      planId={planId}
      stepId={stepId}
      animationType={animationType}
      scrollPolicy={scrollPolicy}
      onDirectTrigger={onDirectTrigger}
      onPersistMessage={onPersistMessage}
      onSubmitOnboardingReply={onSubmitOnboardingReply}
      onSubmitRepositoryImportReply={onSubmitRepositoryImportReply}
      onConversationUpdated={onConversationUpdated}
      suggestionDecisions={suggestionDecisions}
      readOnly={readOnly}
      composerResetMode={composerResetMode}
      renderNestedUserMessages={renderNestedUserMessages}
      hideAnalysisAction={hideAnalysisAction}
      proposalDiffDefaultViewMode={proposalDiffDefaultViewMode}
      onProposalsAccepted={onProposalsAccepted}
      triageApplication={triageApplication}
      triageItemHref={triageItemHref}
      onGoalPmAction={onGoalPmAction}
      goalPmConversationLink={goalPmConversationLink}
      onFocusComposer={onFocusComposer}
    >
      <SentAttachmentOpenProvider
        organizationId={project.organizationId}
        projectId={project.id}
        agentSessionId={agentSessionId}
        conversationId={conversation.id}
      >
        <ConversationViewerContent
          navigationOrientation={navigationOrientation}
          showNavigation={showNavigation}
          stepCount={stepCount}
          className={className}
          isWaitingForMessages={isWaitingForMessages}
          title={title}
          subtitle={subtitle}
          toolbarButtons={toolbarButtons}
          slots={slots}
          slotProps={slotProps}
          enableHistory={enableHistory}
          allConversations={allConversations}
          isHistoryLoading={isHistoryLoading}
          onHistoryConversationSelected={onHistoryConversationSelected}
          sidebarMode={sidebarMode}
          combineSameSections={combineSameSections}
          timelineAnimationMode={timelineAnimationMode}
          renderTimestamp={renderTimestamp}
          onCreateNewConversation={onCreateNewConversation}
          confirmBeforeNewConversation={confirmBeforeNewConversation}
          hideRetryButton={hideRetryButton}
          showAgentSessionCurrentStateIndicator={
            showAgentSessionCurrentStateIndicator
          }
        />
      </SentAttachmentOpenProvider>
    </ConversationProvider>
  );
};

function useLogging(
  activeConversation: ConversationResponseDto,
  navigationOrientation: string,
  showNavigation: boolean,
  stepCount: number | undefined,
  isWaitingForMessages: boolean,
  title: string | undefined,
  subtitle: string | undefined,
  animationType: string,
  currentUserId: string | undefined,
  isSubmitting: boolean,
  versionConflictDialog: VersionConflictDialogState | null,
  conversationTimeline: ConversationMessage[],
) {
  React.useEffect(() => {
    log.info("conversation_viewer", "ConversationViewerContent mounted", {
      conversationId: activeConversation?.id,
      navigationOrientation,
      showNavigation,
      stepCount,
      isWaitingForMessages,
      title,
      subtitle,
      animationType,
      currentUserId,
    });

    return () => {
      log.info("conversation_viewer", "ConversationViewerContent unmounting", {
        conversationId: activeConversation?.id,
      });
    };
  }, [
    activeConversation?.id,
    navigationOrientation,
    showNavigation,
    stepCount,
    isWaitingForMessages,
    title,
    subtitle,
    animationType,
    currentUserId,
  ]);

  // Conversation state logging
  React.useEffect(() => {
    log.info("conversation_viewer", "Conversation state changed", {
      conversationId: activeConversation?.id,
      status: activeConversation?.status,
      workflowName: activeConversation?.workflowName,
      workflowAboutId: activeConversation?.workflowAboutId,
      isSubmitting,
      hasVersionConflict: !!versionConflictDialog?.isOpen,
      timelineItemCount: conversationTimeline?.length || 0,
    });
  }, [
    activeConversation?.id,
    activeConversation?.status,
    activeConversation?.workflowName,
    activeConversation?.workflowAboutId,
    isSubmitting,
    versionConflictDialog?.isOpen,
    conversationTimeline?.length,
  ]);
}

export type ConversationViewerProps =
  | (PersistedConversationViewerProps & { preview?: never })
  | { preview: ConversationPreviewInput; conversation?: never };

export const ConversationViewer = (props: ConversationViewerProps) => {
  if (props.preview) {
    return (
      <SystemMessage
        animationType="minimal"
        enableTypingAnimation={false}
        text={props.preview.text}
        isThinking={props.preview.isThinking}
        thinkingMessage={props.preview.text}
        type={props.preview.isThinking ? "loader" : "text"}
      />
    );
  }
  return <PersistedConversationViewer {...props} />;
};
