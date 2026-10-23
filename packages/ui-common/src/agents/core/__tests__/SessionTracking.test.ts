import { describe, expect, it, vi } from "vitest";
import type { AgentSessionStore } from "../AgentSessionStore";
import { trackSessionFromMessageStream } from "../SessionTracking";
import type { AgentMessage, AgentSessionId } from "../types";
import { toAgentSessionId } from "../types";

const collectMessages = async (
  stream: AsyncIterable<AgentMessage>
): Promise<AgentMessage[]> => {
  const messages: AgentMessage[] = [];
  for await (const message of stream) {
    messages.push(message);
  }
  return messages;
};

const toMessageStream = (
  messages: AgentMessage[]
): AsyncIterable<AgentMessage> =>
  (async function* () {
    for (const message of messages) {
      yield message;
    }
  })();

const createMessage = (
  sessionId: AgentSessionId | null,
  type: AgentMessage["type"],
  subtype?: string
): AgentMessage => ({
  type,
  subtype,
  sessionId,
  content: [{ kind: "text", payload: "ok" }],
  timestamp: Date.now(),
});

describe("trackSessionFromMessageStream", () => {
  it("persists session metadata when a session id appears", async () => {
    const sessionId = toAgentSessionId("sess-1");
    const persist = vi.fn<AgentSessionStore["persist"]>().mockResolvedValue();
    const store: AgentSessionStore = {
      persist,
      retrieve: vi.fn().mockResolvedValue(null),
    };

    const wrapped = trackSessionFromMessageStream({
      stream: toMessageStream([
        createMessage(null, "assistant"),
        createMessage(sessionId, "system", "init"),
        createMessage(sessionId, "assistant"),
      ]),
      adapter: "claude",
      mode: "run",
      sessionStore: store,
    });

    const messages = await collectMessages(wrapped);

    expect(messages).toHaveLength(3);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({
        adapter: "claude",
      })
    );
  });

  it("does not persist metadata when no session id is present", async () => {
    const persist = vi.fn<AgentSessionStore["persist"]>().mockResolvedValue();
    const store: AgentSessionStore = {
      persist,
      retrieve: vi.fn().mockResolvedValue(null),
    };

    const wrapped = trackSessionFromMessageStream({
      stream: toMessageStream([
        createMessage(null, "assistant"),
        createMessage(null, "result"),
      ]),
      adapter: "codex",
      mode: "run",
      sessionStore: store,
    });

    const messages = await collectMessages(wrapped);

    expect(messages).toHaveLength(2);
    expect(persist).not.toHaveBeenCalled();
  });

  it("emits normalized errors when session persistence fails", async () => {
    const sessionId = toAgentSessionId("sess-2");
    const persist = vi
      .fn<AgentSessionStore["persist"]>()
      .mockRejectedValue(new Error("storage unavailable"));
    const store: AgentSessionStore = {
      persist,
      retrieve: vi.fn().mockResolvedValue(null),
    };

    const wrapped = trackSessionFromMessageStream({
      stream: toMessageStream([createMessage(sessionId, "system", "init")]),
      adapter: "claude",
      mode: "resume",
      resumedFromSessionId: sessionId,
      sessionStore: store,
    });

    const messages = await collectMessages(wrapped);

    expect(messages).toHaveLength(2);
    expect(messages[1]?.type).toBe("error");
    expect(messages[1]?.subtype).toBe("session_persist_error");
    expect(messages[1]?.sessionId).toBe(sessionId);
  });

  it("uses fallback session id when system/init is absent", async () => {
    const sessionId = toAgentSessionId("sess-fallback");
    const persist = vi.fn<AgentSessionStore["persist"]>().mockResolvedValue();
    const store: AgentSessionStore = {
      persist,
      retrieve: vi.fn().mockResolvedValue(null),
    };

    const wrapped = trackSessionFromMessageStream({
      stream: toMessageStream([
        createMessage(sessionId, "assistant"),
        createMessage(sessionId, "result"),
      ]),
      adapter: "codex",
      mode: "run",
      sessionStore: store,
    });

    await collectMessages(wrapped);

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(
      sessionId,
      expect.objectContaining({ adapter: "codex" })
    );
  });

  it("prioritizes system/init session id over earlier fallback candidates", async () => {
    const fallbackSessionId = toAgentSessionId("sess-fallback");
    const initSessionId = toAgentSessionId("sess-init");
    const persist = vi.fn<AgentSessionStore["persist"]>().mockResolvedValue();
    const store: AgentSessionStore = {
      persist,
      retrieve: vi.fn().mockResolvedValue(null),
    };

    const wrapped = trackSessionFromMessageStream({
      stream: toMessageStream([
        createMessage(fallbackSessionId, "assistant"),
        createMessage(initSessionId, "system", "init"),
      ]),
      adapter: "claude",
      mode: "run",
      sessionStore: store,
    });

    await collectMessages(wrapped);

    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith(
      initSessionId,
      expect.objectContaining({ adapter: "claude" })
    );
    expect(persist).not.toHaveBeenCalledWith(
      fallbackSessionId,
      expect.anything()
    );
  });
});
