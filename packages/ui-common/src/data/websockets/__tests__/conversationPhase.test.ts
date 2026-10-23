import { describe, expect, it } from "vitest";
import { ConversationPhase } from "../../../api";
import {
  applyConversationPhaseEntries,
  removeConversationPhases,
  setConversationPhaseIfNewer,
  type ConversationPhaseMap,
} from "../conversationPhase";

const initialState: ConversationPhaseMap = {
  "conversation-1": {
    phase: ConversationPhase.Thinking,
    revision: 3,
    transitionedAt: "2026-08-07T00:00:03.000Z",
  },
};

describe("conversation phase projection", () => {
  it("inserts and replaces observations by revision", () => {
    expect(
      setConversationPhaseIfNewer(initialState, "conversation-2", {
        phase: ConversationPhase.Reviewing,
        revision: 1,
        transitionedAt: "2026-08-07T00:00:01.000Z",
      }),
    ).toEqual({
      ...initialState,
      "conversation-2": {
        phase: ConversationPhase.Reviewing,
        revision: 1,
        transitionedAt: "2026-08-07T00:00:01.000Z",
      },
    });

    const older = setConversationPhaseIfNewer(initialState, "conversation-1", {
      phase: ConversationPhase.Idle,
      revision: 2,
      transitionedAt: "2026-08-07T00:00:02.000Z",
    });
    const equal = setConversationPhaseIfNewer(initialState, "conversation-1", {
      phase: ConversationPhase.Reviewing,
      revision: 3,
      transitionedAt: "2026-08-07T00:00:03.500Z",
    });
    const newer = setConversationPhaseIfNewer(initialState, "conversation-1", {
      phase: ConversationPhase.Idle,
      revision: 4,
      transitionedAt: "2026-08-07T00:00:04.000Z",
    });

    expect(older).toBe(initialState);
    expect(equal).toBe(initialState);
    expect(newer["conversation-1"]?.phase).toBe(ConversationPhase.Idle);
  });

  it("applies websocket events and removes departed conversations", () => {
    const next = applyConversationPhaseEntries(initialState, [
      {
        type: "conversation.phase_changed",
        timestamp: "2026-08-07T00:00:05.000Z",
        organizationId: "org-1",
        projectId: "project-1",
        conversationId: "conversation-1",
        phase: ConversationPhase.Reviewing,
        revision: 5,
        transitionedAt: "2026-08-07T00:00:05.000Z",
      },
    ]);

    expect(next["conversation-1"]?.phase).toBe(ConversationPhase.Reviewing);
    expect(
      removeConversationPhases(next, new Set(["conversation-1"])),
    ).toEqual({});
  });
});
