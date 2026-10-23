import { describe, expect, it } from "vitest";
import type { MessageResponseDto, OpenItemsTriagePayload } from "../../api";
import {
  latestOpenItemsTriageResult,
  openItemsTriageReviewStartedAt,
} from "./openItemsTriageResult";

const payload = (summary: string): OpenItemsTriagePayload => ({
  summary,
  suggestions: [],
});

function reply(
  id: string,
  parentMessageId: string | undefined,
  summary: string,
): MessageResponseDto {
  return {
    id,
    type: "SYSTEM",
    status: "COMPLETED",
    conversationId: "conversation",
    createdAt: "2026-10-14T08:00:00Z",
    awaitingResponse: false,
    ...(parentMessageId ? { parentMessageId } : {}),
    data: {
      type: "QUESTIONS",
      uiElements: [
        { id: "triage", type: "open_items_triage", payload: payload(summary) },
      ],
    },
  } as MessageResponseDto;
}

function request(
  id: string,
  createdAt = "2026-10-14T08:00:00Z",
): MessageResponseDto {
  return {
    id,
    type: "USER",
    status: "COMPLETED",
    conversationId: "conversation",
    createdAt,
    awaitingResponse: false,
    data: {},
  } as MessageResponseDto;
}

function startTrigger(id: string, sourceUserMessageId: string) {
  return {
    id,
    type: "SYSTEM",
    status: "COMPLETED",
    conversationId: "conversation",
    createdAt: "2026-10-14T08:00:00Z",
    awaitingResponse: false,
    data: {
      type: "TRIGGER",
      triggersAgent: {
        promptType: "start_run",
        operationId: "operation",
        operationFingerprint: "fingerprint",
        triggerMessageId: id,
        sourceUserMessageId,
        payload: {},
      },
    },
  } as unknown as MessageResponseDto;
}

const summaryOf = (
  messages: readonly MessageResponseDto[],
  requestMessageIds?: readonly string[],
) => latestOpenItemsTriageResult(messages, requestMessageIds)?.payload.summary;

describe("latestOpenItemsTriageResult review correlation", () => {
  const history = [request("old-request"), reply("old", "old-request", "Old")];

  it("keeps the canonical route's latest-reply behaviour without a review", () => {
    expect(summaryOf(history)).toBe("Old");
  });

  it("ignores older persisted replies in a reused conversation", () => {
    expect(
      summaryOf([...history, request("fresh")], ["fresh"]),
    ).toBeUndefined();
    expect(
      summaryOf(
        [...history, request("fresh"), reply("new", "fresh", "New")],
        ["fresh"],
      ),
    ).toBe("New");
  });

  it("ignores late output answering a discarded review's request", () => {
    expect(
      summaryOf(
        [...history, request("fresh"), reply("late", "old-request", "Late")],
        ["fresh"],
      ),
    ).toBeUndefined();
  });

  it("correlates a launching send through its start-run trigger's USER row", () => {
    const messages = [
      request("kickoff"),
      startTrigger("trigger", "kickoff"),
      reply("first", "kickoff", "First"),
    ];
    expect(summaryOf(messages, ["trigger"])).toBe("First");
    expect(
      summaryOf(
        [
          startTrigger("trigger", "kickoff"),
          reply("direct", "trigger", "Direct"),
        ],
        ["trigger"],
      ),
    ).toBe("Direct");
  });

  it("includes follow-up replies within the open review", () => {
    expect(
      summaryOf(
        [
          request("fresh"),
          reply("first", "fresh", "First"),
          request("follow"),
          reply("second", "follow", "Second"),
        ],
        ["fresh", "follow"],
      ),
    ).toBe("Second");
  });

  it("replaces the correlation set on Run Again", () => {
    const messages = [
      request("fresh"),
      reply("first", "fresh", "First"),
      request("again"),
    ];
    expect(summaryOf(messages, ["again"])).toBeUndefined();
    expect(
      summaryOf([...messages, reply("rerun", "again", "Rerun")], ["again"]),
    ).toBe("Rerun");
  });
});

describe("openItemsTriageReviewStartedAt", () => {
  it("is null until the review's request is in the conversation", () => {
    expect(
      openItemsTriageReviewStartedAt([request("old")], ["fresh"]),
    ).toBeNull();
  });

  it("ignores older requests in a reused conversation", () => {
    expect(
      openItemsTriageReviewStartedAt(
        [
          request("old", "2026-10-14T07:00:00Z"),
          request("fresh", "2026-10-14T09:00:00Z"),
        ],
        ["fresh"],
      ),
    ).toBe("2026-10-14T09:00:00Z");
  });

  it("uses the earliest of the trigger and its source user message", () => {
    const trigger = {
      ...startTrigger("trigger", "source"),
      createdAt: "2026-10-14T09:00:05Z",
    } as MessageResponseDto;
    expect(
      openItemsTriageReviewStartedAt(
        [request("source", "2026-10-14T09:00:00Z"), trigger],
        ["trigger"],
      ),
    ).toBe("2026-10-14T09:00:00Z");
  });
});
