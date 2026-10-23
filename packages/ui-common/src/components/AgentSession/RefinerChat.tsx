import { Box, Stack } from "@mui/material";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AgentSessionType,
  type AgentSessionDto,
  type EntityType,
} from "../../api";
import { useAgentSessions } from "../../data/hooks/useAgentSessions";
import { useCreateAgentSession } from "../../data/hooks/useCreateAgentSession";
import { getErrorMessage } from "../../utils/errorUtils";
import { bindGraphConversationAgentSessionMachine } from "../InteractionComponent/bindGraphConversationAgentSessionMachine";
import { resolveAgentBridgeRecoveryState } from "./agentBridgeRecoveryState";
import { ChatSessionPendingPlaceholder } from "./ChatSessionPendingPlaceholder";
import { EntityConversationChat } from "./EntityConversationChat";
import {
  buildEntityConversationSessionConfig,
  resolveEntityConversationRuntimeSelection,
} from "./entityConversationSessionConfig";
import { LoadingPanel } from "./LoadingPanel";
import type { RunBrowserContextValue } from "./runtime/RunBrowserContext";
import { RuntimeModelSelector } from "./RuntimeModelSelector";
import { SessionErrorAlert } from "./SessionErrorAlert";
import { useMachineResolution } from "./runtime/coding/useMachineResolution";
import { updateAgentSessionRecord } from "./runtime/coding/update-agent-session-record";
import {
  DISCUSS_SURFACE_ID,
  type SurfaceSelection,
  writeSurfaceSelection,
} from "./surfaceSelectionMemory";
import { useSurfaceSelection } from "./useSurfaceSelection";

export interface RefinerChatProps {
  organizationId: string;
  projectId: string;
  entityType: EntityType;
  entityId: string;
  entityName?: string;
  entitySummary?: string;
  onConversationReady?: (conversationId: string) => void;
  /** The session's Run, once its conversation exists; null before then. */
  onRunBrowserContextChange?: (context: RunBrowserContextValue | null) => void;
}

interface ScopedSession {
  scopeKey: string;
  session: AgentSessionDto;
}

interface PendingMessage {
  scopeKey: string;
  text: string;
}

interface PendingCreation {
  scopeKey: string;
  promise: Promise<AgentSessionDto>;
}

export const RefinerChat: React.FC<RefinerChatProps> = ({
  organizationId,
  projectId,
  entityType,
  entityId,
  entityName,
  entitySummary,
  onConversationReady,
  onRunBrowserContextChange,
}) => {
  const scopeKey = `${entityType}:${entityId}`;
  const currentScopeKeyRef = useRef(scopeKey);
  currentScopeKeyRef.current = scopeKey;

  const { agentSessions, isFetched, error, refetch } = useAgentSessions(
    organizationId,
    projectId,
    {
      entityType,
      entityId,
      type: AgentSessionType.EntityConversation,
      enabled: Boolean(organizationId && projectId && entityId),
    },
  );
  const { mutate: createSession } = useCreateAgentSession();
  const [created, setCreated] = useState<ScopedSession | null>(null);
  const [initialMessage, setInitialMessage] = useState<PendingMessage | null>(
    null,
  );
  const creationRef = useRef<PendingCreation | null>(null);

  const session =
    created?.scopeKey === scopeKey
      ? created.session
      : (agentSessions[0] ?? null);
  const machineResolution = useMachineResolution(session?.machineId ?? null);
  const selectedMachineId =
    machineResolution.selectedMachine?.machineId ?? null;
  const runId = session?.conversationId ? session.id : null;
  const runMachineId = selectedMachineId ?? session?.machineId ?? null;
  useEffect(() => {
    onRunBrowserContextChange?.(
      runId ? { runId, sessionMachineId: runMachineId } : null,
    );
  }, [onRunBrowserContextChange, runId, runMachineId]);
  const catalogSource = useMemo(
    () =>
      selectedMachineId
        ? { organizationId, projectId, machineId: selectedMachineId }
        : null,
    [organizationId, projectId, selectedMachineId],
  );
  const {
    selection,
    setSelection,
    updateSelection: patchSelection,
  } = useSurfaceSelection({
    surfaceId: DISCUSS_SURFACE_ID,
    catalogSource,
    resetKey: null,
  });
  const hydratedSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!session) {
      hydratedSessionIdRef.current = null;
      return;
    }
    if (hydratedSessionIdRef.current === session.id) return;
    const hydrated = resolveEntityConversationRuntimeSelection(
      session,
      selection,
    );
    // Nothing names a provider and model yet (the CLI's catalog is still
    // loading): hydrate once it does.
    if (!hydrated) return;
    hydratedSessionIdRef.current = session.id;
    setSelection(hydrated);
  }, [session, selection, setSelection]);

  const updateSelection = useCallback(
    (update: (current: SurfaceSelection) => SurfaceSelection): void => {
      patchSelection((current) => {
        const next = update(current);
        writeSurfaceSelection(DISCUSS_SURFACE_ID, next);
        return next;
      });
    },
    [patchSelection],
  );
  const machineSelection = useMemo(
    () => ({
      machines: machineResolution.machines,
      machineMode: machineResolution.mode,
      selectedMachineId,
      onSelectMachine: machineResolution.setSelectedMachineId,
      recoveryState: resolveAgentBridgeRecoveryState({
        type: "inventory" as const,
        isLoading: !machineResolution.isReady,
        machines: machineResolution.machines,
        selectedMachineId,
      }),
    }),
    [
      machineResolution.isReady,
      machineResolution.machines,
      machineResolution.mode,
      machineResolution.setSelectedMachineId,
      selectedMachineId,
    ],
  );
  const pendingInitialMessage =
    initialMessage?.scopeKey === scopeKey ? initialMessage.text : undefined;

  const persistRuntimeSelection = useCallback(async (): Promise<void> => {
    if (!session || !selectedMachineId) {
      throw new Error("Select an execution-ready machine to continue.");
    }
    if (!selection) {
      throw new Error("Wait for the machine's model choices to load.");
    }
    const result = await updateAgentSessionRecord({
      organizationId,
      projectId,
      agentSessionId: session.id,
      machineId: selectedMachineId,
      provider: selection.provider,
      config: buildEntityConversationSessionConfig(selection),
    });
    if (!result.ok) throw new Error(result.error);
  }, [organizationId, projectId, selectedMachineId, selection, session]);

  const handleFirstSubmit = useCallback(
    async (text: string): Promise<void> => {
      if (session) return;

      const existingCreation = creationRef.current;
      if (existingCreation?.scopeKey === scopeKey) {
        await existingCreation.promise;
        return;
      }
      if (!selectedMachineId) {
        throw new Error("Select an execution-ready machine to continue.");
      }
      if (!selection) {
        throw new Error("Wait for the machine's model choices to load.");
      }

      setInitialMessage({ scopeKey, text });
      const promise = createSession({
        organizationId,
        agentSession: {
          projectId,
          sessionDate: new Date().toISOString(),
          type: AgentSessionType.EntityConversation,
          entityType,
          entityId,
          provider: selection.provider,
          config: buildEntityConversationSessionConfig(selection),
        },
      }).then((nextSession) =>
        bindGraphConversationAgentSessionMachine({
          organizationId,
          projectId,
          agentSessionId: nextSession.id,
          machineId: selectedMachineId,
        }),
      );
      creationRef.current = { scopeKey, promise };

      try {
        const nextSession = await promise;
        if (currentScopeKeyRef.current === scopeKey) {
          setCreated({ scopeKey, session: nextSession });
        }
      } finally {
        if (creationRef.current?.promise === promise) {
          creationRef.current = null;
        }
      }
    },
    [
      createSession,
      entityId,
      entityType,
      organizationId,
      projectId,
      selectedMachineId,
      selection,
      scopeKey,
      session,
    ],
  );

  const runtimeControls = (
    <Box
      data-testid="editor-refiner-runtime-controls"
      sx={{ minWidth: 0, width: "100%", maxWidth: "100%", overflow: "hidden" }}
    >
      <RuntimeModelSelector
        testIdPrefix="editor-refiner"
        catalogSource={catalogSource}
        provider={selection?.provider ?? null}
        model={selection?.model ?? null}
        reasoningEffort={selection?.reasoningEffort ?? null}
        fastMode={selection?.fastMode ?? false}
        onProviderChange={(provider) =>
          updateSelection((current) => ({ ...current, provider }))
        }
        onModelChange={(model) =>
          updateSelection((current) => ({ ...current, model }))
        }
        onReasoningEffortChange={(reasoningEffort) =>
          updateSelection((current) => ({ ...current, reasoningEffort }))
        }
        onFastModeChange={(fastMode) =>
          updateSelection((current) => ({ ...current, fastMode }))
        }
        machineSelection={machineSelection}
      />
    </Box>
  );

  if (error) {
    return (
      <SessionErrorAlert
        error={getErrorMessage(
          error,
          "Unable to load refinement conversation.",
        )}
        onRetry={() => void refetch()}
      />
    );
  }

  if (!isFetched) return <LoadingPanel />;

  if (!session) {
    return (
      <Stack spacing={2} sx={{ minWidth: 0, width: "100%", maxWidth: "100%" }}>
        <ChatSessionPendingPlaceholder
          message={
            entityName
              ? `I'm here to help you with "${entityName}".`
              : "How can I help you?"
          }
          onSubmit={handleFirstSubmit}
        />
        {runtimeControls}
      </Stack>
    );
  }

  return (
    <EntityConversationChat
      organizationId={organizationId}
      projectId={projectId}
      agentSession={session}
      entityType={entityType}
      entityId={entityId}
      entityName={entityName}
      entitySummary={entitySummary}
      runtimeSelection={selection}
      machineId={selectedMachineId ?? session.machineId ?? ""}
      initialUserMessage={pendingInitialMessage}
      onBeforeLocalExecution={persistRuntimeSelection}
      onConversationReady={onConversationReady}
      actionsSlot={runtimeControls}
    />
  );
};
