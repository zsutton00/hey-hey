const LOG_PREFIX = "[submitStopRunViaPlatform]";

const log = (action: string, data?: Record<string, unknown>) => {
  if (data) {
    console.log(`${LOG_PREFIX} ${action}`, data);
  } else {
    console.log(`${LOG_PREFIX} ${action}`);
  }
};

const logError = (
  action: string,
  error: unknown,
  data?: Record<string, unknown>
) => {
  console.error(`${LOG_PREFIX} ${action}`, { error, ...data });
};

/**
 * Minimal contract the helper needs from the platform API client. Typed as a
 * pick so tests can pass a stub without recreating the full client.
 *
 * Maps to `POST
 * /organizations/{organizationId}/projects/{projectId}/agent-sessions/{agentSessionId}/stop`
 * (operationId `stopAgentSessionRun`) — the platform endpoint that emits the
 * signed `trigger.control` envelope.
 */
export interface PlatformStopRunPoster {
  stopAgentSessionRun: (
    request: AgentSessionsApiStopAgentSessionRunRequest
  ) => Promise<unknown>;
}

export interface SubmitStopRunViaPlatformInput {
  apiClient: PlatformStopRunPoster;
  runId: string;
  organizationId: string | null;
  agentSessionId: string | null;
  conversationId: string | null;
  projectId: string | null;
}

export type SubmitStopRunResult = { ok: true } | { ok: false; error: string };

/**
 * Hands the stop request to the platform instead of pushing it down the local
 * CLI rail. The platform signs a `trigger.control` envelope and routes it to
 * the conversation owner's CLI, which verifies it and stops the active Run.
 */
export const submitStopRunViaPlatform = async ({
  apiClient,
  runId,
  organizationId,
  agentSessionId,
  conversationId,
  projectId,
}: SubmitStopRunViaPlatformInput): Promise<SubmitStopRunResult> => {
  log("called", {
    runId,
    organizationId,
    agentSessionId,
    conversationId,
    projectId,
  });

  if (!organizationId) {
    log("returning error: missing organizationId");
    return {
      ok: false,
      error: "Missing organization context required to stop the run.",
    };
  }

  if (!projectId) {
    log("returning error: missing projectId");
    return {
      ok: false,
      error: "Missing project context required to stop the run.",
    };
  }

  if (!agentSessionId) {
    log("returning error: missing agentSessionId");
    return {
      ok: false,
      error: "Agent session is required before stopping the run.",
    };
  }

  log("calling apiClient.stopAgentSessionRun", {
    agentSessionId,
    runId,
  });

  try {
    await apiClient.stopAgentSessionRun({
      organizationId: organizationId,
      projectId: projectId,
      agentSessionId: agentSessionId,
    });
    log("apiClient.stopAgentSessionRun acknowledged", {
      agentSessionId,
      runId,
    });
    return { ok: true };
  } catch (error) {
    logError("apiClient.stopAgentSessionRun threw", error, {
      agentSessionId,
      runId,
    });
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Failed to stop the run.",
    };
  }
};
import type { AgentSessionsApiStopAgentSessionRunRequest } from "../../../../api";
