import { extractReferenceMentions } from "../utils/mentions";
import type { AgentInvocationData } from "../../../../types/userTracking";
import { LocalPromptType } from "../../../../api";
import {
  buildDirectTriggerInput,
  buildFollowupAgentInput,
  buildCodeReviewDisplayText,
  type BuildUserMessageDataInput,
  type FollowupAgentOverride,
} from "./directTriggerInput";
import type { AgentSessionInteractions } from "../../operations/AgentOperationCoordinator";

export type { FollowupAgentOverride } from "./directTriggerInput";

const LOG_PREFIX = "[submitPromptForRun]";
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
  data?: Record<string, unknown>,
) => {
  console.error(`${LOG_PREFIX} ${action}`, { error, ...data });
};

/**
 * Minimal run identity the submission helper needs. The lifecycle no longer
 * tracks a `CodingRun`; callers derive these from the agent session
 * (`runId === agentSession.id`, `providerRunId` from the bound provider
 * session) plus the live platform current-state status.
 */
export interface SubmitPromptRunInfo {
  runId: string;
  providerRunId: string | null;
  provider: string;
  status: "idle" | "running" | "complete";
}

interface SubmitPromptInput {
  interactions: AgentSessionInteractions;
  run: SubmitPromptRunInfo;
  organizationId: string | null;
  projectId: string;
  conversationId: string;
  agentSessionId: string | null;
  promptDraft: string;
  startupPrompt: string | null;
  localPromptType: LocalPromptType;
  agentOverride?: FollowupAgentOverride;
  displayText?: string;
}

interface SubmitPromptSuccess {
  ok: true;
  notice: string | null;
  telemetry: SubmitPromptTelemetrySummary;
}

interface SubmitPromptFailure {
  ok: false;
  error: string;
  telemetry: SubmitPromptTelemetrySummary;
}

export type SubmitPromptResult = SubmitPromptSuccess | SubmitPromptFailure;

type SubmitPromptTelemetryStatus =
  | {
      status: "success";
    }
  | {
      status: "failure";
      errorMessage: string;
      errorCode?: string;
    };

export type SubmitPromptAgentInvocationTelemetry = {
  sessionId: string;
  latencyMs: number;
  provider: AgentInvocationData["provider"];
} & (
  | (SubmitPromptTelemetryStatus & {
      status: "success";
      invocationId: string;
      errorCount: number;
    })
  | (SubmitPromptTelemetryStatus & {
      status: "failure";
      invocationId?: string;
    })
);

export interface SubmitPromptTelemetrySummary {
  agentInvocation: SubmitPromptAgentInvocationTelemetry | null;
}

const toLatencyMs = (startedAtMs: number): number =>
  Math.max(0, Date.now() - startedAtMs);

const toInvocationId = (runId: string | null, fallbackRunId: string): string =>
  runId && runId.trim().length > 0 ? runId : fallbackRunId;

const toTelemetryProvider = (
  provider: string,
): AgentInvocationData["provider"] => {
  if (provider === "claude") return "claude";
  if (provider === "opencode") return "opencode";
  return "codex";
};

export const submitPromptForRun = async ({
  interactions,
  run,
  organizationId,
  projectId,
  conversationId,
  agentSessionId,
  promptDraft,
  startupPrompt,
  localPromptType,
  agentOverride,
  displayText,
}: SubmitPromptInput): Promise<SubmitPromptResult> => {
  log("called", {
    runId: run.runId,
    providerRunId: run.providerRunId,
    runStatus: run.status,
    organizationId,
    agentSessionId,
    conversationId,
    promptDraftLength: promptDraft.length,
    hasStartupPrompt: Boolean(startupPrompt),
    hasAgentOverride: agentOverride !== undefined,
  });

  const trimmedPrompt = promptDraft.trim();
  const telemetry: SubmitPromptTelemetrySummary = {
    agentInvocation: null,
  };
  const prompt = startupPrompt
    ? trimmedPrompt
      ? `${startupPrompt}\n\n## Additional Context from User\n${trimmedPrompt}`
      : startupPrompt
    : trimmedPrompt;
  const unresolvedMentions = extractReferenceMentions(promptDraft);
  const reviewDisplayText =
    localPromptType === LocalPromptType.CodeReview
      ? (displayText ?? buildCodeReviewDisplayText(trimmedPrompt))
      : undefined;
  log("resolved prompt details", {
    promptLength: prompt.length,
    unresolvedMentionCount: unresolvedMentions.length,
  });

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

  log("submitting coordinator operation", {
    conversationId,
    promptLength: prompt.length,
  });
  const invocationStartedAt = Date.now();

  try {
    const data: BuildUserMessageDataInput = {
      ...(reviewDisplayText !== undefined
        ? { comment: reviewDisplayText }
        : {}),
      agentInput: buildFollowupAgentInput(
        localPromptType,
        prompt,
        agentOverride,
      ),
      references: {
        resolved: [],
        unresolved: unresolvedMentions,
      },
      attachUserMessageData: run.status !== "idle",
    };
    const operation = await interactions.submitMessage(
      buildDirectTriggerInput({
        organizationId,
        projectId,
        agentSessionId,
        conversationId,
        data,
      }),
    );
    if (operation.state !== "succeeded" && operation.state !== "accepted") {
      throw new Error(
        operation.state === "cancelled"
          ? "The operation was cancelled."
          : operation.message,
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
      invocationId: toInvocationId(run.providerRunId, run.runId),
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
