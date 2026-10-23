import {
  NdjsonAgentDecoder,
  type RawNdjsonPayload,
  toAgentSessionId,
  type AgentMessage,
  type AgentMessageType,
  type AgentSessionId,
} from "../core";

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const extractSessionId = (payload: RawNdjsonPayload): AgentSessionId | null => {
  const message = asRecord(payload.message);
  const sessionIdValue =
    asString(payload.session_id) ??
    asString(payload.sessionId) ??
    asString(message?.session_id) ??
    asString(message?.sessionId);

  return sessionIdValue ? toAgentSessionId(sessionIdValue) : null;
};

const extractContentBlocks = (
  payload: RawNdjsonPayload
): Record<string, unknown>[] => {
  const message = asRecord(payload.message);
  const content = message?.content;

  if (!Array.isArray(content)) {
    return [];
  }

  return content
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => item !== null);
};

const extractText = (payload: RawNdjsonPayload): string | null => {
  const directText = asString(payload.text);
  if (directText) {
    return directText;
  }

  const message = asRecord(payload.message);
  if (message) {
    const messageContent = message.content;
    if (typeof messageContent === "string" && messageContent.length > 0) {
      return messageContent;
    }

    if (Array.isArray(messageContent)) {
      const textParts = messageContent
        .map((item) => asRecord(item))
        .filter((item): item is Record<string, unknown> => item !== null)
        .filter((item) => asString(item.type) === "text")
        .map((item) => asString(item.text))
        .filter((part): part is string => part !== null);

      if (textParts.length > 0) {
        return textParts.join("");
      }
    }
  }

  return null;
};

const hasBlockType = (
  blocks: Record<string, unknown>[],
  blockType: string
): boolean => blocks.some((block) => asString(block.type) === blockType);

const normalizeClaudeType = (
  payload: RawNdjsonPayload,
  blocks: Record<string, unknown>[]
): AgentMessageType => {
  const rawType = asString(payload.type);

  if (rawType === "assistant" && hasBlockType(blocks, "tool_use")) {
    return "tool";
  }

  if (rawType === "assistant") {
    return "assistant";
  }

  if (rawType === "user" && hasBlockType(blocks, "tool_result")) {
    return "tool";
  }

  if (rawType === "user") {
    return "user";
  }

  if (rawType === "result") {
    return "result";
  }

  if (rawType === "error") {
    return "error";
  }

  return "system";
};

const normalizeClaudeSubtype = (
  payload: RawNdjsonPayload,
  type: AgentMessageType,
  blocks: Record<string, unknown>[]
): string | undefined => {
  const directSubtype = asString(payload.subtype);
  if (directSubtype) {
    return directSubtype;
  }

  if (type === "tool" && hasBlockType(blocks, "tool_use")) {
    return "tool_use";
  }

  if (type === "tool" && hasBlockType(blocks, "tool_result")) {
    return "tool_result";
  }

  const rawType = asString(payload.type);
  if (rawType && rawType !== type) {
    return rawType;
  }

  return undefined;
};

const normalizeClaudePayload = (payload: RawNdjsonPayload): AgentMessage => {
  const blocks = extractContentBlocks(payload);
  const type = normalizeClaudeType(payload, blocks);
  const text = extractText(payload);

  const content =
    type === "assistant"
      ? [
          {
            kind: "text" as const,
            payload: {
              text,
              blocks,
            },
          },
        ]
      : type === "tool"
      ? [
          {
            kind: "tool" as const,
            payload: blocks.length > 0 ? blocks : payload,
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
              text,
              message: payload.message,
              payload,
            },
          },
        ];

  return {
    type,
    subtype: normalizeClaudeSubtype(payload, type, blocks),
    sessionId: extractSessionId(payload),
    content,
    timestamp: Date.now(),
    raw: payload,
  };
};

export class ClaudeCodeDecoder extends NdjsonAgentDecoder {
  constructor() {
    super({
      normalizePayload: normalizeClaudePayload,
    });
  }
}
