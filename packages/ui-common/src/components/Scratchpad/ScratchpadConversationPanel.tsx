import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Box, Button, Typography } from "@mui/material";
import ChatIcon from "@mui/icons-material/Chat";
import { useLocation } from "react-router-dom";
import { AgentSessionType, EntityType } from "../../api";
import { usePathService } from "../../contexts";
import { useCreateAgentSession } from "../../data/hooks/useCreateAgentSession";
import { useUserIdentity } from "../../hooks/useUserIdentity";
import { EntityConversationChat } from "../AgentSession/EntityConversationChat";
import { RuntimeModelSelector } from "../AgentSession/RuntimeModelSelector";
import { resolveAgentBridgeRecoveryState } from "../AgentSession/agentBridgeRecoveryState";
import { useMachineResolution } from "../AgentSession/runtime/coding/useMachineResolution";
import { updateAgentSessionRecord } from "../AgentSession/runtime/coding/update-agent-session-record";
import {
  SCRATCHPAD_CONVERSATION_SURFACE_ID,
  type SurfaceSelection,
  writeSurfaceSelection,
} from "../AgentSession/surfaceSelectionMemory";
import { useSurfaceSelection } from "../AgentSession/useSurfaceSelection";
import {
  buildEntityConversationSessionConfig,
  resolveEntityConversationRuntimeSelection,
} from "../AgentSession/entityConversationSessionConfig";
import { bindGraphConversationAgentSessionMachine } from "../InteractionComponent/bindGraphConversationAgentSessionMachine";
import type { ScratchpadItem } from "./types";
import type { AgentSessionDto } from "../../api";

interface ScratchpadConversationPanelProps {
  items: ScratchpadItem[];
}

export const ScratchpadConversationPanel: React.FC<
  ScratchpadConversationPanelProps
> = ({ items }) => {
  const location = useLocation();
  const userIdentity = useUserIdentity();
  const pathService = usePathService();

  const organizationId = userIdentity?.currentOrgId ?? "";
  const projectId = pathService.extractProjectId(location.pathname) ?? "";
  const hasContext = !!(organizationId && projectId);

  const { mutate: createSession } = useCreateAgentSession();
  const [agentSession, setAgentSession] = useState<AgentSessionDto | null>(
    null,
  );
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const machineResolution = useMachineResolution(
    agentSession?.machineId ?? null,
  );
  const selectedMachineId =
    machineResolution.selectedMachine?.machineId ?? null;
  const catalogSource = useMemo(
    () =>
      hasContext && selectedMachineId
        ? { organizationId, projectId, machineId: selectedMachineId }
        : null,
    [hasContext, organizationId, projectId, selectedMachineId],
  );
  const {
    selection,
    setSelection,
    updateSelection: patchSelection,
  } = useSurfaceSelection({
    surfaceId: SCRATCHPAD_CONVERSATION_SURFACE_ID,
    catalogSource,
    resetKey: null,
  });
  const hydratedSelectionSessionIdRef = useRef<string | null>(null);
  const displayedSelection = useMemo(() => {
    if (
      agentSession &&
      hydratedSelectionSessionIdRef.current !== agentSession.id
    ) {
      return (
        resolveEntityConversationRuntimeSelection(agentSession, selection) ??
        selection
      );
    }
    return selection;
  }, [agentSession, selection]);
  useEffect(() => {
    if (!agentSession) {
      hydratedSelectionSessionIdRef.current = null;
      return;
    }
    if (hydratedSelectionSessionIdRef.current === agentSession.id) return;
    const hydrated = resolveEntityConversationRuntimeSelection(
      agentSession,
      selection,
    );
    if (!hydrated) return;
    hydratedSelectionSessionIdRef.current = agentSession.id;
    setSelection(hydrated);
  }, [agentSession, selection, setSelection]);
  const machineSelection = useMemo(
    () => ({
      machines: machineResolution.machines,
      machineMode: machineResolution.mode,
      selectedMachineId,
      onSelectMachine: machineResolution.setSelectedMachineId,
      recoveryState: resolveAgentBridgeRecoveryState({
        type: "inventory",
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
  const updateSelection = useCallback(
    (patch: (current: SurfaceSelection) => SurfaceSelection) => {
      patchSelection((current) => {
        const next = patch(current);
        writeSurfaceSelection(SCRATCHPAD_CONVERSATION_SURFACE_ID, next);
        return next;
      });
    },
    [patchSelection],
  );

  const persistRuntimeSelection = useCallback(async () => {
    if (!agentSession || !selectedMachineId) {
      throw new Error("An execution-ready Agent Bridge must be selected.");
    }
    if (!displayedSelection) {
      throw new Error("Wait for the machine's model choices to load.");
    }
    const result = await updateAgentSessionRecord({
      organizationId,
      projectId,
      agentSessionId: agentSession.id,
      machineId: selectedMachineId,
      provider: displayedSelection.provider,
      config: buildEntityConversationSessionConfig(displayedSelection),
    });
    if (!result.ok) throw new Error(result.error);
  }, [
    agentSession,
    displayedSelection,
    organizationId,
    projectId,
    selectedMachineId,
  ]);

  const primaryItem = items[0];

  const handleStartConversation = useCallback(async () => {
    if (!primaryItem || isCreating || !hasContext) return;
    if (!selectedMachineId || !selection) {
      return;
    }

    setIsCreating(true);
    setError(null);

    try {
      const itemSummary = items
        .map((i) => `${i.entityName} (${i.entityType})`)
        .join(", ");

      const session = await createSession({
        organizationId,
        agentSession: {
          projectId,
          sessionDate: new Date().toISOString(),
          title: `Scratchpad: ${itemSummary}`.slice(0, 200),
          entityId: primaryItem.entityId,
          entityType: primaryItem.entityType as EntityType,
          type: AgentSessionType.EntityConversation,
          provider: selection.provider,
          config: buildEntityConversationSessionConfig(selection),
        },
      });

      const boundSession = await bindGraphConversationAgentSessionMachine({
        organizationId,
        projectId,
        agentSessionId: session.id,
        machineId: selectedMachineId,
      });

      setAgentSession(boundSession);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to start conversation",
      );
    } finally {
      setIsCreating(false);
    }
  }, [
    primaryItem,
    items,
    isCreating,
    createSession,
    organizationId,
    projectId,
    hasContext,
    selectedMachineId,
    selection,
  ]);

  const handleCreateNewConversation = useCallback(async () => {
    setAgentSession(null);
  }, []);

  if (!hasContext) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100%",
          minHeight: 300,
          gap: 2,
          px: 3,
          textAlign: "center",
        }}
      >
        <ChatIcon sx={{ fontSize: 40, color: "text.disabled" }} />
        <Typography variant="body2" color="text.secondary" maxWidth={280}>
          Navigate to a project to start a conversation about these items.
        </Typography>
      </Box>
    );
  }

  const entityId = primaryItem?.entityId ?? "";
  const entityType = primaryItem?.entityType ?? "";

  if (agentSession) {
    return (
      <>
        <RuntimeModelSelector
          testIdPrefix="scratchpad-conversation"
          catalogSource={catalogSource}
          provider={displayedSelection?.provider ?? null}
          model={displayedSelection?.model ?? null}
          reasoningEffort={displayedSelection?.reasoningEffort ?? null}
          fastMode={displayedSelection?.fastMode ?? false}
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
        <EntityConversationChat
          organizationId={organizationId}
          projectId={projectId}
          agentSession={agentSession}
          entityId={entityId}
          entityType={entityType}
          runtimeSelection={displayedSelection}
          machineId={selectedMachineId ?? agentSession.machineId ?? ""}
          onBeforeLocalExecution={persistRuntimeSelection}
          onCreateNewConversation={handleCreateNewConversation}
        />
      </>
    );
  }

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
        minHeight: 300,
        gap: 2,
        px: 3,
        textAlign: "center",
      }}
    >
      <RuntimeModelSelector
        testIdPrefix="scratchpad-conversation"
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
      <ChatIcon sx={{ fontSize: 40, color: "text.disabled" }} />
      <Typography variant="body2" color="text.secondary" maxWidth={280}>
        Start a conversation about the {items.length}{" "}
        {items.length === 1 ? "item" : "items"} in your scratchpad.
      </Typography>
      {error && (
        <Typography variant="caption" color="error">
          {error}
        </Typography>
      )}
      <Button
        variant="contained"
        size="small"
        onClick={handleStartConversation}
        disabled={
          isCreating ||
          items.length === 0 ||
          selectedMachineId === null ||
          selection === null
        }
        startIcon={<ChatIcon />}
      >
        {isCreating ? "Starting\u2026" : "Start conversation"}
      </Button>
    </Box>
  );
};
