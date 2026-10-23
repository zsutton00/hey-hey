import type { AgentSkillSelection, RunAttachmentReference } from "../../api";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  LocalPromptType,
  type AgentSessionDto,
  type RunCreatePayloadOpenItemsTriage,
  type OpenItemsTriageMode,
  type OpenItemsTriageRequestKind,
} from "../../api";
import { apiClient } from "../../clients/client";
import { useLaunchRunOrchestration } from "./useLaunchRunOrchestration";
import { useAgentRunLifecycle } from "./useAgentRunLifecycle";
import { useSurfaceSelection } from "./useSurfaceSelection";
import { useMachineResolution } from "./runtime/coding/useMachineResolution";
import { bindGraphConversationAgentSessionMachine } from "../InteractionComponent/bindGraphConversationAgentSessionMachine";

/** The mode and guidance a review started with; every request repeats them. */
export interface OpenItemsTriageRunOptions {
  mode: OpenItemsTriageMode;
  guidance: string;
}

export function useOpenItemsTriageRuntime(
  organizationId: string,
  projectId: string,
  session: AgentSessionDto,
  { mode, guidance }: OpenItemsTriageRunOptions,
) {
  const requestKind = useRef<OpenItemsTriageRequestKind>("freshPass");
  const conversationId = session.conversationId;
  const machines = useMachineResolution(session.machineId ?? null);
  const machineId = machines.selectedMachine?.machineId;
  // Triage runs on the CLI of the resolved machine, so that CLI's catalog
  // decides the model; nothing is chosen before it has loaded.
  const { selection } = useSurfaceSelection({
    surfaceId: null,
    catalogSource: machineId ? { organizationId, projectId, machineId } : null,
    resetKey: null,
  });
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
    ...(selection
      ? {
          provider: selection.provider,
          model: selection.model,
          reasoningEffort: selection.reasoningEffort ?? "medium",
        }
      : {}),
    arm: {
      kind: "handler",
      promptType: LocalPromptType.OpenItemsTriage,
      payload,
    },
    buildHandlerTurn,
    deferInitialDispatch: true,
    ...(machineId ? { machineId } : {}),
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
        if (!machineId) {
          throw new Error("A ready CLI machine is required to run triage.");
        }
        if (!selection) {
          throw new Error(
            "The machine's model catalog has not loaded, so no model is chosen yet.",
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
      machineId,
      organizationId,
      projectId,
      selection,
      session.id,
      session.machineId,
      sendUserMessage,
    ],
  );
  return {
    send,
    pending,
    error,
    ready: !!machineId && selection !== null,
    machines,
    stopRun: lifecycle.stopRun,
    stoppingRun: lifecycle.stoppingRun,
  };
}
