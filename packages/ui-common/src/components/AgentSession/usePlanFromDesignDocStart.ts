import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { AgentSessionConfigV2, AgentSessionDto } from "../../api";
import { reconcileAgentSessionMutation } from "../../data/agentLaunchReconciliation";
import { useAgentLaunchProgress } from "./operations/useAgentLaunchProgress";
import type { AgentLaunchProgress } from "./operations/AgentLaunchStore";
import { updateAgentSessionRecord } from "./runtime/coding/update-agent-session-record";

export interface UsePlanFromDesignDocStartParams {
  organizationId: string;
  projectId: string;
  conversationId: string;
  agentSession: AgentSessionDto;
  /** The authoritative machine selected by the readiness check. */
  machineId: string | null;
  /** Null until the picked machine's CLI has said which models it offers. */
  agentSessionConfig: AgentSessionConfigV2 | null;
  persistedWorktreeBranch: string | null;
  persistWorktreeBranch: (branch: string | null) => Promise<void>;
  dispatchStartRun: () => Promise<{ ok: true } | { ok: false; error: string }>;
  onSessionPersisted: (session: AgentSessionDto) => void;
}

export interface UsePlanFromDesignDocStartReturn {
  startGenerating: () => void;
  isStarting: boolean;
  startError: string | null;
  progress: AgentLaunchProgress | null;
}

export function usePlanFromDesignDocStart({
  organizationId,
  projectId,
  conversationId,
  agentSession,
  machineId,
  agentSessionConfig,
  persistedWorktreeBranch,
  persistWorktreeBranch,
  dispatchStartRun,
  onSessionPersisted,
}: UsePlanFromDesignDocStartParams): UsePlanFromDesignDocStartReturn {
  const queryClient = useQueryClient();
  const { progress, launches } = useAgentLaunchProgress({
    organizationId,
    projectId,
    agentSessionId: agentSession.id,
    conversationId,
  });
  const startGenerating = useCallback(() => {
    const scope = {
      organizationId,
      projectId,
      agentSessionId: agentSession.id,
      conversationId,
    };
    void launches.prepare(scope, async () => {
      if (!machineId)
        throw new Error(
          "Select an execution-ready machine before starting generation.",
        );
      if (!agentSessionConfig)
        throw new Error("Choose a model before starting generation.");
      await persistWorktreeBranch(persistedWorktreeBranch);
      const configResult = await updateAgentSessionRecord({
        organizationId,
        projectId,
        agentSessionId: agentSession.id,
        machineId,
        config: agentSessionConfig,
      });
      if (!configResult.ok) throw new Error(configResult.error);
      reconcileAgentSessionMutation(queryClient, scope, configResult.session);
      onSessionPersisted(configResult.session);
      launches.dispatching(scope);
      const dispatch = await dispatchStartRun();
      if (!dispatch.ok) throw new Error(dispatch.error);
    });
  }, [
    organizationId,
    projectId,
    conversationId,
    agentSession.id,
    machineId,
    agentSessionConfig,
    persistedWorktreeBranch,
    persistWorktreeBranch,
    dispatchStartRun,
    onSessionPersisted,
    launches,
    queryClient,
  ]);
  return {
    startGenerating,
    isStarting:
      progress?.phase === "preparing" || progress?.phase === "dispatching",
    startError: progress?.phase === "failed" ? progress.error : null,
    progress,
  };
}
