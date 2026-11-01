import { latestCodingPlanVersionMessageId } from "./codingPlanConversation";
import { describe, expect, it, vi } from "vitest";
import {
  MessageStatus,
  MessageType,
  ReportAudience,
  ReportType,
  type MessageResponseDto,
  type ReportDto,
} from "../../../api";
import type { ConversationMessage } from "../../../types/conversation";
import type {
  ConversationFormResolver,
  ConversationResponseDeclaration,
} from "../Components/conversationFormTypes";
import { resolveConversationResponseModel } from "./conversationResponseModel";

const options = {
  workflowCanSubmit: true,
  isSubmitting: false,
  readOnly: false,
  isCliInputDisabled: false,
};
const message = (id = "message", field = "textarea"): MessageResponseDto => ({
  id,
  projectId: "project",
  conversationId: "conversation",
  createdAt: "2026-09-28T00:00:00Z",
  type: MessageType.System,
  status: MessageStatus.Open,
  awaitingResponse: true,
  responses: [],
  data: { type: "QUESTIONS", uiElements: [{ id: "answer", type: field }] },
});
const entry = (value: MessageResponseDto): ConversationMessage => ({
  message: value,
  state: "awaiting_response",
  canEdit: true,
});
const report: ReportDto = {
  id: "report",
  reportType: ReportType.Plan,
  audience: ReportAudience.ProjectVisible,
  createdAt: "2026-09-28T00:00:00Z",
  organizationId: "organization",
  projectId: "project",
  title: "Plan",
  version: 1,
  schemaVersion: 1,
  entities: [],
  expiresAt: "2027-09-28T00:00:00Z",
  payload: {
    reportType: ReportType.Plan,
    summary: "Review this plan",
    sessionTitle: "Review",
    requiredServiceIds: new Set(),
    primaryImplementations: [],
    executionPlan: [],
    discrepancies: [],
    clarificationQuestions: [],
  },
};

describe("conversation response model", () => {
  it("keeps planning context and issues visible without taking ownership of the composer", () => {
    const planning = message("planning", "coding_plan_context");
    const issue = message("issue", "coding_plan_discrepancy");
    const model = resolveConversationResponseModel(
      [entry(planning), entry(issue)],
      [planning, issue],
      options,
    );
    expect(model.target.ownership).toBe("none");
    expect(model.forms.get("planning")).toMatchObject({
      shouldRenderForm: true,
      isFormReadOnly: false,
    });
    expect(model.forms.get("issue")).toMatchObject({
      shouldRenderForm: true,
      isFormReadOnly: false,
    });
  });
  it("keeps the latest approval context current when a narrative follows it", () => {
    const first = message("first", "coding_plan_version");
    const current = {
      ...message("current", "coding_plan_version"),
      createdAt: "2026-09-29T00:00:00Z",
    };
    const narrative = {
      ...message("narrative", "agent_response"),
      createdAt: "2026-09-30T00:00:00Z",
      responses: [current],
    };
    expect(latestCodingPlanVersionMessageId([first, narrative])).toBe(
      "current",
    );
  });

  it("requires a replacement after ordinary feedback and keeps the replacement eligible after planner explanations", () => {
    const first = {
      ...message("first", "coding_plan_version"),
      createdAt: "2026-10-24T01:00:00Z",
    };
    const reply = {
      ...message("reply"),
      type: MessageType.User,
      createdAt: "2026-10-24T01:01:00Z",
      data: { comment: "Change point E." },
    };
    expect(latestCodingPlanVersionMessageId([first, reply])).toBeNull();
    const replacement = {
      ...message("replacement", "coding_plan_version"),
      createdAt: "2026-10-24T01:02:00Z",
    };
    const narrative = {
      ...message("explanation", "agent_response"),
      createdAt: "2026-10-24T01:03:00Z",
    };
    expect(
      latestCodingPlanVersionMessageId([narrative, reply, replacement, first]),
    ).toBe("replacement");
  });

  it("shares one owner resolution and retains ownership through temporary disability and read-only access", () => {
    const source = message();
    const resolver = vi.fn<ConversationFormResolver>(() => ({
      uiElements: [{ id: "synthesized", type: "textarea" }],
      responseDeclarations: [
        {
          ownership: "exclusive",
          currentFieldId: "synthesized",
          submissionKind: "owner-command",
        },
      ],
      disabled: true,
      isSubmitted: false,
      submit: vi.fn(),
    }));
    const model = resolveConversationResponseModel([entry(source)], [source], {
      ...options,
      resolver,
      readOnly: true,
      workflowCanSubmit: false,
      isCliInputDisabled: true,
    });
    expect(resolver).toHaveBeenCalledTimes(1);
    expect(model.target).toEqual({
      ownership: "exclusive",
      messageId: source.id,
      currentFieldId: "synthesized",
      submissionKind: "owner-command",
      usable: false,
    });
    expect(model.forms.get(source.id)).toMatchObject({
      isFormReadOnly: true,
      isCompleted: false,
      formUiElements: [{ id: "synthesized" }],
    });
  });

  it("does not treat workflow readiness as persisted completion", () => {
    const source = message();
    const model = resolveConversationResponseModel([entry(source)], [source], {
      ...options,
      workflowCanSubmit: false,
    });
    expect(model.target).toMatchObject({
      ownership: "exclusive",
      usable: false,
    });
    expect(model.forms.get(source.id)).toMatchObject({
      isCompleted: false,
      isFormReadOnly: true,
    });
  });

  it("publishes interactive plan fields through their registered declaration", () => {
    const source = message("plan-message", "plan_generation_stage_review");
    expect(
      resolveConversationResponseModel([entry(source)], [source], options)
        .target,
    ).toEqual({
      ownership: "exclusive",
      messageId: "plan-message",
      currentFieldId: "answer",
      submissionKind: "field",
      usable: true,
    });
  });

  it("publishes implementation readiness as a composer contribution", () => {
    const source = message("readiness-message", "implementation_readiness");
    expect(
      resolveConversationResponseModel([entry(source)], [source], options)
        .target,
    ).toEqual({
      ownership: "contribution",
      messageId: "readiness-message",
      currentFieldId: "answer",
      submissionKind: "field",
      usable: true,
    });
  });

  it("replaces targets and never revives older unanswered fields", () => {
    const first = message("first");
    const next = message("next");
    expect(
      resolveConversationResponseModel(
        [entry(first), entry(next)],
        [first, next],
        options,
      ).target,
    ).toMatchObject({ messageId: "next" });
    const answered = { ...entry(next), canEdit: false };
    expect(
      resolveConversationResponseModel(
        [entry(first), answered],
        [first, next],
        options,
      ).target,
    ).toEqual({ ownership: "none" });
    const display = message("display", "interstitial");
    expect(
      resolveConversationResponseModel(
        [entry(first), entry(display)],
        [first, display],
        options,
      ).target,
    ).toEqual({ ownership: "none" });
  });

  it("releases persisted answers without losing historical form content", () => {
    const source = message();
    source.responses = [
      {
        id: "answer-message",
        projectId: "project",
        conversationId: "conversation",
        createdAt: source.createdAt,
        type: MessageType.User,
        parentMessageId: source.id,
        data: { answer: "Kept answer" },
      },
    ];
    const model = resolveConversationResponseModel(
      [entry(source)],
      [source],
      options,
    );
    expect(model.target).toEqual({ ownership: "none" });
    expect(model.forms.get(source.id)?.formUiElements).toHaveLength(1);
  });

  it("uses the report response identity once and preserves interactive mentions", () => {
    const source = message();
    if (source.type !== MessageType.System) throw new Error("Expected SYSTEM");
    source.reports = [report];
    source.data = {
      type: "AGENT",
      response: "@[report:report|Plan]",
      uiElements: [{ id: "review", type: "coding_prompt_startup_plan" }],
    };
    const model = resolveConversationResponseModel(
      [entry(source)],
      [source],
      options,
    );
    expect(model.target).toMatchObject({
      currentFieldId: "review",
      submissionKind: "report",
    });
    expect(model.forms.get(source.id)).toMatchObject({
      formUiElements: [],
      interactiveReportAttachments: [
        { report, responseUiElement: { id: "review" } },
      ],
    });
  });

  it.each(["contribution", "display-only"] as const)(
    "accepts an owner-declared %s report without shared workflow branching",
    (ownership) => {
      const source = message();
      if (source.type !== MessageType.System)
        throw new Error("Expected SYSTEM");
      source.reports = [report];
      const declaration: ConversationResponseDeclaration =
        ownership === "display-only"
          ? { ownership }
          : {
              ownership,
              currentFieldId: "report-response",
              submissionKind: "report",
            };
      const resolver: ConversationFormResolver = () => ({
        uiElements: [],
        responseDeclarations: [declaration],
        disabled: false,
        isSubmitted: false,
        submit: vi.fn(),
      });
      const model = resolveConversationResponseModel(
        [entry(source)],
        [source],
        { ...options, resolver },
      );
      expect(model.target.ownership).toBe(
        ownership === "display-only" ? "none" : ownership,
      );
      expect(
        model.forms.get(source.id)?.interactiveReportAttachments,
      ).toHaveLength(1);
    },
  );

  it("returns none for empty, absent, or noncanonical fields", () => {
    const source = message();
    expect(resolveConversationResponseModel([], [], options).target).toEqual({
      ownership: "none",
    });
    expect(
      resolveConversationResponseModel([entry(source)], [], options).target,
    ).toEqual({ ownership: "none" });
    if (source.type !== MessageType.System) throw new Error("Expected SYSTEM");
    source.data.uiElements = [];
    expect(
      resolveConversationResponseModel([entry(source)], [source], options)
        .target,
    ).toEqual({ ownership: "none" });
  });
});
