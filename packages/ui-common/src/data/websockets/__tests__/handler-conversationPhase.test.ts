import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { ConversationPhase } from "../../../api";
import { WebSocketHandler } from "../handler";
import { conversationPhaseByIdAtom } from "../conversationPhase";

describe("WebSocketHandler conversation phases", () => {
  it("caches the latest phase observation for room joins and live events", () => {
    const store = createStore();
    const handler = new WebSocketHandler(store);

    handler.handleEvent({
      type: "conversation.phase_changed",
      timestamp: "2026-08-07T00:00:05.000Z",
      organizationId: "org-1",
      projectId: "project-1",
      conversationId: "conversation-1",
      phase: ConversationPhase.Reviewing,
      revision: 5,
      transitionedAt: "2026-08-07T00:00:05.000Z",
    });

    expect(store.get(conversationPhaseByIdAtom)).toEqual({
      "conversation-1": {
        phase: ConversationPhase.Reviewing,
        revision: 5,
        transitionedAt: "2026-08-07T00:00:05.000Z",
      },
    });
  });
});
