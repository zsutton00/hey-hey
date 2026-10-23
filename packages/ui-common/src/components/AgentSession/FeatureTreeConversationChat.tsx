import type { RunAttachmentReference } from "../../api";
import { Box, Stack } from "@mui/material";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  WorkflowName,
  type AgentSessionDto,
  type AgentSkillSelection,
} from "../../api";
import { apiClient } from "../../clients/client.js";
import { useCreateAgentSessionConversation } from "../../data/hooks/useCreateAgentSessionConversation";
import { LocalPromptType } from "../../api";
import type { RunCreatePayloadFeatureTreeConversation } from "../../api";
import { log } from "../../utils/logger";
import { AgentConversationView } from "./AgentConversationView";
import { ChatSessionPendingPlaceholder } from "./ChatSessionPendingPlaceholder";
import { LoadingPanel } from "./LoadingPanel";
import { LocalRuntimeUnavailableAlert } from "./LocalRuntimeUnavailableAlert";
import { SessionErrorAlert } from "./SessionErrorAlert";
import {
  buildAgentInput,
  buildDirectTriggerInput,
} from "./runtime/hooks/directTriggerInput";
import { useAgentRunLifecycle, type RunLauncher } from "./useAgentRunLifecycle";
import { useLaunchRunOrchestration } from "./useLaunchRunOrchestration";
import { useSurfaceCatalogNotice } from "./useSurfaceCatalogNotice";
import { useSurfaceSelection } from "./useSurfaceSelection";
import { useCliRequired } from "./runtime/hooks/useCliRequired";
import { useAgentSessionInteractionAccess } from "./operations/useAgentSessionInteractionAccess";

// Stable per-surface id for the provider/model/effort triple. No picker UI on
// this surface, so the selection silently defaults from the catalog of the CLI on
// the conversation's machine.
const FEATURE_TREE_CONVERSATION_SURFACE_ID = "feature-tree-conversation";

export interface FeatureTreeConversationChatProps {
  organizationId: string;
  projectId: string;
  agentSession: AgentSessionDto;
  onCreateNewConversation?: (draftText: string) => Promise<void>;
  /** Constrains the conversation to the host-owned preview scrollport. */
  scrollable?: boolean;
}

interface FeatureTreeConversationActiveProps {
  organizationId: string;
  projectId: string;
  agentSession: AgentSessionDto;
  launch: RunLauncher;
  onCreateNewConversation?: (draftText: string) => Promise<void>;
  scrollable: boolean;
}

const FeatureTreeConversationActive: React.FC<
  FeatureTreeConversationActiveProps
> = ({
  organizationId,
  projectId,
  agentSession,
  launch,
  onCreateNewConversation,
  scrollable,
}) => {
  const [localConversationId, setLocalConversationId] = useState<string | null>(
    null,
  );
  const [pendingFirstMessage, setPendingFirstMessage] = useState<string | null>(
    null,
  );
  const initialPromptSentRef = useRef(false);
  const { mutate: createAgentSessionConversation } =
    useCreateAgentSessionConversation();
  const conversationId = localConversationId ?? agentSession.conversationId;
  const cliRequired = useCliRequired(
    organizationId,
    projectId,
    conversationId ?? undefined,
    { enabled: conversationId !== null },
  );
  const interactionAccess = useAgentSessionInteractionAccess(
    cliRequired.type === "ready" ? cliRequired.machine.machineId : null,
  );

  const context = useMemo(() => ({ projectId }), [projectId]);

  const capturedAt = useRef(new Date().toISOString());
  const contextMetadata = useMemo(
    () => ({
      capturedAt: capturedAt.current,
      organizationId,
      projectId,
      agentSessionId: agentSession.id,
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    }),
    [organizationId, projectId, agentSession.id],
  );

  // Silent catalog-default provider/model/reasoningEffort — no picker on this
  // surface, but all three are required on the start-run envelope. They exist
  // only once the conversation's CLI has reported its catalog.
  const machineId =
    cliRequired.type === "ready"
      ? cliRequired.machine.machineId
      : (agentSession.machineId ?? null);
  const catalogSource = useMemo(
    () => (machineId ? { organizationId, projectId, machineId } : null),
    [organizationId, projectId, machineId],
  );
  const { selection } = useSurfaceSelection({
    surfaceId: FEATURE_TREE_CONVERSATION_SURFACE_ID,
    catalogSource,
    resetKey: null,
  });
  const catalogNotice = useSurfaceCatalogNotice(
    catalogSource,
    "feature-tree-conversation",
  );

  // Bind-only start-run payload: the run is materialized with the feature-tree
  // arm so the CLI dispatcher binds the handler; the user's first turn rides a
  // separate posted message (see the pendingFirstMessage effect below).
  const startRunPayload = useMemo<RunCreatePayloadFeatureTreeConversation>(
    () => ({
      entity: { entityType: "PROJECT", entityId: projectId },
      projectId,
      promptType: "feature_tree_conversation",
      userMessage: "",
    }),
    [projectId],
  );

  const lifecycle = useAgentRunLifecycle({
    apiClient,
    // The start-run needs the CLI's provider/model, so it waits for them.
    enabled: selection !== null,
    organizationId,
    projectId,
    agentSessionId: agentSession.id,
    agentSessionStatus: agentSession.status,
    agentSessionConversationId: conversationId,
    context,
    contextMetadata,
    ...(agentSession.serviceIds && agentSession.serviceIds.length > 0
      ? { serviceIds: agentSession.serviceIds }
      : {}),
    ...(agentSession.launchServiceId
      ? { launchServiceId: agentSession.launchServiceId }
      : {}),
    ...(selection
      ? {
          provider: selection.provider,
          model: selection.model,
          ...(selection.reasoningEffort
            ? { reasoningEffort: selection.reasoningEffort }
            : {}),
        }
      : {}),
    launch,
    arm: {
      kind: "handler",
      promptType: LocalPromptType.FeatureTreeConversation,
      payload: startRunPayload,
    },
    ...(cliRequired.type === "ready"
      ? { machineId: cliRequired.machine.machineId }
      : {}),
  });

  const handleFirstMessage = useCallback(
    async (message: string) => {
      if ((localConversationId ?? agentSession.conversationId) !== null) return;
      setPendingFirstMessage(message);
      const { conversation } = await createAgentSessionConversation({
        organizationId,
        projectId,
        agentSessionId: agentSession.id,
        body: {
          workflowType: WorkflowName.FeatureTreeConversation,
          workflowAboutType: "project",
          workflowAboutId: projectId,
        },
      });
      setLocalConversationId(conversation.id);
    },
    [
      localConversationId,
      agentSession.conversationId,
      agentSession.id,
      createAgentSessionConversation,
      organizationId,
      projectId,
    ],
  );

  // Forward the message the user typed into ChatSessionPendingPlaceholder
  // once the run is active, so the FTC agent answers the first turn instead
  // of waiting for the user to retype it.
  useEffect(() => {
    if (!lifecycle.runId || !pendingFirstMessage) return;
    if (!conversationId) return;
    if (!interactionAccess.isDeviceEnabled) return;
    if (initialPromptSentRef.current) return;
    initialPromptSentRef.current = true;
    const userMessage = pendingFirstMessage;
    interactionAccess.interactions
      .submitMessage(
        buildDirectTriggerInput({
          organizationId,
          projectId,
          agentSessionId: agentSession.id,
          conversationId,
          data: {
            // First message of the conversation: carry the full feature-tree arm
            // so the CLI dispatcher can bootstrap the turn.
            agentInput: buildAgentInput({
              promptType: "feature_tree_conversation",
              projectId,
              userMessage,
            }),
            references: { resolved: [], unresolved: [] },
          },
        }),
      )
      .then((result) => {
        if (result.state !== "succeeded" && result.state !== "accepted") {
          throw new Error(
            result.state === "cancelled"
              ? "The operation was cancelled."
              : result.message,
          );
        }
        setPendingFirstMessage(null);
      })
      .catch((err: unknown) => {
        log.error("general", "FTC initial first-message send failed", {
          error: err,
        });
        initialPromptSentRef.current = false;
      });
  }, [
    organizationId,
    projectId,
    agentSession.id,
    conversationId,
    lifecycle.runId,
    pendingFirstMessage,
    cliRequired,
    interactionAccess,
  ]);

  const { sendUserMessage } = lifecycle;
  const handleSubmitReply = useCallback(
    async (
      text: string,
      skillSelection?: AgentSkillSelection,
      attachments: RunAttachmentReference[] = [],
    ): Promise<void> => {
      if (!selection) {
        throw new Error(
          "The model catalog has not loaded yet. Wait for the model choices before sending.",
        );
      }
      const result = await sendUserMessage(text, skillSelection, attachments);
      if (!result.ok) {
        throw new Error(result.error);
      }
    },
    [selection, sendUserMessage],
  );

  if (conversationId === null) {
    return (
      <ChatSessionPendingPlaceholder
        message="What would you like to explore in the feature tree?"
        onSubmit={handleFirstMessage}
      />
    );
  }

  if (catalogNotice) {
    return <>{catalogNotice}</>;
  }

  if (lifecycle.error) {
    return (
      <Stack spacing={2}>
        <SessionErrorAlert
          error={lifecycle.error}
          errorCode={lifecycle.errorCode}
          onRetry={lifecycle.retryInit}
        />
        <LocalRuntimeUnavailableAlert error={lifecycle.error} />
      </Stack>
    );
  }

  if (!lifecycle.runId) {
    return <LoadingPanel />;
  }

  return (
    <AgentConversationView
      organizationId={organizationId}
      projectId={projectId}
      agentSessionId={agentSession.id}
      conversationId={conversationId}
      onSubmitReply={handleSubmitReply}
      onCreateNewConversation={onCreateNewConversation}
      onStopRun={lifecycle.stopRun}
      stoppingRun={lifecycle.stoppingRun}
      scrollable={scrollable}
    />
  );
};

export const FeatureTreeConversationChat: React.FC<
  FeatureTreeConversationChatProps
> = ({
  organizationId,
  projectId,
  agentSession,
  onCreateNewConversation,
  scrollable = false,
}) => {
  const launch = useLaunchRunOrchestration({
    organizationId,
    apiClient,
    projectId,
    agentSessionId: agentSession.id,
    ...(agentSession.conversationId
      ? { conversationId: agentSession.conversationId }
      : {}),
  });

  return (
    <Box
      sx={{
        minHeight: scrollable ? 0 : 400,
        ...(scrollable
          ? {
              display: "flex",
              flex: 1,
              minWidth: 0,
              overflow: "hidden",
            }
          : {}),
      }}
      data-testid="feature-tree-conversation-chat"
    >
      <FeatureTreeConversationActive
        organizationId={organizationId}
        projectId={projectId}
        agentSession={agentSession}
        launch={launch}
        onCreateNewConversation={onCreateNewConversation}
        scrollable={scrollable}
      />
    </Box>
  );
};
