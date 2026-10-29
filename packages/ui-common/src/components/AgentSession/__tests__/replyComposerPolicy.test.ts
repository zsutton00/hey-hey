import {
  MessageType,
  MessageStatus,
  ConversationStatus,
  AgentSessionCurrentState,
  ExtendedUIFieldType,
  SecondaryActionConfigPresentationEnum,
  type MessageResponseDto,
} from "../../../api";
import {
  resolveConversationResponseModel,
  deriveConversationModel,
} from "../../Conversation/utils/conversationResponseModel";
import type { ConversationMessage } from "../../../types/conversation";
import { describe, expect, it } from "vitest";
import { resolveReplyComposerState } from "../replyComposerPolicy";
import type {
  CanonicalMessageId,
  ConversationResponseTarget,
} from "../../Conversation/Components/conversationFormTypes";

const target = (
  ownership: "exclusive" | "contribution",
  usable: boolean,
): ConversationResponseTarget => ({
  ownership,
  messageId: "canonical" as CanonicalMessageId,
  currentFieldId: "answer",
  submissionKind: "field",
  usable,
});
const base = {
  target: { ownership: "none" } as ConversationResponseTarget,
  targetSettled: true,
  hideComposer: false,
  readOnly: false,
  canSubmit: true,
  submitting: false,
};

describe("reply composer policy", () => {
  it.each([
    [
      "hides for a usable exclusive response",
      target("exclusive", true),
      true,
      true,
    ],
    [
      "shows when the exclusive response is disabled",
      target("exclusive", false),
      true,
      false,
    ],
    [
      "shows with no response target",
      { ownership: "none" } as ConversationResponseTarget,
      true,
      false,
    ],
    [
      "shows alongside a contribution",
      target("contribution", true),
      true,
      false,
    ],
    [
      "hides until the target settles",
      { ownership: "none" } as ConversationResponseTarget,
      false,
      true,
    ],
  ])("%s", (_, current, targetSettled, hidden) => {
    expect(
      resolveReplyComposerState({
        ...base,
        target: current,
        targetSettled,
      }),
    ).toEqual({ hidden, availability: { available: true } });
  });

  it.each([
    [
      { canSubmit: false },
      {
        hidden: false,
        availability: { available: false, reason: "unavailable" },
      },
    ],
    [
      { submitting: true },
      {
        hidden: false,
        availability: { available: false, reason: "submitting" },
      },
    ],
    [
      { readOnly: true },
      { hidden: true, availability: { available: false, reason: "read-only" } },
    ],
    [
      { hideComposer: true },
      { hidden: true, availability: { available: true } },
    ],
  ] as const)(
    "preserves access and pending constraints %j",
    (override, expected) => {
      expect(resolveReplyComposerState({ ...base, ...override })).toEqual(
        expected,
      );
    },
  );
});

const question: MessageResponseDto = {
  id: "question",
  projectId: "project",
  conversationId: "conversation",
  createdAt: "2026-10-29T00:00:00Z",
  type: MessageType.System,
  status: MessageStatus.Open,
  awaitingResponse: true,
  data: {
    type: "QUESTIONS",
    uiElements: [
      { id: "reply", type: ExtendedUIFieldType.Textarea, label: "Reply" },
    ],
  },
};
const entry = (message: MessageResponseDto): ConversationMessage => ({
  message,
  state: "awaiting_response",
  canEdit: true,
});
const formOptions = {
  workflowCanSubmit: true,
  isSubmitting: false,
  readOnly: false,
  isCliInputDisabled: false,
};

describe("canonical conversation interaction", () => {
  it.each([
    ["live", {}, true],
    ["locked", { isSubmitting: true }, false],
    ["read-only", { readOnly: true }, false],
    ["owner unavailable", { workflowCanSubmit: false }, false],
    ["device unavailable", { isCliInputDisabled: true }, false],
  ])(
    "derives %s controls and composer from the same facts",
    (_, override, live) => {
      const model = resolveConversationResponseModel(
        [entry(question)],
        [question],
        { ...formOptions, ...override, orderedMessages: [question] },
      );
      expect(
        resolveReplyComposerState({ ...base, target: model.target }).hidden,
      ).toBe(live);
      expect(model.current?.form.isFormReadOnly).toBe(!live);
      expect(model.current?.form.uiElements).toEqual(question.data.uiElements);
    },
  );

  it.each(["plain", "hidden", "answered", "stale"])(
    "does not let %s content suppress the fallback",
    (kind) => {
      const hidden: MessageResponseDto = {
        ...question,
        id: "hidden",
        data: {
          type: "QUESTIONS",
          uiElements: [
            {
              id: "hidden",
              type: ExtendedUIFieldType.AgentHidden,
              label: "Hidden",
            },
          ],
        },
      };
      const plain: MessageResponseDto = {
        ...question,
        id: "plain",
        data: {
          type: "QUESTIONS",
          response: "1. What should the imported feature deliver?",
          uiElements: [],
        },
      };
      const answer: MessageResponseDto = {
        ...question,
        id: "answer",
        type: MessageType.User,
        data: { comment: "My answer" },
        parentMessageId: question.id,
      };
      const canonical =
        kind === "hidden"
          ? [question, hidden]
          : kind === "answered"
            ? [{ ...question, responses: [answer] }, answer]
            : [question, plain];
      const timeline =
        kind === "stale" || kind === "hidden"
          ? [entry(question)]
          : canonical.map(entry);
      const model = resolveConversationResponseModel(timeline, canonical, {
        ...formOptions,
        orderedMessages: canonical,
      });
      expect(model.target.ownership).toBe("none");
    },
  );

  it.each([false, true])(
    "counts button-only responses according to disabled=%s",
    (disabled) => {
      const message: MessageResponseDto = {
        ...question,
        data: { type: "QUESTIONS", uiElements: [] },
      };
      const model = resolveConversationResponseModel(
        [entry(message)],
        [message],
        {
          ...formOptions,
          resolver: () => ({
            uiElements: [],
            responseDeclarations: [],
            disabled: false,
            isSubmitted: false,
            submit: async () => {},
          }),
          resolveActions: () => [
            {
              type: "custom",
              label: "Continue",
              testId: "continue",
              submitsForm: true,
              disabled,
              presentation: SecondaryActionConfigPresentationEnum.Button,
              onExecute: () => {},
            },
          ],
        },
      );
      expect(
        resolveReplyComposerState({ ...base, target: model.target }).hidden,
      ).toBe(!disabled);
    },
  );

  it("keeps execution activity independent of input permission and completed workflow lifecycle", () => {
    const response = resolveConversationResponseModel([], [], formOptions);
    const model = deriveConversationModel({
      response,
      conversation: {
        id: "conversation",
        projectId: "project",
        organizationId: "organization",
        workflowId: "workflow",
        status: ConversationStatus.Completed,
        version: 1,
        createdAt: "2026-10-29T00:00:00Z",
        updatedAt: "2026-10-29T00:00:00Z",
      },
      messages: [],
      settled: true,
      error: null,
      currentState: AgentSessionCurrentState.Thinking,
      forceProcessing: false,
      readOnly: false,
      canSubmit: true,
      submission: "idle",
    });
    expect(model.activity.processing).toBe(true);
    expect(model.permission.canSubmit).toBe(true);
    expect(model.owner.workflowId).toBe("workflow");
  });
});
