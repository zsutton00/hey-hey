import type { AgentMessage, AgentSessionId } from "../core";
import { isCredentialError } from "../credentials";

export const AGENT_ERROR_CATEGORIES = [
  "parse_malformed",
  "agent_crash",
  "timeout",
  "auth_failure",
  "rate_limit",
  "network",
  "unknown",
] as const;

export type AgentErrorCategory = (typeof AGENT_ERROR_CATEGORIES)[number];

export const AGENT_ERROR_REASONS = [
  "parse_error",
  "malformed_payload",
  "startup_timeout",
  "prompt_timeout",
  "process_exit",
  "spawn_error",
  "agent_unavailable",
  "auth_invalid",
  "auth_missing",
  "credential_refresh_failed",
  "rate_limited",
  "network_unreachable",
  "aborted",
  "unknown",
] as const;

export type AgentErrorReason = (typeof AGENT_ERROR_REASONS)[number];

export const AGENT_SUGGESTED_ACTIONS = [
  "fix_agent_output",
  "check_agent_setup",
  "wait_and_retry",
  "refresh_credentials",
  "check_network",
  "cancel_or_retry",
  "review_logs",
] as const;

export type AgentSuggestedAction = (typeof AGENT_SUGGESTED_ACTIONS)[number];

export type NormalizedAgentErrorVerbosity = "compact" | "detailed";

export interface NormalizedAgentErrorClassificationContext {
  adapter: string;
  attempt: number;
  maxAttempts: number;
}

export interface NormalizedAgentErrorEvent {
  version: 1;
  timestamp: number;
  adapter: string;
  sessionId: AgentSessionId | null;
  category: AgentErrorCategory;
  reason: AgentErrorReason;
  retryable: boolean;
  terminal: boolean;
  suggestedAction: AgentSuggestedAction;
  userActionMessage: string;
  message: string;
  attempt: number;
  maxAttempts: number;
  rawSubtype?: string;
  raw?: unknown;
}

export interface NormalizedAgentErrorEnvelope {
  error_type: AgentErrorCategory;
  error_reason: AgentErrorReason;
  message: string;
  suggested_action: AgentSuggestedAction;
  suggested_user_action: string;
  retryable: boolean;
  attempt: number;
  max_attempts: number;
  adapter: string;
  session_id: AgentSessionId | null;
}

interface ClassificationDescriptor {
  category: AgentErrorCategory;
  reason: AgentErrorReason;
  retryable: boolean;
  terminal: boolean;
  suggestedAction: AgentSuggestedAction;
}

const AUTH_PATTERN =
  /\b(401|403|unauthori(?:s|z)ed|forbidden|invalid\s+(?:api\s+key|token|credential)|auth(?:entication)?\s*(?:failed|error)?|expired\s+token|token\s+expired)\b/i;
const RATE_LIMIT_PATTERN =
  /\b(429|rate\s*limit(?:ed)?|too\s+many\s+requests|quota\s+exceeded)\b/i;
const NETWORK_PATTERN =
  /\b(network|connection\s+(?:refused|reset|timed?\s*out)|dns|socket\s+hang\s+up|econn(?:reset|refused)|enotfound|eai_again|etimedout|unable\s+to\s+connect)\b/i;
const AGENT_MISSING_PATTERN =
  /\b(enoent|not\s+found|cannot\s+find\s+module|failed\s+to\s+spawn)\b/i;

const NON_TERMINAL_SUBTYPES = new Set<string>([
  "parse_error",
  "malformed_payload",
]);

const stringifyUnknown = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Error) {
    return value.message;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const extractMessageFromPayload = (payload: unknown): string | null => {
  if (typeof payload === "string" && payload.trim().length > 0) {
    return payload;
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const direct = record["message"];
  if (typeof direct === "string" && direct.trim().length > 0) {
    return direct;
  }

  const errorValue = record["error"];
  if (typeof errorValue === "string" && errorValue.trim().length > 0) {
    return errorValue;
  }

  return null;
};

const extractErrorText = (message: AgentMessage): string => {
  for (const item of message.content) {
    if (item.kind !== "error") {
      continue;
    }

    const payloadMessage = extractMessageFromPayload(item.payload);
    if (payloadMessage) {
      return payloadMessage;
    }

    return stringifyUnknown(item.payload);
  }

  if (message.raw !== undefined) {
    return stringifyUnknown(message.raw);
  }

  return "Agent invocation failed";
};

const toUserActionMessage = (action: AgentSuggestedAction): string => {
  switch (action) {
    case "fix_agent_output":
      return "Validate agent output formatting and retry the request.";
    case "check_agent_setup":
      return "Verify agent installation and command configuration.";
    case "wait_and_retry":
      return "Wait briefly and retry; the service is likely transiently unavailable.";
    case "refresh_credentials":
      return "Refresh or re-authenticate credentials and retry.";
    case "check_network":
      return "Check network connectivity and endpoint reachability, then retry.";
    case "cancel_or_retry":
      return "Retry with a longer timeout or cancel the request if no longer needed.";
    case "review_logs":
      return "Review logs for additional context and retry if appropriate.";
    default:
      return "Review logs and retry the operation.";
  }
};

const createEvent = (
  descriptor: ClassificationDescriptor,
  context: NormalizedAgentErrorClassificationContext,
  message: string,
  sessionId: AgentSessionId | null,
  rawSubtype?: string,
  raw?: unknown
): NormalizedAgentErrorEvent => ({
  version: 1,
  timestamp: Date.now(),
  adapter: context.adapter,
  sessionId,
  category: descriptor.category,
  reason: descriptor.reason,
  retryable: descriptor.retryable,
  terminal: descriptor.terminal,
  suggestedAction: descriptor.suggestedAction,
  userActionMessage: toUserActionMessage(descriptor.suggestedAction),
  message,
  attempt: context.attempt,
  maxAttempts: context.maxAttempts,
  rawSubtype,
  raw,
});

const classifyByMessageText = (
  text: string,
  fallback: ClassificationDescriptor
): ClassificationDescriptor => {
  if (AUTH_PATTERN.test(text)) {
    return {
      category: "auth_failure",
      reason: "auth_invalid",
      retryable: true,
      terminal: true,
      suggestedAction: "refresh_credentials",
    };
  }

  if (RATE_LIMIT_PATTERN.test(text)) {
    return {
      category: "rate_limit",
      reason: "rate_limited",
      retryable: true,
      terminal: true,
      suggestedAction: "wait_and_retry",
    };
  }

  if (NETWORK_PATTERN.test(text)) {
    return {
      category: "network",
      reason: "network_unreachable",
      retryable: true,
      terminal: true,
      suggestedAction: "check_network",
    };
  }

  return fallback;
};

export const classifyAgentMessageError = (
  message: AgentMessage,
  context: NormalizedAgentErrorClassificationContext
): NormalizedAgentErrorEvent | null => {
  if (message.type !== "error") {
    return null;
  }

  const text = extractErrorText(message);
  const subtype = message.subtype ?? "unknown";

  let descriptor: ClassificationDescriptor;
  switch (subtype) {
    case "parse_error":
      descriptor = {
        category: "parse_malformed",
        reason: "parse_error",
        retryable: false,
        terminal: false,
        suggestedAction: "fix_agent_output",
      };
      break;
    case "malformed_payload":
      descriptor = {
        category: "parse_malformed",
        reason: "malformed_payload",
        retryable: false,
        terminal: false,
        suggestedAction: "fix_agent_output",
      };
      break;
    case "startup_timeout":
      descriptor = {
        category: "timeout",
        reason: "startup_timeout",
        retryable: true,
        terminal: true,
        suggestedAction: "cancel_or_retry",
      };
      break;
    case "timeout":
      descriptor = {
        category: "timeout",
        reason: "prompt_timeout",
        retryable: true,
        terminal: true,
        suggestedAction: "cancel_or_retry",
      };
      break;
    case "spawn_error":
      descriptor = AGENT_MISSING_PATTERN.test(text)
        ? {
            category: "agent_crash",
            reason: "agent_unavailable",
            retryable: false,
            terminal: true,
            suggestedAction: "check_agent_setup",
          }
        : {
            category: "agent_crash",
            reason: "spawn_error",
            retryable: true,
            terminal: true,
            suggestedAction: "check_agent_setup",
          };
      break;
    case "process_exit":
      descriptor = {
        category: "agent_crash",
        reason: "process_exit",
        retryable: true,
        terminal: true,
        suggestedAction: "wait_and_retry",
      };
      break;
    case "aborted":
      descriptor = {
        category: "unknown",
        reason: "aborted",
        retryable: false,
        terminal: true,
        suggestedAction: "cancel_or_retry",
      };
      break;
    case "stderr":
      descriptor = classifyByMessageText(text, {
        category: "unknown",
        reason: "unknown",
        retryable: false,
        terminal: true,
        suggestedAction: "review_logs",
      });
      break;
    case "session_persist_error":
    case "session_metadata_error":
      descriptor = {
        category: "unknown",
        reason: "unknown",
        retryable: false,
        terminal: false,
        suggestedAction: "review_logs",
      };
      break;
    default:
      descriptor = classifyByMessageText(text, {
        category: "unknown",
        reason: "unknown",
        retryable: false,
        terminal: !NON_TERMINAL_SUBTYPES.has(subtype),
        suggestedAction: "review_logs",
      });
      break;
  }

  return createEvent(
    descriptor,
    context,
    text,
    message.sessionId,
    message.subtype,
    message.raw
  );
};

export const classifyAgentInvocationException = (
  error: unknown,
  context: NormalizedAgentErrorClassificationContext,
  sessionId: AgentSessionId | null = null
): NormalizedAgentErrorEvent => {
  const text = stringifyUnknown(error);

  if (isCredentialError(error)) {
    switch (error.code) {
      case "INVALID_CREDENTIAL":
        return createEvent(
          {
            category: "auth_failure",
            reason: "auth_invalid",
            retryable: true,
            terminal: true,
            suggestedAction: "refresh_credentials",
          },
          context,
          error.message,
          sessionId,
          "credential_error",
          error
        );
      case "RATE_LIMITED":
        return createEvent(
          {
            category: "rate_limit",
            reason: "rate_limited",
            retryable: true,
            terminal: true,
            suggestedAction: "wait_and_retry",
          },
          context,
          error.message,
          sessionId,
          "credential_error",
          error
        );
      case "REFRESH_FAILED":
        return createEvent(
          {
            category: "auth_failure",
            reason: "credential_refresh_failed",
            retryable: false,
            terminal: true,
            suggestedAction: "refresh_credentials",
          },
          context,
          error.message,
          sessionId,
          "credential_error",
          error
        );
      default:
        return createEvent(
          {
            category: "unknown",
            reason: "unknown",
            retryable: false,
            terminal: true,
            suggestedAction: "review_logs",
          },
          context,
          error.message,
          sessionId,
          "credential_error",
          error
        );
    }
  }

  if (AUTH_PATTERN.test(text)) {
    return createEvent(
      {
        category: "auth_failure",
        reason: "auth_invalid",
        retryable: true,
        terminal: true,
        suggestedAction: "refresh_credentials",
      },
      context,
      text,
      sessionId,
      "exception",
      error
    );
  }

  if (RATE_LIMIT_PATTERN.test(text)) {
    return createEvent(
      {
        category: "rate_limit",
        reason: "rate_limited",
        retryable: true,
        terminal: true,
        suggestedAction: "wait_and_retry",
      },
      context,
      text,
      sessionId,
      "exception",
      error
    );
  }

  if (NETWORK_PATTERN.test(text)) {
    return createEvent(
      {
        category: "network",
        reason: "network_unreachable",
        retryable: true,
        terminal: true,
        suggestedAction: "check_network",
      },
      context,
      text,
      sessionId,
      "exception",
      error
    );
  }

  if (/\b(timeout|timed\s*out|etimedout)\b/i.test(text)) {
    return createEvent(
      {
        category: "timeout",
        reason: "prompt_timeout",
        retryable: true,
        terminal: true,
        suggestedAction: "cancel_or_retry",
      },
      context,
      text,
      sessionId,
      "exception",
      error
    );
  }

  return createEvent(
    {
      category: "unknown",
      reason: "unknown",
      retryable: false,
      terminal: true,
      suggestedAction: "review_logs",
    },
    context,
    text,
    sessionId,
    "exception",
    error
  );
};

export const classifyCredentialRefreshFailure = (
  error: unknown,
  context: NormalizedAgentErrorClassificationContext,
  sessionId: AgentSessionId | null = null
): NormalizedAgentErrorEvent =>
  createEvent(
    {
      category: "auth_failure",
      reason: "credential_refresh_failed",
      retryable: false,
      terminal: true,
      suggestedAction: "refresh_credentials",
    },
    context,
    stringifyUnknown(error),
    sessionId,
    "credential_refresh",
    error
  );

export const toNormalizedAgentErrorEnvelope = (
  event: NormalizedAgentErrorEvent,
  verbosity: NormalizedAgentErrorVerbosity
): NormalizedAgentErrorEnvelope & {
  raw_subtype?: string;
  raw_error?: unknown;
} => {
  const envelope: NormalizedAgentErrorEnvelope = {
    error_type: event.category,
    error_reason: event.reason,
    message: event.message,
    suggested_action: event.suggestedAction,
    suggested_user_action: event.userActionMessage,
    retryable: event.retryable,
    attempt: event.attempt,
    max_attempts: event.maxAttempts,
    adapter: event.adapter,
    session_id: event.sessionId,
  };

  if (verbosity === "compact") {
    return envelope;
  }

  return {
    ...envelope,
    raw_subtype: event.rawSubtype,
    raw_error: event.raw,
  };
};

export const isRetryableInvocationFailure = (
  event: NormalizedAgentErrorEvent
): boolean => event.terminal && event.retryable;

export const isAuthFailure = (event: NormalizedAgentErrorEvent): boolean =>
  event.category === "auth_failure";
