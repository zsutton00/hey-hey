import { describe, expect, it } from "vitest";
import type { WebSocketMessageRealtimeEvent } from "../../../api";
import {
  applyRealtimeEvent,
  clearConversationRealtimePatches,
  clearMessageRealtimePatches,
} from "../messageRealtimeState";

function createRealtimeEvent(
  overrides: Partial<WebSocketMessageRealtimeEvent> = {}
): WebSocketMessageRealtimeEvent {
  return {
    type: "message.realtime",
    timestamp: new Date().toISOString(),
    organizationId: "org-1",
    projectId: "proj-1",
    conversationId: "conv-1",
    messageId: "msg-1",
    requestId: "req-1",
    sequence: 1,
    kind: "response.delta",
    source: "api",
    payload: {
      responseDelta: "Hello",
    },
    ...overrides,
  };
}

describe("messageRealtimeState", () => {
  it("applies response deltas in sequence and ignores stale duplicates", () => {
    const first = applyRealtimeEvent({}, createRealtimeEvent());
    expect(first.applied).toBe(true);
    expect(
      first.nextState["conv-1"]?.patchesByMessageId["msg-1"]?.response
    ).toBe("Hello");

    const duplicate = applyRealtimeEvent(
      first.nextState,
      createRealtimeEvent({
        sequence: 1,
        payload: { responseDelta: "Ignored" },
      })
    );
    expect(duplicate.applied).toBe(false);
    expect(duplicate.duplicateOrStale).toBe(true);

    const second = applyRealtimeEvent(
      first.nextState,
      createRealtimeEvent({ sequence: 2, payload: { responseDelta: " world" } })
    );
    expect(second.applied).toBe(true);
    expect(
      second.nextState["conv-1"]?.patchesByMessageId["msg-1"]?.response
    ).toBe("Hello world");
  });

  it("detects sequence gaps and requests a single refetch", () => {
    const first = applyRealtimeEvent({}, createRealtimeEvent({ sequence: 1 }));
    const gap = applyRealtimeEvent(
      first.nextState,
      createRealtimeEvent({ sequence: 4, payload: { responseDelta: " gap" } })
    );
    expect(gap.sequenceGapDetected).toBe(true);
    expect(gap.shouldRefetchConversation).toBe(true);

    const secondGap = applyRealtimeEvent(
      gap.nextState,
      createRealtimeEvent({ sequence: 6, payload: { responseDelta: " again" } })
    );
    expect(secondGap.sequenceGapDetected).toBe(true);
    expect(secondGap.shouldRefetchConversation).toBe(false);
  });

  it("supports response.replace and clearing helpers", () => {
    const first = applyRealtimeEvent({}, createRealtimeEvent({ sequence: 1 }));
    const replaced = applyRealtimeEvent(
      first.nextState,
      createRealtimeEvent({
        sequence: 2,
        kind: "response.replace",
        payload: { response: "Replaced" },
      })
    );
    expect(
      replaced.nextState["conv-1"]?.patchesByMessageId["msg-1"]?.response
    ).toBe("Replaced");

    const clearedMessage = clearMessageRealtimePatches(
      replaced.nextState,
      "conv-1",
      ["msg-1"]
    );
    expect(clearedMessage["conv-1"]).toBeUndefined();

    const withPatchAgain = applyRealtimeEvent(
      {},
      createRealtimeEvent({ sequence: 1 })
    );
    const clearedConversation = clearConversationRealtimePatches(
      withPatchAgain.nextState,
      "conv-1"
    );
    expect(clearedConversation["conv-1"]).toBeUndefined();
  });
});
