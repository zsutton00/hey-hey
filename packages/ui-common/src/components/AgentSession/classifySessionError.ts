export interface ClassifiedSessionError {
  severity: "error" | "warning" | "info";
  title: string;
  description: string;
  retryable: boolean;
  raw: string;
}

/**
 * Stable error code the platform `start-run` endpoint returns (HTTP 400) when
 * the conversation owner has no live CLI websocket connection. The UI branches
 * on this `code`, not the human-readable message string, because the message
 * may change while the code is contractual.
 */
export const NO_CLI_CONNECTION_CODE = "NO_CLI_CONNECTION";

const RETRYABLE_PATTERN = /\(Type:\s*RETRYABLE\)/i;
const AGENT_EXEC_FAILED_PATTERN = /^Agent execution failed:\s*/i;
const FETCH_FAILED_PATTERN = /fetch failed/i;
const RATE_LIMITED_PATTERN = /\(Type:\s*RATE_LIMITED\)/i;
const TIMEOUT_PATTERN = /\(Type:\s*TIMEOUT\)/i;

export const classifySessionError = (
  raw: string,
  code?: string | null
): ClassifiedSessionError => {
  // A missing CLI connection is an actionable, non-error state — the user just
  // needs to start their agent CLI — so it is surfaced distinctly from genuine
  // failures. Keyed off the structured `code`, never the message string.
  if (code === NO_CLI_CONNECTION_CODE) {
    return {
      severity: "info",
      title: "Your coding agent isn't connected",
      description:
        "Start your agent CLI to run this session. Once it's connected, retry.",
      retryable: true,
      raw,
    };
  }

  const isRetryable = RETRYABLE_PATTERN.test(raw);
  const isRateLimited = RATE_LIMITED_PATTERN.test(raw);
  const isTimeout = TIMEOUT_PATTERN.test(raw);
  const isFetchFailed = FETCH_FAILED_PATTERN.test(raw);
  const isAgentExecFailed = AGENT_EXEC_FAILED_PATTERN.test(raw);

  if (isAgentExecFailed && isFetchFailed) {
    return {
      severity: "warning",
      title: "Connection to the agent failed",
      description:
        "The agent could not reach a required service. " +
        "This is usually a temporary network issue.",
      retryable: true,
      raw,
    };
  }

  if (isRateLimited) {
    return {
      severity: "warning",
      title: "Rate limit reached",
      description:
        "The agent was rate-limited by the provider. " +
        "Wait a moment and try again.",
      retryable: true,
      raw,
    };
  }

  if (isTimeout) {
    return {
      severity: "warning",
      title: "Agent timed out",
      description:
        "The agent took too long to respond. " +
        "This can happen with complex tasks — try again.",
      retryable: true,
      raw,
    };
  }

  if (isRetryable) {
    const inner = raw
      .replace(AGENT_EXEC_FAILED_PATTERN, "")
      .replace(RETRYABLE_PATTERN, "")
      .trim();
    return {
      severity: "warning",
      title: "Something went wrong",
      description: inner
        ? `The agent encountered a temporary issue: ${inner}`
        : "The agent encountered a temporary issue.",
      retryable: true,
      raw,
    };
  }

  if (isAgentExecFailed) {
    const inner = raw.replace(AGENT_EXEC_FAILED_PATTERN, "").trim();
    return {
      severity: "error",
      title: "Agent execution failed",
      description:
        inner || "An unexpected error occurred while running the agent.",
      retryable: false,
      raw,
    };
  }

  return {
    severity: "error",
    title: "Something went wrong",
    description: raw,
    retryable: false,
    raw,
  };
};
