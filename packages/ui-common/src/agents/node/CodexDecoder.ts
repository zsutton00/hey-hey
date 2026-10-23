import {
  NdjsonAgentDecoder,
  type RawNdjsonPayload,
  toAgentSessionId,
  type AgentMessage,
  type AgentMessageType,
  type AgentSessionId,
} from "../core";

const TOOL_EVENT_TYPES = new Set([
  "exec_approval_request",
  "exec_command_begin",
  "patch_apply_begin",
]);

const RESULT_EVENT_TYPES = new Set([
  "exec_command_end",
  "patch_apply_end",
  "token_count",
  "turn_diff",
]);

const SYSTEM_EVENT_TYPES = new Set([
  "task_started",
  "task_complete",
  "turn_aborted",
  "session_configured",
]);

const ASSISTANT_EVENT_TYPES = new Set([
  "agent_message",
  "agent_reasoning",
  "agent_reasoning_delta",
]);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const extractSessionId = (payload: RawNdjsonPayload): AgentSessionId | null => {
  const data = asRecord(payload.data);
  const sessionIdValue =
    asString(payload.session_id) ??
    asString(payload.sessionId) ??
    asString(data?.session_id) ??
    asString(data?.sessionId);

  return sessionIdValue ? toAgentSessionId(sessionIdValue) : null;
};

const normalizeCodexType = (payload: RawNdjsonPayload): AgentMessageType => {
  const rawType = asString(payload.type);

  if (rawType === "assistant") {
    return "assistant";
  }

  if (rawType === "result") {
    return "result";
  }

  if (rawType === "tool") {
    return "tool";
  }

  if (rawType === "system") {
    return "system";
  }

  if (rawType && TOOL_EVENT_TYPES.has(rawType)) {
    return "tool";
  }

  if (rawType && RESULT_EVENT_TYPES.has(rawType)) {
    return "result";
  }

  if (rawType && ASSISTANT_EVENT_TYPES.has(rawType)) {
    return "assistant";
  }

  if (rawType && SYSTEM_EVENT_TYPES.has(rawType)) {
    return "system";
  }

  if (rawType === "error") {
    return "error";
  }

  if (rawType === "user") {
    return "user";
  }

  return "system";
};

const extractAssistantText = (payload: RawNdjsonPayload): string | null =>
  asString(payload.message) ??
  asString(payload.text) ??
  asString(payload.delta);

const normalizeCodexPayload = (payload: RawNdjsonPayload): AgentMessage => {
  const type = normalizeCodexType(payload);
  const rawType = asString(payload.type);

  const content =
    type === "assistant"
      ? [
          {
            kind: "text" as const,
            payload: {
              text: extractAssistantText(payload),
              payload,
            },
          },
        ]
      : type === "tool"
      ? [
          {
            kind: "tool" as const,
            payload: payload.tool ?? payload,
          },
        ]
      : type === "result"
      ? [
          {
            kind: "result" as const,
            payload: payload.result ?? payload,
          },
        ]
      : type === "error"
      ? [
          {
            kind: "error" as const,
            payload: payload.error ?? payload,
          },
        ]
      : [
          {
            kind: "text" as const,
            payload: {
              text: extractAssistantText(payload),
              payload,
            },
          },
        ];

  return {
    type,
    subtype: rawType ?? undefined,
    sessionId: extractSessionId(payload),
    content,
    timestamp: Date.now(),
    raw: payload,
  };
};

export class CodexDecoder extends NdjsonAgentDecoder {
  constructor() {
    super({
      normalizePayload: normalizeCodexPayload,
    });
  }
}
