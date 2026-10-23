import type {
  AgentSessionsApiRestartPlanGenerationRequest,
  RestartPlanGenerationResponseDto,
} from "../../../../api";

const LOG_PREFIX = "[submitRestartPlanGenerationViaPlatform]";

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
 * /organizations/{organizationId}/projects/{projectId}/agent-sessions/{agentSessionId}/restart-plan-generation`
 * (operationId `restartPlanGeneration`) — the platform endpoint that tears down
 * the in-flight plan-generation run and relaunches a fresh one from the
 * preserved seed design doc, returning the new conversation id.
 */
export interface PlatformRestartPoster {
  restartPlanGeneration: (
    request: AgentSessionsApiRestartPlanGenerationRequest
  ) => Promise<{ data: RestartPlanGenerationResponseDto }>;
}

export interface SubmitRestartPlanGenerationViaPlatformInput {
  apiClient: PlatformRestartPoster;
  organizationId: string | null;
  agentSessionId: string | null;
  projectId: string | null;
}

export type SubmitRestartPlanGenerationResult =
  | { ok: true; conversationId: string }
  | { ok: false; error: string };

/**
 * Hands the restart request to the platform. The platform tears down the
 * in-flight run (signed `stop_run` envelope to the owner's CLI, withdrawing
 * DRAFT proposals, purging reports, deleting the plan/conversation/session)
 * while preserving the seed design doc, then relaunches a fresh
 * PlanFromDesignDoc run and returns the new conversation id the caller should
 * route to.
 */
export const submitRestartPlanGenerationViaPlatform = async ({
  apiClient,
  organizationId,
  agentSessionId,
  projectId,
}: SubmitRestartPlanGenerationViaPlatformInput): Promise<SubmitRestartPlanGenerationResult> => {
  log("called", { organizationId, agentSessionId, projectId });

  if (!organizationId) {
    log("returning error: missing organizationId");
    return {
      ok: false,
      error:
        "Missing organization context required to restart plan generation.",
    };
  }

  if (!projectId) {
    log("returning error: missing projectId");
    return {
      ok: false,
      error: "Missing project context required to restart plan generation.",
    };
  }

  if (!agentSessionId) {
    log("returning error: missing agentSessionId");
    return {
      ok: false,
      error: "Agent session is required before restarting plan generation.",
    };
  }

  log("calling apiClient.restartPlanGeneration", { agentSessionId });

  try {
    const response = await apiClient.restartPlanGeneration({
      organizationId: organizationId,
      projectId: projectId,
      agentSessionId: agentSessionId,
    });
    const { restarted, conversationId } = response.data;
    log("apiClient.restartPlanGeneration acknowledged", {
      agentSessionId,
      restarted,
      conversationId,
    });

    // A successful restart must hand back the relaunched conversation id so the
    // caller can route to it. If teardown reported success but no conversation
    // came back, surface it rather than silently no-opping the navigation.
    if (!conversationId) {
      logError(
        "restart returned without a conversationId",
        new Error("missing conversationId"),
        { agentSessionId, restarted }
      );
      return {
        ok: false,
        error: restarted
          ? "Plan generation was restarted but no new conversation was returned."
          : "There was no active plan-generation run to restart.",
      };
    }

    return { ok: true, conversationId };
  } catch (error) {
    logError("apiClient.restartPlanGeneration threw", error, {
      agentSessionId,
    });
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to restart plan generation.",
    };
  }
};
