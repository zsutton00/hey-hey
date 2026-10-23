import type { MessageResponseDto } from "../api";

interface FlatMessage {
  id: string;
  type: string;
  depth: number;
  parentMessageId: string | undefined;
  dataType: string | undefined;
  status: string;
  createdAt: string;
  raw: MessageResponseDto;
}

function unrollMessages(
  messages: readonly MessageResponseDto[]
): FlatMessage[] {
  const result: FlatMessage[] = [];

  const walk = (msg: MessageResponseDto, depth: number) => {
    result.push({
      id: msg.id,
      type: msg.type,
      depth,
      parentMessageId: msg.parentMessageId,
      dataType: msg.data?.type,
      status: msg.status,
      createdAt: msg.createdAt,
      raw: msg,
    });

    if (msg.responses) {
      for (const child of msg.responses) {
        walk(child, depth + 1);
      }
    }
  };

  for (const msg of messages) {
    walk(msg, 0);
  }

  return result;
}

if (process.env.NODE_ENV === "development") {
  (window as unknown as Record<string, unknown>).__unroll_messages =
    unrollMessages;
}

export { unrollMessages };
