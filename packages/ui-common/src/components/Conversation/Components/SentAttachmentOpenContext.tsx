import React, { createContext, useContext, useMemo } from "react";
import { useAgentSession } from "../../../data/hooks/useAgentSession";
import {
  resolveRunAttachmentTarget,
  type RunAttachmentTarget,
} from "../../AgentSession/runtime/hooks/runAttachmentDrop";
import { useLocalCliForSession } from "../../AgentSession/runtime/hooks/useLocalCliForSession";

export type SentAttachmentOpenTarget = RunAttachmentTarget;

const SentAttachmentOpenContext =
  createContext<SentAttachmentOpenTarget | null>(null);

/** The Run and machine sent-attachment chips open files through, if any. */
export const useSentAttachmentOpenTarget =
  (): SentAttachmentOpenTarget | null => useContext(SentAttachmentOpenContext);

/**
 * Supplies the open target for sent-attachment chips of an agent-session
 * conversation. The target exists only when the persisted session resolves to a
 * Run owned by a machine and the CLI reachable from this browser is that same
 * machine; any other state yields no target, so chips stay inert and nothing
 * falls back to a platform-mediated route.
 */
export function SentAttachmentOpenProvider({
  organizationId,
  projectId,
  agentSessionId,
  conversationId,
  children,
}: {
  organizationId: string;
  projectId: string;
  agentSessionId: string | undefined;
  conversationId: string;
  children: React.ReactNode;
}) {
  const sessionQuery = useAgentSession(
    organizationId,
    projectId,
    agentSessionId,
  );
  const runTarget = agentSessionId
    ? resolveRunAttachmentTarget(
        sessionQuery.error ? null : sessionQuery.agentSession,
        { organizationId, projectId, agentSessionId, conversationId },
      )
    : null;
  const runId = runTarget?.runId ?? null;
  const machineId = runTarget?.machineId ?? null;
  const localCli = useLocalCliForSession(machineId);
  const target = useMemo<SentAttachmentOpenTarget | null>(
    () =>
      runId && machineId && localCli.status === "local"
        ? { runId, machineId }
        : null,
    [runId, machineId, localCli.status],
  );
  return (
    <SentAttachmentOpenContext.Provider value={target}>
      {children}
    </SentAttachmentOpenContext.Provider>
  );
}
