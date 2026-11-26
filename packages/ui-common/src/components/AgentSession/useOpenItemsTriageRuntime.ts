import type { AgentSkillSelection, RunAttachmentReference } from "../../api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  LocalPromptType,
  type AgentSessionDto,
  type MachineDto,
  type RunCreatePayloadOpenItemsTriage,
  type OpenItemsTriageMode,
  type OpenItemsTriageRequestKind,
} from "../../api";
import { apiClient } from "../../clients/client";
import { useLaunchRunOrchestration } from "./useLaunchRunOrchestration";
import { useAgentRunLifecycle } from "./useAgentRunLifecycle";
import type { SurfaceSelection } from "./surfaceSelectionMemory";
import { useUserPairedMachines } from "../../data/hooks/useUserPairedMachines";
import { isMachineExecutionReady } from "./runtime/coding/machineExecutionReadiness";
import {
  resolveMachineUnavailableState,
  type AgentBridgeRecoveryState,
} from "./agentBridgeRecoveryState";
import { bindGraphConversationAgentSessionMachine } from "../InteractionComponent/bindGraphConversationAgentSessionMachine";
import { logError } from "./runtime/coding/agent-session-helpers";

/**
 * What a review was started with: its mode and guidance, and the machine and
 * runtime chosen for it. Every request of the review repeats them.
 */
export interface OpenItemsTriageRunOptions {
  mode: OpenItemsTriageMode;
  guidance: string;
  machineId: string;
  runtime: SurfaceSelection;
}

/** The state of the review's own machine; no other machine ever stands in. */
const resolveReviewMachineState = ({
  machines,
  machineId,
  isReady,
  error,
}: {
  machines: MachineDto[];
  machineId: string;
  isReady: boolean;
  error: unknown;
}): AgentBridgeRecoveryState => {
  if (error) {
    return { type: "status_unavailable" };
  }

  if (!isReady) {
    return { type: "loading" };
  }

  const machine = machines.find(
    (candidate) => candidate.machineId === machineId,
  );
  if (!machine) {
    return { type: "bound_machine_missing" };
  }

  return isMachineExecutionReady(machine)
    ? { type: "ready", machine }
    : resolveMachineUnavailableState(machine);
};

export function useOpenItemsTriageRuntime(
  organizationId: string,
  projectId: string,
  session: AgentSessionDto,
  { mode, guidance, machineId, runtime }: OpenItemsTriageRunOptions,
) {
  const requestKind = useRef<OpenItemsTriageRequestKind>("freshPass");
  const conversationId = session.conversationId;
  const paired = useUserPairedMachines();
  const machineState = resolveReviewMachineState({
    machines: paired.machines,
    machineId,
    isReady: paired.isReady,
    error: paired.error,
  });
  const ready = machineState.type === "ready";
  useEffect(() => {
    if (paired.error) {
      logError(
        "useOpenItemsTriageRuntime: machine list unavailable",
        paired.error,
        { agentSessionId: session.id, machineId },
      );
    }
  }, [paired.error, session.id, machineId]);
  const launch = useLaunchRunOrchestration({
    organizationId,
    projectId,
    agentSessionId: session.id,
    ...(conversationId ? { conversationId } : {}),
    apiClient,
  });
  const buildHandlerTurn = useCallback(
    (text: string): RunCreatePayloadOpenItemsTriage => {
      const reviewGuidance = guidance.trim();
      const kind = requestKind.current;
      // A fresh pass carries the guidance as its message. On a follow-up the
      // message is the user's question, so the guidance travels separately.
      return {
        promptType: "open_items_triage",
        projectId,
        requestKind: kind,
        mode,
        userMessage: kind === "freshPass" ? reviewGuidance : text,
        ...(kind === "followUp" && reviewGuidance
          ? { guidance: reviewGuidance }
          : {}),
        entity: { entityType: "PROJECT", entityId: projectId },
      };
    },
    [projectId, mode, guidance],
  );
  const payload = useMemo(() => buildHandlerTurn(""), [buildHandlerTurn]);
  const context = useMemo(() => ({ projectId }), [projectId]);
  const contextMetadata = useMemo(
    () => ({
      capturedAt: new Date().toISOString(),
      organizationId,
      projectId,
      agentSessionId: session.id,
      userComments: [],
      fileReferences: { resolved: [], unresolved: [] },
    }),
    [organizationId, projectId, session.id],
  );
  const lifecycle = useAgentRunLifecycle({
    apiClient,
    organizationId,
    projectId,
    agentSessionId: session.id,
    agentSessionStatus: session.status,
    agentSessionConversationId: conversationId,
    context,
    contextMetadata,
    enabled: !!conversationId,
    launch,
    provider: runtime.provider,
    model: runtime.model,
    reasoningEffort: runtime.reasoningEffort,
    ...(runtime.fastMode !== undefined ? { fastMode: runtime.fastMode } : {}),
    arm: {
      kind: "handler",
      promptType: LocalPromptType.OpenItemsTriage,
      payload,
    },
    buildHandlerTurn,
    deferInitialDispatch: true,
    machineId,
  });
  const sending = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { sendUserMessage } = lifecycle;
  const send = useCallback(
    async (
      kind: OpenItemsTriageRequestKind,
      text: string,
      skillSelection?: AgentSkillSelection,
      attachments: RunAttachmentReference[] = [],
    ): Promise<{ messageId: string } | null> => {
      if (sending.current)
        throw new Error("A triage request is already pending.");
      if (kind === "followUp" && !text.trim()) return null;
      sending.current = true;
      setPending(true);
      setError(null);
      requestKind.current = kind;
      try {
        if (!ready) {
          throw new Error(
            "The machine chosen for this review is not ready to run triage.",
          );
        }
        if (session.machineId !== machineId) {
          await bindGraphConversationAgentSessionMachine({
            organizationId,
            projectId,
            agentSessionId: session.id,
            machineId,
          });
        }
        const result = await sendUserMessage(text, skillSelection, attachments);
        if (!result.ok) throw new Error(result.error);
        return { messageId: result.messageId };
      } catch (cause) {
        logError("useOpenItemsTriageRuntime: send failed", cause, {
          agentSessionId: session.id,
          machineId,
          requestKind: kind,
        });
        setError(
          cause instanceof Error
            ? cause.message
            : "Unable to send triage request.",
        );
        throw cause;
      } finally {
        sending.current = false;
        setPending(false);
      }
    },
    [
      ready,
      machineId,
      organizationId,
      projectId,
      session.id,
      session.machineId,
      sendUserMessage,
    ],
  );
  return {
    send,
    pending,
    error,
    ready,
    machineState,
    stopRun: lifecycle.stopRun,
    stoppingRun: lifecycle.stoppingRun,
  };
}
