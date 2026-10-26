import { useAgentSession } from "../../data/hooks/useAgentSession";
import { resolveRunAttachmentTarget } from "./runtime/hooks/runAttachmentDrop";
import type { RunAttachmentReference } from "../../api";
import type { TriageApplicationCoordinator } from "../../data/triage/application";
import type { OpenItemsTriageItem } from "../../api";
import { useAgentLaunchHandoff } from "./operations/useAgentLaunchHandoff";
import {
  resolveReplyComposerState,
  type ReplyComposerPolicy,
} from "./replyComposerPolicy";
import { NO_RESPONSE_TARGET } from "../Conversation/utils/conversationResponseModel";
import type {
  ConversationResponseTarget,
  ResponseTargetChangeHandler,
} from "../Conversation/Components/conversationFormTypes";
import { DataStateBoundary } from "../shared/DataStateBoundary";
import { SharedLoading } from "../shared/SharedLoading";
import type { ConversationPreviewInput } from "../../types/conversation";
import { Alert, Box, Paper, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { memo, useCallback, useMemo, useRef, useState } from "react";
import {
  AgentSessionCurrentState,
  type CreateUserMessage,
  MessageType,
} from "../../api";
import { useConversation } from "../../data/hooks/useConversation";
import { useQueryClient } from "@tanstack/react-query";
import { invalidateConversationMessages } from "../../data/collections/messages";
import { useAgentSessionCurrentState } from "../../data/hooks/useAgentSessionCurrentState";
import { useProject } from "../../data/hooks/useProject";
import {
  ConversationViewer,
  type ConversationScrollPolicy,
  type ConversationFormResolver,
  type PersistedConversationViewerProps,
  type ProposalsAcceptedHandler,
} from "../Conversation/ConversationViewer";
import { ExternalReplyComposer } from "./ExternalReplyComposer";
import { AgentSessionCurrentStateIndicator } from "./AgentSessionCurrentStateIndicator";
import { AgentBridgeRecoveryNotice } from "./AgentBridgeRecoveryNotice";
import { resolveAgentBridgeRecoveryState } from "./agentBridgeRecoveryState";
import { getAgentSessionCurrentStatePresentation } from "./agentSessionCurrentStatePresentation";
import {
  AgentSessionMetadata,
  type AgentSessionMetadataValues,
} from "./AgentSessionMetadata";
import type { FileReferenceScope } from "../../data/hooks/useFileReferenceCandidates";
import { useCliRequired } from "./runtime/hooks/useCliRequired";
import { useAgentSessionInteractionAccess } from "./operations/useAgentSessionInteractionAccess";
import {
  buildFollowupAgentInput,
  buildUserMessageData,
  type ReplyMessageBuilder,
} from "./runtime/hooks/directTriggerInput";
import type { AgentSkillSelection, GoalPmRoutingCreation } from "../../api";
import type {
  AttachedAgentComposerContext,
  PreRunAgentComposerContext,
} from "../SmarterTextAreaCard/slashCommands/types";
import { useSessionSubagentComposition } from "./useSessionSubagentComposition";
import type { MessageAgentCommandIntent } from "../SmarterTextAreaCard/slashCommands/messageAgentCommand";

export interface AgentConversationViewProps {
  triageApplication?: TriageApplicationCoordinator;
  triageItemHref?: (item: OpenItemsTriageItem) => string;
  onGoalPmAction?: (
    action: Parameters<
      NonNullable<PersistedConversationViewerProps["onGoalPmAction"]>
    >[0],
    sourceConversationId: string,
    draftText?: string,
    creation?: GoalPmRoutingCreation,
  ) => ReturnType<
    NonNullable<PersistedConversationViewerProps["onGoalPmAction"]>
  >;
  goalPmConversationLink?: PersistedConversationViewerProps["goalPmConversationLink"];
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  conversationId: string;
  canonicalCurrentState?: AgentSessionCurrentState;
  /** Explicit Task Monitor command target for monitor-owned conversation forms. */
  taskMonitorId?: string;
  /** Owner-supplied resolver for conversation-specific structured forms. */
  conversationFormResolver?: ConversationFormResolver;
  planId?: string;
  stepId?: string;
  submittingPrompt?: boolean;
  /**
   * Feature-owned direct submission for surfaces whose first message must
   * materialize a Run with prepared launch context. Established sessions omit
   * this and use the coordinator-backed direct-message submission below.
   */
  onDirectTrigger?: (message: CreateUserMessage) => Promise<void>;
  /** Surface-owned builder for typed ordinary reply messages. */
  buildReplyMessage?: ReplyMessageBuilder;
  /** Coding-session-owned free-text follow-up submission. */
  onSubmitReply?: (
    text: string,
    skillSelection?: AgentSkillSelection,
    attachments?: RunAttachmentReference[],
  ) => Promise<void>;
  onSubmitMessageAgent?: (
    intent: MessageAgentCommandIntent,
    interactionId: string,
  ) => Promise<void>;
  /** Attached provider context for the Codex-only Skill picker. */
  attachedAgent?:
    | Omit<AttachedAgentComposerContext, "selectedSkill" | "onSkillSelected">
    | Omit<PreRunAgentComposerContext, "selectedSkill" | "onSkillSelected">;
  actionsSlot?: ReactNode;
  onCreateNewConversation?: (draftText: string) => Promise<void>;
  /** Draft to seed when this view switches to a newly created session. */
  initialDraft?: string;
  /** Whether starting a new conversation requires an explicit confirmation. */
  confirmBeforeNewConversation?: boolean;
  onStopRun?: () => void;
  stoppingRun?: boolean;
  forceRunProcessing?: boolean;
  /**
   * When provided, the view renders this conversation directly without
   * fetching. Used for local startup content while the real conversation is
   * being created server-side, so the handoff to the real conversation
   * doesn't cause a layout jump.
   */
  preview?: ConversationPreviewInput;
  hideComposer?: boolean;
  /**
   * Owner-selected composer visibility. Defaults to always offering the
   * composer; plan generation opts into `when-no-usable-response`.
   */
  composerPolicy?: ReplyComposerPolicy;
  readOnly?: boolean;
  /** Historical sessions without a durable machine binding cannot resume. */
  sessionResumability?: "resumable" | "legacy_non_resumable";
  /** Durable provider/model plus optional effort metadata. */
  agentSessionMetadata?: AgentSessionMetadataValues;
  /** Editable model selection applied only to a newly created conversation. */
  newConversationModelSelector?: ReactNode;
  /**
   * Constrains this conversation to the available height supplied by its
   * parent. The messages, status indicators, and composer then share one
   * scrollport instead of contributing to document-level scrolling.
   */
  scrollable?: boolean;
  /** An embedding surface's explicitly owned scrollport. */
  scrollPolicy?: ConversationScrollPolicy;
  onProposalsAccepted?: ProposalsAcceptedHandler;
  /**
   * When the conversation is backed by an active agent-session run, the
   * caller can pass its platform-owned context so the debug-only context-usage
   * capsule mounts here. Mounting it inside this view lets the capsule reuse
   * the conversation messages we already load instead of issuing a second
   * `useConversationMessages` fetch.
   */
  fileReferenceScope?: FileReferenceScope;
}

const CONVERSATION_PAPER_SX = {
  p: { xs: 0, sm: 1.5, md: 2 },
  backgroundColor: "transparent",
  backgroundImage: "none",
  "& [data-step-index]": {
    mb: 1,
    "&:last-of-type": { mb: 0 },
  },
  '& [data-testid^="system-message-"]': {
    opacity: "1 !important",
  },
  '& [data-testid^="user-message-"]': {
    mb: 1,
  },
} as const;

const AgentConversationViewInner = ({
  organizationId,
  projectId,
  agentSessionId,
  conversationId,
  canonicalCurrentState,
  taskMonitorId,
  conversationFormResolver,
  planId,
  stepId,
  submittingPrompt = false,
  onDirectTrigger,
  buildReplyMessage,
  onSubmitReply,
  onSubmitMessageAgent,
  actionsSlot,
  onCreateNewConversation,
  initialDraft,
  confirmBeforeNewConversation = false,
  onGoalPmAction,
  triageApplication,
  triageItemHref,
  goalPmConversationLink,
  onStopRun,
  stoppingRun = false,
  forceRunProcessing = false,
  preview,
  hideComposer = false,
  composerPolicy = "always",
  readOnly = false,
  sessionResumability = "resumable",
  scrollable = false,
  onProposalsAccepted,
  fileReferenceScope,
  agentSessionMetadata,
  newConversationModelSelector,
  scrollPolicy: suppliedScrollPolicy,
  attachedAgent,
}: AgentConversationViewProps) => {
  const currentDraftRef = useRef("");
  const [composerFocusSignal, setComposerFocusSignal] = useState(0);
  const focusComposer = useCallback(() => {
    setComposerFocusSignal((signal) => signal + 1);
  }, []);
  const captureDraft = useCallback((draft: string) => {
    currentDraftRef.current = draft;
  }, []);
  const stateProjection = useAgentSessionCurrentState(
    organizationId,
    projectId,
    agentSessionId,
    { canonicalCurrentState },
  );
  const platformCurrentState = stateProjection.currentState;
  const showLaunchHandoff = useAgentLaunchHandoff(
    { organizationId, projectId, agentSessionId, conversationId },
    stateProjection,
  );
  const platformCurrentStatePresentation = platformCurrentState
    ? getAgentSessionCurrentStatePresentation(platformCurrentState)
    : undefined;
  const effectiveRunProcessing = Boolean(
    platformCurrentStatePresentation?.isActive || forceRunProcessing,
  );

  const normalizedConversationId = conversationId.trim();
  const hasPreview = preview != null;
  const shouldFetch =
    !hasPreview &&
    organizationId.trim().length > 0 &&
    projectId.trim().length > 0 &&
    normalizedConversationId.length > 0;

  const conversationQuery = useConversation(
    organizationId,
    projectId,
    { conversationId: normalizedConversationId },
    {
      enabled: shouldFetch,
      includeSuggestionDecisions: true,
    },
  );

  const sessionQuery = useAgentSession(
    organizationId,
    projectId,
    agentSessionId,
  );
  const attachmentTarget = resolveRunAttachmentTarget(
    sessionQuery.error ? null : sessionQuery.agentSession,
    { organizationId, projectId, agentSessionId, conversationId },
  );
  const queryClient = useQueryClient();
  const conversationEnvelope = conversationQuery.data ?? null;
  const displayConversation = conversationEnvelope;
  const cliRequired = useCliRequired(
    organizationId,
    projectId,
    normalizedConversationId,
    { enabled: !readOnly && (shouldFetch || hasPreview) },
  );
  const recoveryState =
    sessionResumability === "legacy_non_resumable"
      ? resolveAgentBridgeRecoveryState({ type: "legacy_non_resumable" })
      : cliRequired;
  const interactionAccess = useAgentSessionInteractionAccess(
    recoveryState.type === "ready" ? recoveryState.machine.machineId : null,
  );
  const subagentComposition = useSessionSubagentComposition(
    {
      organizationId,
      projectId,
      agentSessionId,
      conversationId,
      recoveryState,
      interactionAccess,
      readOnly: readOnly || hasPreview || hideComposer,
    },
    onStopRun,
  );
  const conversationError = conversationQuery.error;
  const envelopeNotReady =
    conversationEnvelope === null &&
    (!conversationQuery.isFetched ||
      conversationQuery.isLoading ||
      conversationQuery.isFetching);
  const isLoading = !conversationError && !hasPreview && envelopeNotReady;

  const projectQuery = useProject(organizationId, projectId, {
    enabled: projectId.trim().length > 0,
    preferStale: true,
  });

  const [responseState, setResponseState] = useState<{
    conversationId: string;
    target: ConversationResponseTarget;
    messagesSettled: boolean;
  } | null>(null);
  const captureResponseTarget = useCallback<ResponseTargetChangeHandler>(
    (target, sourceConversationId, messagesSettled) => {
      setResponseState({
        conversationId: sourceConversationId,
        target,
        messagesSettled,
      });
    },
    [],
  );
  const targetCurrent = Boolean(
    displayConversation &&
    displayConversation.id === normalizedConversationId &&
    responseState?.conversationId === normalizedConversationId &&
    responseState.messagesSettled &&
    !projectQuery.isLoading &&
    !projectQuery.error &&
    projectQuery.data,
  );
  // A conversation or project that fails to load settles with no target.
  const targetSettled =
    targetCurrent || Boolean(conversationError) || Boolean(projectQuery.error);
  // Keep the composer mounted while hidden so unsent drafts survive.
  const { hidden: composerHidden, availability: replyAvailability } =
    resolveReplyComposerState({
      policy: composerPolicy,
      target:
        targetCurrent && responseState
          ? responseState.target
          : NO_RESPONSE_TARGET,
      targetSettled,
      hideComposer,
      readOnly,
      canSubmit: interactionAccess.isDeviceEnabled,
      submitting: submittingPrompt,
    });

  const replyMessageContext = displayConversation
    ? {
        organizationId,
        projectId: displayConversation.projectId,
        conversationId: displayConversation.id,
      }
    : null;

  const composerAttachedAgent =
    attachedAgent &&
    recoveryState.type === "ready" &&
    recoveryState.machine.machineId === attachedAgent.machineId
      ? attachedAgent
      : undefined;

  const scrollportRef = useRef<HTMLDivElement>(null);
  const scrollPolicy = useMemo<ConversationScrollPolicy>(
    () =>
      suppliedScrollPolicy ??
      (scrollable
        ? { mode: "owned", ownerRef: scrollportRef }
        : { mode: "disabled" }),
    [scrollable, suppliedScrollPolicy],
  );

  const handleExternalPostMessage = useCallback(
    async (message: CreateUserMessage): Promise<void> => {
      if (!displayConversation)
        throw new Error("Conversation is not ready for message submission.");
      if (!interactionAccess.isDeviceEnabled)
        throw new Error(interactionAccess.unavailable.message);
      const result = await interactionAccess.interactions.submitMessage({
        organizationId,
        projectId,
        agentSessionId,
        conversationId: displayConversation.id,
        intent: {
          projectId: message.projectId,
          type: message.type,
          ...(message.userId ? { userId: message.userId } : {}),
          ...(message.status ? { status: message.status } : {}),
          conversationId: message.conversationId,
          ...(message.parentMessageId !== undefined
            ? { parentMessageId: message.parentMessageId }
            : {}),
          ...(message.createdAt ? { createdAt: message.createdAt } : {}),
          data: message.data,
          ...(message.handler ? { handler: message.handler } : {}),
        },
      });
      if (result.state !== "succeeded" && result.state !== "accepted")
        throw new Error(
          result.state === "cancelled"
            ? "The operation was cancelled."
            : result.message,
        );
      void invalidateConversationMessages(
        queryClient,
        organizationId,
        projectId,
        displayConversation.id,
      );
    },
    [
      interactionAccess,
      agentSessionId,
      displayConversation,
      queryClient,
      organizationId,
      projectId,
    ],
  );
  const handleDirectTrigger = onDirectTrigger ?? handleExternalPostMessage;
  const handleSubmitReply = useCallback(
    async (
      text: string,
      skillSelection?: AgentSkillSelection,
      attachments: RunAttachmentReference[] = [],
    ): Promise<void> => {
      if (onSubmitReply) {
        await onSubmitReply(text, skillSelection, attachments);
        return;
      }
      if (!displayConversation) {
        throw new Error("Conversation is not ready for message submission.");
      }
      const reply = buildReplyMessage
        ? buildReplyMessage(text, skillSelection, attachments)
        : {
            projectId: displayConversation.projectId,
            conversationId: displayConversation.id,
            type: MessageType.User,
            data: buildUserMessageData({
              attachments,
              agentInput: buildFollowupAgentInput(
                "coding_freeform",
                text,
                undefined,
                skillSelection,
              ),
            }),
          };
      await handleDirectTrigger({
        ...reply,
        data: { ...reply.data, attachments },
      });
    },
    [
      buildReplyMessage,
      displayConversation,
      handleDirectTrigger,
      onSubmitReply,
    ],
  );

  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 0, sm: 1.5, md: 2 },
        backgroundColor: "transparent",
        backgroundImage: "none",
        border: "none",
        boxShadow: "none",
        width: "100%",
        minWidth: 0,
        maxWidth: "100%",
        overflowX: "hidden",
        ...(scrollable
          ? {
              display: "flex",
              flexDirection: "column",
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
            }
          : {}),
      }}
      data-testid="agent-conversation-view"
    >
      <Box
        ref={scrollportRef}
        data-testid={scrollable ? "agent-conversation-scrollport" : undefined}
        sx={{
          width: "100%",
          minWidth: 0,
          maxWidth: "100%",
          ...(scrollable
            ? {
                flex: 1,
                minHeight: 0,
                overflowY: "auto",
                overscrollBehavior: "contain",
              }
            : {}),
        }}
      >
        <Stack
          spacing={2}
          sx={{ width: "100%", minWidth: 0, maxWidth: "100%" }}
        >
          {preview ? <ConversationViewer preview={preview} /> : null}
          {!hasPreview && !shouldFetch ? (
            <Alert
              severity="error"
              data-testid="agent-conversation-scope-error"
            >
              Conversation requires valid organization, project, and
              conversation IDs.
            </Alert>
          ) : null}

          {shouldFetch && conversationError ? (
            <Alert
              severity="error"
              data-testid="agent-conversation-query-error"
            >
              {conversationError.message || "Unable to load conversation."}
            </Alert>
          ) : null}

          {shouldFetch && isLoading ? (
            <DataStateBoundary loading fetched={false}>
              {null}
            </DataStateBoundary>
          ) : null}

          {shouldFetch &&
          !isLoading &&
          !conversationError &&
          !displayConversation ? (
            <Typography variant="body2" color="text.secondary">
              No conversation messages yet.
            </Typography>
          ) : null}

          {displayConversation && projectQuery.isLoading ? (
            <DataStateBoundary loading fetched={false}>
              {null}
            </DataStateBoundary>
          ) : null}

          {displayConversation &&
          !projectQuery.isLoading &&
          (projectQuery.error || !projectQuery.data) ? (
            <Alert
              severity="error"
              data-testid="agent-conversation-project-error"
            >
              {projectQuery.error?.message ?? "Unable to load project details."}
            </Alert>
          ) : null}

          {displayConversation &&
          !projectQuery.isLoading &&
          !projectQuery.error &&
          projectQuery.data ? (
            <Box data-testid="agent-conversation-viewer">
              <ConversationViewer
                animationType="minimal"
                composerResetMode="clearOnSuccess"
                conversation={displayConversation}
                agentSessionId={agentSessionId}
                agentSessionCurrentState={platformCurrentState}
                taskMonitorId={taskMonitorId}
                conversationFormResolver={conversationFormResolver}
                onResponseTargetChange={captureResponseTarget}
                planId={planId}
                stepId={stepId}
                project={projectQuery.data}
                renderNestedUserMessages
                renderTimestamp
                showNavigation={false}
                scrollPolicy={scrollPolicy}
                readOnly={readOnly}
                hideAnalysisAction
                timelineAnimationMode="none"
                onDirectTrigger={handleDirectTrigger}
                hideRetryButton
                onProposalsAccepted={onProposalsAccepted}
                onFocusComposer={focusComposer}
                triageApplication={triageApplication}
                triageItemHref={triageItemHref}
                onGoalPmAction={
                  onGoalPmAction
                    ? (action, sourceConversationId, creation) =>
                        onGoalPmAction(
                          action,
                          sourceConversationId,
                          currentDraftRef.current,
                          creation,
                        )
                    : undefined
                }
                goalPmConversationLink={goalPmConversationLink}
                slotProps={{
                  paper: {
                    variant: "outlined" as const,
                    sx: {
                      ...CONVERSATION_PAPER_SX,
                      border: "none",
                      boxShadow: "none",
                    },
                  },
                }}
              />
            </Box>
          ) : null}

          {platformCurrentState &&
          platformCurrentStatePresentation &&
          (platformCurrentStatePresentation.isActive ||
            platformCurrentStatePresentation.isActionable) ? (
            <AgentSessionCurrentStateIndicator
              currentState={platformCurrentState}
              presentation="animated"
              sx={{ marginTop: "20px", marginBottom: "40px" }}
            />
          ) : null}

          {showLaunchHandoff && (
            <Box data-testid="agent-launch-handoff">
              <SharedLoading />
            </Box>
          )}

          {subagentComposition.cancellationError && (
            <Alert severity="error" data-testid="subagent-cancellation-error">
              {subagentComposition.cancellationError}
            </Alert>
          )}

          {hideComposer ? null : (
            <Box hidden={composerHidden}>
              <ExternalReplyComposer
                attachmentTarget={attachmentTarget}
                key={JSON.stringify([
                  organizationId,
                  projectId,
                  agentSessionId,
                  conversationId,
                ])}
                messageContext={replyMessageContext}
                submittingPrompt={submittingPrompt}
                onSubmitReply={handleSubmitReply}
                subagentCapability={subagentComposition.capability}
                onSubmitMessageAgent={onSubmitMessageAgent}
                onCreateNewConversation={onCreateNewConversation}
                initialDraft={initialDraft}
                onDraftChange={captureDraft}
                confirmBeforeNewConversation={confirmBeforeNewConversation}
                onStopRun={subagentComposition.stop}
                stoppingRun={stoppingRun || subagentComposition.cancelling}
                runProcessing={
                  effectiveRunProcessing || subagentComposition.waiting
                }
                fileReferenceScope={fileReferenceScope}
                agentSessionMetadata={
                  composerHidden ? undefined : agentSessionMetadata
                }
                newConversationModelSelector={newConversationModelSelector}
                attachedAgent={composerAttachedAgent}
                focusSignal={composerFocusSignal}
                availability={replyAvailability}
                editorReplacement={
                  recoveryState.type !== "ready" &&
                  recoveryState.type !== "loading" ? (
                    <AgentBridgeRecoveryNotice
                      state={recoveryState}
                      presentation="composer"
                      onStartNewSession={
                        onCreateNewConversation
                          ? () => {
                              void onCreateNewConversation(initialDraft ?? "");
                            }
                          : undefined
                      }
                    />
                  ) : undefined
                }
              />
            </Box>
          )}

          {actionsSlot}

          <Box sx={{ height: 100 }} />
        </Stack>
      </Box>
      {composerHidden && agentSessionMetadata ? (
        <AgentSessionMetadata
          placement="below-conversation"
          {...agentSessionMetadata}
        />
      ) : null}
    </Paper>
  );
};

export const AgentConversationView = memo(AgentConversationViewInner);
