import { Box, Stack } from "@mui/material";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { WorkflowName, type AgentSessionDto } from "../../api";
import { apiClient } from "../../clients/client.js";
import { useCreateAgentSessionConversation } from "../../data/hooks/useCreateAgentSessionConversation";
import { LocalPromptType, type LocalAgentSearchEntityType } from "../../api";
import type { RunCreatePayloadAgentSearch } from "../../api";
import type { UserMessageAgentInput } from "../../api";
import { TrackingProvider } from "../../contexts/TrackingContext";
import { useLatestMessage } from "../../data/hooks/useLatestMessage";
import { useProject } from "../../data/hooks/useProject";
import { log } from "../../utils/logger";
import { supportsFastMode } from "./capabilityCatalog";
import { AgentConversationView } from "./AgentConversationView";
import { ChatSessionPendingPlaceholder } from "./ChatSessionPendingPlaceholder";
import { LocalRuntimeUnavailableAlert } from "./LocalRuntimeUnavailableAlert";
import { SessionErrorAlert } from "./SessionErrorAlert";
import { LoadingPanel } from "./LoadingPanel";
import { useLaunchRunOrchestration } from "./useLaunchRunOrchestration";
import { useAgentRunLifecycle, type RunLauncher } from "./useAgentRunLifecycle";
import {
  buildAgentInput,
  buildDirectTriggerInput,
} from "./runtime/hooks/directTriggerInput";
import { type SurfaceSelection } from "./surfaceSelectionMemory";
import { useCliRequired } from "./runtime/hooks/useCliRequired";
import { useAgentSessionInteractionAccess } from "./operations/useAgentSessionInteractionAccess";

const AGENT_SEARCH_PAYLOAD_VERSION = 1;

export interface EntitySearchChatProps {
  organizationId: string;
  projectId: string;
  /**
   * The AGENT_SEARCH agent session this chat is bound to. The caller is
   * responsible for creating the session (typically via `useCreateAgentSession`)
   * before mounting this component.
   */
  agentSession: AgentSessionDto;
  /**
   * Provider/model/reasoning-effort triple the start-run envelope is built
   * from. Required: the caller (AdvancedSearch's toolbar) owns the picker UI
   * and persistence, so this component must not silently fall back to a
   * catalog default — the chosen triple is part of the agent-search contract.
   */
  selection: SurfaceSelection;
  /**
   * Optional restriction on which entity types the agent-search handler may target.
   * Forwarded on every `LocalPromptType.AgentSearch` payload so the handler cannot
   * produce a query whose `entityTypes` fall outside this set.
   */
  entityTypes?: LocalAgentSearchEntityType[];
  /**
   * Optional initial user message. When provided, it is sent as the first
   * `LocalPromptType.AgentSearch` prompt after the run becomes active.
   */
  initialUserMessage?: string;
}

interface EntitySearchActiveProps {
  organizationId: string;
  projectId: string;
  agentSession: AgentSessionDto;
  launch: RunLauncher;
  selection: SurfaceSelection;
  entityTypes?: LocalAgentSearchEntityType[];
  initialUserMessage?: string;
}

const EntitySearchActive: React.FC<EntitySearchActiveProps> = ({
  organizationId,
  projectId,
  agentSession,
  launch,
  selection,
  entityTypes,
  initialUserMessage,
}) => {
  const [localConversationId, setLocalConversationId] = useState<string | null>(
    null,
  );
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

  const contextMetadata = useMemo(
    () => ({
      capturedAt: new Date().toISOString(),
      organizationId,
      projectId,
      agentSessionId: agentSession.id,
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    }),
    [organizationId, projectId, agentSession.id],
  );

  // Bind-only start-run payload: the run is materialized with the agent-search
  // arm so the CLI dispatcher binds the handler. `userMessage` is a bind seed
  // (the live query rides the separately-posted first message below), so it
  // carries the queued initial message when present and is empty otherwise.
  const startRunPayload = useMemo<RunCreatePayloadAgentSearch>(
    () => ({
      entity: { entityType: "AGENT_SESSION", entityId: agentSession.id },
      payloadVersion: AGENT_SEARCH_PAYLOAD_VERSION,
      userMessage: initialUserMessage ?? "",
      ...(entityTypes && entityTypes.length > 0 ? { entityTypes } : {}),
      promptType: "agent_search",
    }),
    [agentSession.id, initialUserMessage, entityTypes],
  );

  // agentSessionStatus stays NOT_STARTED for search sessions, so the
  // status-based guard in useAgentRunLifecycle doesn't fire on resume.
  // Detect resumed sessions (server already bound a conversation, nothing
  // created locally this mount) and skip the start-run dispatch.
  const isResumedSession =
    agentSession.conversationId !== null && localConversationId === null;

  const lifecycle = useAgentRunLifecycle({
    apiClient,
    enabled: true,
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
    provider: selection.provider,
    model: selection.model,
    ...(selection.reasoningEffort
      ? { reasoningEffort: selection.reasoningEffort }
      : {}),
    ...(supportsFastMode(selection.provider, selection.model)
      ? { fastMode: selection.fastMode ?? false }
      : {}),
    launch,
    arm: {
      kind: "handler",
      promptType: LocalPromptType.AgentSearch,
      payload: startRunPayload,
    },
    deferInitialDispatch: isResumedSession,
    ...(cliRequired.type === "ready"
      ? { machineId: cliRequired.machine.machineId }
      : {}),
  });

  // First message of the conversation: carry the full agent_search arm so the
  // CLI dispatcher can bootstrap the turn (entityTypes scope the query). Used
  // only for the initial send — follow-ups ride buildFollowupAgentInput.
  const buildInitialAgentSearchInput = useCallback(
    (userMessage: string): UserMessageAgentInput =>
      buildAgentInput({
        promptType: "agent_search",
        payloadVersion: AGENT_SEARCH_PAYLOAD_VERSION,
        userMessage,
        ...(entityTypes && entityTypes.length > 0 ? { entityTypes } : {}),
      }),
    [entityTypes],
  );

  // Only auto-send the initial prompt when the conversation is genuinely
  // empty. Guarding only on a ref would re-send if the component ever
  // remounts while the session persists, and would not recover from a send
  // that fails before any message was persisted.
  const latestMessage = useLatestMessage(
    organizationId,
    projectId,
    conversationId ?? undefined,
    {
      enabled:
        !!lifecycle.runId && !!initialUserMessage && conversationId !== null,
    },
  );
  const conversationEmpty =
    latestMessage.isFetched && latestMessage.data === null;

  const initialPromptSentRef = useRef(false);
  useEffect(() => {
    if (!lifecycle.runId || !initialUserMessage) return;
    if (!conversationId) return;
    if (!interactionAccess.isDeviceEnabled) return;
    if (!conversationEmpty || initialPromptSentRef.current) return;
    initialPromptSentRef.current = true;

    interactionAccess.interactions
      .submitMessage(
        buildDirectTriggerInput({
          organizationId,
          projectId,
          agentSessionId: agentSession.id,
          conversationId,
          data: {
            agentInput: buildInitialAgentSearchInput(initialUserMessage),
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
      })
      .catch((err: unknown) => {
        log.error("general", "Agent-search initial prompt send failed", {
          error: err,
        });
        // Allow a retry on the next render cycle (e.g. after lifecycle retry).
        initialPromptSentRef.current = false;
      });
  }, [
    organizationId,
    projectId,
    agentSession.id,
    conversationId,
    lifecycle.runId,
    initialUserMessage,
    conversationEmpty,
    buildInitialAgentSearchInput,
    cliRequired,
    interactionAccess,
  ]);

  const handleFirstMessage = useCallback(
    async (_message: string) => {
      if ((localConversationId ?? agentSession.conversationId) !== null) return;
      const { conversation } = await createAgentSessionConversation({
        organizationId,
        projectId,
        agentSessionId: agentSession.id,
        body: {
          workflowType: WorkflowName.AgentSearch,
          workflowAboutType: "agent-search",
          workflowAboutId: agentSession.id,
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

  // When the caller queued an initial user message (e.g. from AdvancedSearch),
  // auto-create the conversation so the user does not have to retype their
  // query into ChatSessionPendingPlaceholder. The existing initial-prompt
  // useEffect then sends `initialUserMessage` once the run is active.
  const autoCreateConversationRef = useRef(false);
  useEffect(() => {
    if (conversationId !== null) return;
    if (!initialUserMessage) return;
    if (autoCreateConversationRef.current) return;
    autoCreateConversationRef.current = true;

    createAgentSessionConversation({
      organizationId,
      projectId,
      agentSessionId: agentSession.id,
      body: {
        workflowType: WorkflowName.AgentSearch,
        workflowAboutType: "agent-search",
        workflowAboutId: agentSession.id,
      },
    })
      .then(({ conversation }) => {
        setLocalConversationId(conversation.id);
      })
      .catch((err) => {
        log.error("general", "Agent-search auto conversation create failed", {
          error: err,
        });
        autoCreateConversationRef.current = false;
      });
  }, [
    conversationId,
    initialUserMessage,
    createAgentSessionConversation,
    organizationId,
    projectId,
    agentSession.id,
  ]);

  if (conversationId === null) {
    if (initialUserMessage) {
      return <LoadingPanel />;
    }
    return (
      <ChatSessionPendingPlaceholder
        message="How can I help you find something?"
        onSubmit={handleFirstMessage}
      />
    );
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
      onStopRun={lifecycle.stopRun}
      stoppingRun={lifecycle.stoppingRun}
    />
  );
};

export const EntitySearchChat: React.FC<EntitySearchChatProps> = ({
  organizationId,
  projectId,
  agentSession,
  selection,
  entityTypes,
  initialUserMessage,
}) => {
  const { data: project } = useProject(organizationId, projectId);

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
    <Box sx={{ minHeight: 400 }} data-testid="entity-search-chat">
      <TrackingProvider
        context={{
          page: {
            name: "entity-search-chat",
            path: "/advanced-search/agent-search",
            section: "conversation-viewer",
          },
          workflow: {
            id: agentSession.id,
            name: "agent-search",
          },
          ...(project
            ? {
                project: {
                  id: project.id,
                  name: project.name,
                },
              }
            : {}),
        }}
      >
        <EntitySearchActive
          organizationId={organizationId}
          projectId={projectId}
          agentSession={agentSession}
          launch={launch}
          selection={selection}
          {...(entityTypes ? { entityTypes } : {})}
          {...(initialUserMessage ? { initialUserMessage } : {})}
        />
      </TrackingProvider>
    </Box>
  );
};
