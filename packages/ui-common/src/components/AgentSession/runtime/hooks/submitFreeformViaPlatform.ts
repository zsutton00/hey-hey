import { MessageType } from "../../../../api/index";
import type {
  RunAttachmentReference,
  AgentSkillSelection,
  LocalPromptType,
} from "../../../../api";
import type { AgentInvocationData } from "../../../../types/userTracking";
import {
  buildFollowupAgentInput,
  buildUserMessageData,
} from "./directTriggerInput";
import type { AgentSessionInteractions } from "../../operations/AgentOperationCoordinator";
import type {
  SubmitPromptResult,
  SubmitPromptTelemetrySummary,
} from "./usePromptRunSubmission";

const LOG_PREFIX = "[submitFreeformViaPlatform]";

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

const toLatencyMs = (startedAtMs: number): number =>
  Math.max(0, Date.now() - startedAtMs);

const toTelemetryProvider = (
  provider: string
): AgentInvocationData["provider"] => {
  if (provider === "claude") return "claude";
  if (provider === "opencode") return "opencode";
  return "codex";
};

/**
 * Minimal contract the helper needs from the platform API client. Typed as a
 * pick so tests can pass a stub without recreating the full `UnifiedApiClient`.
 */
export interface SubmitFreeformViaPlatformInput {
  interactions: AgentSessionInteractions;
  run: { runId: string; providerRunId: string | null; provider: string };
  organizationId: string | null;
  agentSessionId: string | null;
  conversationId: string;
  projectId: string;
  promptText: string;
  /** Resolved by the caller from the active SessionMethodContext. */
  localPromptType: LocalPromptType;
  /** Pathless provider-owned Skill identity for this follow-up. */
  skillSelection?: AgentSkillSelection;
  attachments?: RunAttachmentReference[];
}

/**
 * Authors a freeform follow-up as a real platform USER message instead of
 * pushing it down the local-CLI rail. The platform's existing
 * `handleUserMessageCreated` handler then emits the SYSTEM `triggersAgent`
 * sibling that dispatches the CLI's follow-up turn, so the two
 * historically-parallel paths converge on one.
 *
 * Returns the same `SubmitPromptResult` shape `submitPromptForRun` returns so
 * callers and telemetry sinks observe no structural change.
 */
export const submitFreeformViaPlatform = async ({
  interactions,
  run,
  organizationId,
  agentSessionId,
  conversationId,
  projectId,
  promptText,
  localPromptType,
  skillSelection,
  attachments = [],
}: SubmitFreeformViaPlatformInput): Promise<SubmitPromptResult> => {
  // Send parentMessageId explicitly as null — the platform's CreateMessageDto
  // contract treats null as "append to conversation tail" (see task
  // b657c4c6-bf60-4453-a95a-b4532ec8690a). Resolving the tail client-side
  // would race the live message stream; the server resolves it deterministically
  // and atomically with the insert.
  log("called", {
    runId: run.runId,
    conversationId,
    projectId,
    organizationId,
    agentSessionId,
    localPromptType,
    promptTextLength: promptText.length,
  });

  const telemetry: SubmitPromptTelemetrySummary = {
    agentInvocation: null,
  };

  if (!organizationId) {
    log("returning error: missing organizationId");
    return {
      ok: false,
      error: "Missing organization context required to submit the prompt.",
      telemetry,
    };
  }

  if (!agentSessionId) {
    log("returning error: missing agentSessionId");
    return {
      ok: false,
      error: "Agent session is required before submitting prompts.",
      telemetry,
    };
  }

  const data = buildUserMessageData({
    attachments,
    agentInput: buildFollowupAgentInput(
      localPromptType,
      promptText,
      undefined,
      skillSelection
    ),
  });
  const userMessage = {
    projectId,
    conversationId,
    type: MessageType.User,
    parentMessageId: null,
    data,
  };

  log("submitting coordinator operation", { conversationId });
  const invocationStartedAt = Date.now();

  try {
    const operation = await interactions.submitMessage({
      organizationId,
      projectId,
      agentSessionId,
      conversationId,
      intent: userMessage,
    });
    if (operation.state !== "succeeded" && operation.state !== "accepted") {
      throw new Error(
        operation.state === "cancelled"
          ? "The operation was cancelled."
          : operation.message
      );
    }
    log("coordinator operation acknowledged", { conversationId });
    telemetry.agentInvocation = {
      sessionId: agentSessionId,
      invocationId: run.runId,
      latencyMs: toLatencyMs(invocationStartedAt),
      provider: toTelemetryProvider(run.provider),
      status: "success",
      errorCount: 0,
    };

    return {
      ok: true,
      notice: null,
      telemetry,
    };
  } catch (error) {
    logError("coordinator operation failed", error, { conversationId });
    telemetry.agentInvocation = {
      sessionId: agentSessionId,
      invocationId: run.providerRunId ?? run.runId,
      latencyMs: toLatencyMs(invocationStartedAt),
      provider: toTelemetryProvider(run.provider),
      status: "failure",
      errorMessage:
        error instanceof Error ? error.message : "Failed to submit prompt.",
    };
    return {
      ok: false,
      error:
        error instanceof Error ? error.message : "Failed to submit prompt.",
      telemetry,
    };
  }
};
