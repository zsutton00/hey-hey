import { describe, expect, it } from "vitest";
import type {
  MessageResponseDto,
  QuestionsSystemMessageData,
  UIElement,
} from "../../../api";
import { SecondaryActionHandler } from "../../../api";
import type { ConversationMessage } from "../../../types/conversation";
import {
  applyVisualPreviewPresentationState,
  resolveCurrentVisualPreviewProposalIds,
} from "./visualPreviewPresentation";

const preview = (proposalIds: string[]): UIElement => ({
  id: "visuals",
  type: "plan_generation_visual_preview",
  label: "Visuals",
  payload: {
    responseType: "plan_generation_visual_preview_v1",
    entries: proposalIds.map((proposalId, presentationOrder) => ({
      proposalId,
      artifactFamily: "mockup",
      presentationOrder,
    })),
  },
});

const system = (
  id: string,
  uiElements: UIElement[],
  responses: MessageResponseDto[] = [],
  secondaryActions?: QuestionsSystemMessageData["secondaryActions"]
): MessageResponseDto => ({
  id,
  type: "SYSTEM",
  status: "completed",
  conversationId: "conversation",
  projectId: "project",
  createdAt: "2026-01-01T00:00:00Z",
  awaitingResponse: true,
  responses,
  data: {
    type: "QUESTIONS",
    response: "",
    uiElements,
    detectedIntent: "",
    intentConfidence: 1,
    secondaryActions,
  },
});

const answeredFeedback = (
  id: string,
  responses: MessageResponseDto[]
): MessageResponseDto =>
  system(
    id,
    [{ id: "feedback", type: "textarea", label: "Feedback" }],
    [
      {
        id: `${id}-answer`,
        type: "USER",
        status: "completed",
        conversationId: "conversation",
        projectId: "project",
        createdAt: "2026-01-01T00:00:00Z",
        parentMessageId: id,
        data: { action: "REFINE", payload: { feedback: "Revise" } },
        responses,
      },
    ],
    [
      {
        id: "refine",
        type: "field_action",
        handler:
          SecondaryActionHandler.PlanGenerationVisualPreviewContinueRevising,
        label: "Continue Revising",
        fieldId: "feedback",
      },
    ]
  );

const flatten = (message: MessageResponseDto): ConversationMessage[] => [
  ...(message.type === "SYSTEM"
    ? [{ message, state: "completed" as const, canEdit: true }]
    : []),
  ...(message.responses ?? []).flatMap(flatten),
];

const presentedTimeline = (
  messages: MessageResponseDto[]
): ConversationMessage[] =>
  applyVisualPreviewPresentationState(messages.flatMap(flatten), messages);

describe("resolveCurrentVisualPreviewProposalIds", () => {
  it("keeps a replacement feedback gate current after a submitted review, including on reload", () => {
    const retry = system(
      "retry",
      [preview(["current-a", "current-b"])],
      [],
      [
        {
          id: "approve",
          type: "field_action",
          label: "Approve Visual Set",
          handler: SecondaryActionHandler.PlanGenerationVisualPreviewApprove,
          fieldId: "feedback",
        },
      ]
    );
    const completion: MessageResponseDto = {
      ...system("completion", [], [answeredFeedback("failed-review", [retry])]),
      data: {
        type: "AGENT",
        response: "",
        completesExternalAgentNode: {
          completesTriggerMessageId: "trigger",
          nodeId: "plan-shaping-visual-preview",
        },
      },
    };
    const original = {
      ...system("original", [preview(["current-a", "current-b"])]),
      parentMessageId: "trigger",
    };
    const older = system("older", [preview(["old-only"])]);
    older.responses = [answeredFeedback("revision", [original])];
    // External completion and preview may be separate roots in persisted history.
    const messages = [older, completion];
    const timeline = presentedTimeline(structuredClone(messages));
    expect(
      timeline
        .filter(
          ({ canEdit, message }) =>
            canEdit &&
            message.data.uiElements?.some(
              ({ type }) => type === "plan_generation_visual_preview"
            )
        )
        .map(({ message }) => message.id)
    ).toEqual(["retry"]);
    expect(resolveCurrentVisualPreviewProposalIds(timeline)).toEqual([
      "current-a",
      "current-b",
    ]);
    retry.responses = answeredFeedback("submitted-retry", []).responses;
    expect(
      resolveCurrentVisualPreviewProposalIds(presentedTimeline(messages))
    ).toBeUndefined();
  });

  it("returns the proposal IDs of the single current preview", () => {
    const messages = [system("preview", [preview(["a", "b"])])];

    expect(
      resolveCurrentVisualPreviewProposalIds(presentedTimeline(messages))
    ).toEqual(["a", "b"]);
  });

  it("returns only the current round when a historical preview precedes it", () => {
    const messages = [
      system(
        "old-preview",
        [preview(["a", "old-only"])],
        [
          answeredFeedback("old-feedback", [
            system("current-preview", [preview(["a", "new"])]),
          ]),
        ]
      ),
    ];

    expect(
      resolveCurrentVisualPreviewProposalIds(presentedTimeline(messages))
    ).toEqual(["a", "new"]);
  });

  it("returns undefined when no current preview is presented", () => {
    const messages = [
      system("question", [{ id: "q", type: "textarea", label: "Q" }]),
    ];

    expect(
      resolveCurrentVisualPreviewProposalIds(presentedTimeline(messages))
    ).toBeUndefined();
  });
});
