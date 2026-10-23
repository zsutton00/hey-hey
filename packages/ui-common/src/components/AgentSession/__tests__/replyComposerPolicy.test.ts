import { describe, expect, it } from "vitest";
import { resolveReplyComposerState } from "../replyComposerPolicy";
import type {
  CanonicalMessageId,
  ConversationResponseTarget,
} from "../../Conversation/Components/conversationFormTypes";

const target = (
  ownership: "exclusive" | "contribution",
  usable: boolean
): ConversationResponseTarget => ({
  ownership,
  messageId: "canonical" as CanonicalMessageId,
  currentFieldId: "answer",
  submissionKind: "field",
  usable,
});
const base = {
  policy: "always" as const,
  target: { ownership: "none" } as ConversationResponseTarget,
  targetSettled: true,
  hideComposer: false,
  readOnly: false,
  canSubmit: true,
  submitting: false,
};
const enabled = { hidden: false, availability: { available: true } };

describe("reply composer policy", () => {
  it.each([
    ["none", { ownership: "none" } as ConversationResponseTarget],
    ["usable exclusive", target("exclusive", true)],
    ["unusable exclusive", target("exclusive", false)],
    ["contribution", target("contribution", true)],
  ])("always offers the composer with a %s target", (_, current) => {
    expect(resolveReplyComposerState({ ...base, target: current })).toEqual(
      enabled
    );
  });

  it("does not wait for the response target by default", () => {
    expect(
      resolveReplyComposerState({
        ...base,
        target: target("exclusive", true),
        targetSettled: false,
      })
    ).toEqual(enabled);
  });

  it.each([
    ["hides for a usable exclusive response", target("exclusive", true), true, true],
    ["shows when the exclusive response is disabled", target("exclusive", false), true, false],
    ["shows with no response target", { ownership: "none" } as ConversationResponseTarget, true, false],
    ["shows alongside a contribution", target("contribution", true), true, false],
    ["hides until the target settles", { ownership: "none" } as ConversationResponseTarget, false, true],
  ])("plan generation %s", (_, current, targetSettled, hidden) => {
    expect(
      resolveReplyComposerState({
        ...base,
        policy: "when-no-usable-response",
        target: current,
        targetSettled,
      })
    ).toEqual({ hidden, availability: { available: true } });
  });

  it.each([
    [{ canSubmit: false }, { hidden: false, availability: { available: false, reason: "unavailable" } }],
    [{ submitting: true }, { hidden: false, availability: { available: false, reason: "submitting" } }],
    [{ readOnly: true }, { hidden: true, availability: { available: false, reason: "read-only" } }],
    [{ hideComposer: true }, { hidden: true, availability: { available: true } }],
  ] as const)("preserves access and pending constraints %j", (override, expected) => {
    for (const policy of ["always", "when-no-usable-response"] as const) {
      expect(
        resolveReplyComposerState({ ...base, ...override, policy })
      ).toEqual(expected);
    }
  });
});
