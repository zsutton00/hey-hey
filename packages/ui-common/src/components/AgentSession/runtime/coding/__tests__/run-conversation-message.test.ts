import {
  MessageStatus,
  MessageType,
  type CreateUserMessage,
} from "../../../../../api";
import { describe, expect, it } from "vitest";
import { CODING_PROMPT_FOLLOWUP_INPUT_ID } from "../../../codingPromptConversationContracts";
import { parseRunConversationMessageSubmission } from "../run-conversation-message";

const createUserMessage = (
  data: Record<string, unknown>,
): CreateUserMessage => ({
  workflowId: "workflow-1",
  projectId: "project-1",
  conversationId: "conversation-1",
  parentMessageId: "parent-1",
  type: MessageType.User,
  status: MessageStatus.Completed,
  data,
});

describe("parseRunConversationMessageSubmission", () => {
  it("parses follow-up prompt messages from generic textarea payload", () => {
    const parsed = parseRunConversationMessageSubmission(
      createUserMessage({
        [CODING_PROMPT_FOLLOWUP_INPUT_ID]: "  Ship this update  ",
      }),
    );

    expect(parsed).toEqual({
      kind: "followup_prompt",
      promptText: "Ship this update",
      attachments: [],
    });
  });

  it("carries attachment references on follow-up prompt messages", () => {
    const attachments = [
      { attachmentId: "attachment-1", fileName: "thread.md" },
    ];
    expect(
      parseRunConversationMessageSubmission(
        createUserMessage({
          attachments,
          agentInput: {
            promptType: "entity_conversation",
            userMessage: "read this",
          },
        }),
      ),
    ).toEqual({
      kind: "followup_prompt",
      promptText: "read this",
      attachments,
    });
  });

  it("parses follow-up prompt messages from the canonical agentInput envelope", () => {
    expect(
      parseRunConversationMessageSubmission(
        createUserMessage({
          agentInput: {
            promptType: "coding_freeform",
            userMessage: "  continue with the entity discussion  ",
          },
        }),
      ),
    ).toEqual({
      kind: "followup_prompt",
      promptText: "continue with the entity discussion",
      attachments: [],
    });
  });

  it("parses startup plan review payload from structured startup field value", () => {
    const requiredServiceIds = ["service-1", "service-2"];
    const parsed = parseRunConversationMessageSubmission(
      createUserMessage({
        "startup-plan-field-id": {
          responseType: "startup_plan_v1",
          requiredServiceIds,
          primaryImplementations: [
            {
              title: "Core implementation",
              content: "Implementation details",
              rationale: "Primary plan outcome",
            },
          ],
          sessionTitle: "Startup Session",
          executionPlan: [],
          discrepancies: [
            {
              sourceRef: {
                sourceType: "task",
                sourceId: "task-1",
              },
              sourceExcerpt: "Excerpt",
              reasoning: "Reasoning",
              discrepancyText: "Discrepancy",
              severity: "high",
            },
          ],
          clarificationQuestions: [],
          discrepancyDispositions: [
            {
              discrepancyIndex: 0,
              disposition: "acknowledged",
              note: "Already handled",
            },
          ],
        },
      }),
    );

    expect(parsed).toEqual({
      kind: "startup_plan_review",
      promptText: "### Plan approved",
      submission: {
        decision: "approve",
        feedback: null,
        review: {
          responseType: "startup_plan_review_v1",
          originalPlan: {
            responseType: "startup_plan_v1",
            requiredServiceIds: ["service-1", "service-2"],
            primaryImplementations: [
              {
                title: "Core implementation",
                content: "Implementation details",
                rationale: "Primary plan outcome",
              },
            ],
            sessionTitle: "Startup Session",
            executionPlan: [],
            discrepancies: [
              {
                sourceRef: {
                  sourceType: "task",
                  sourceId: "task-1",
                },
                sourceExcerpt: "Excerpt",
                reasoning: "Reasoning",
                discrepancyText: "Discrepancy",
                severity: "high",
              },
            ],
            clarificationQuestions: [],
          },
          questionAnswers: [],
          discrepancyDispositions: [
            {
              discrepancyIndex: 0,
              disposition: "acknowledged",
              note: "Already handled",
            },
          ],
        },
      },
    });
    if (parsed?.kind === "startup_plan_review") {
      expect(parsed.submission.review.originalPlan.requiredServiceIds).toBe(
        requiredServiceIds,
      );
    }
  });

  it("defaults startup decision to improve when blocker dispositions exist", () => {
    const parsed = parseRunConversationMessageSubmission(
      createUserMessage({
        "startup-plan-field-id": {
          responseType: "startup_plan_v1",
          requiredServiceIds: ["service-1", "service-2"],
          primaryImplementations: [
            {
              title: "Core implementation",
              content: "Implementation details",
              rationale: "Primary plan outcome",
            },
          ],
          sessionTitle: "Startup Session",
          executionPlan: [],
          discrepancies: [],
          clarificationQuestions: [],
          discrepancyDispositions: [
            {
              discrepancyIndex: 1,
              disposition: "blocker",
            },
          ],
        },
      }),
    );

    expect(parsed).toMatchObject({
      kind: "startup_plan_review",
      submission: {
        decision: "improve",
      },
    });
  });

  it("includes step and discrepancy feedback in submission feedback text", () => {
    const parsed = parseRunConversationMessageSubmission(
      createUserMessage({
        "startup-plan-field-id": {
          responseType: "startup_plan_v1",
          requiredServiceIds: ["service-1", "service-2"],
          primaryImplementations: [
            {
              title: "Core implementation",
              content: "Implementation details",
              rationale: "Primary plan outcome",
            },
          ],
          sessionTitle: "Startup Session",
          executionPlan: [
            {
              stepId: "step-1",
              title: "Prepare contracts",
              description: "Review and validate contracts.",
              references: [],
            },
          ],
          discrepancies: [
            {
              sourceRef: {
                sourceType: "task",
                sourceId: "task-1",
              },
              sourceExcerpt: "Excerpt",
              reasoning: "Reasoning",
              discrepancyText: "Task scope mismatch",
              severity: "medium",
            },
          ],
          clarificationQuestions: [],
          stepFeedback: [
            {
              stepId: "step-1",
              note: "Add contract validation tests",
            },
          ],
          discrepancyFeedback: [
            {
              discrepancyIndex: 0,
              note: "Align this with acceptance criteria",
            },
          ],
        },
      }),
    );

    expect(parsed).toMatchObject({
      kind: "startup_plan_review",
      submission: {
        decision: "approve",
        review: {
          discrepancyDispositions: [
            {
              discrepancyIndex: 0,
              disposition: "acknowledged",
              note: "Align this with acceptance criteria",
            },
          ],
        },
      },
    });
    expect(parsed?.kind).toBe("startup_plan_review");
    if (parsed?.kind === "startup_plan_review") {
      expect(parsed.submission.feedback).toContain("Execution Step Feedback:");
      expect(parsed.submission.feedback).toContain(
        "Add contract validation tests",
      );
      expect(parsed.submission.feedback).toContain("Discrepancy Feedback:");
      expect(parsed.submission.feedback).toContain(
        "Align this with acceptance criteria",
      );
      expect(parsed.promptText).toContain("## Plan approved");
      expect(parsed.promptText).toContain("### Plan steps");
      expect(parsed.promptText).toContain("1. _Prepare contracts_");
      expect(parsed.promptText).toContain("   Add contract validation tests");
      expect(parsed.promptText).toContain("### Discrepancies");
      expect(parsed.promptText).toContain("1. _Task scope mismatch_");
      expect(parsed.promptText).toContain(
        "   Align this with acceptance criteria",
      );
    }
  });

  it("uses explicit improve decision when continue refining is selected", () => {
    const parsed = parseRunConversationMessageSubmission(
      createUserMessage({
        "startup-plan-field-id": {
          responseType: "startup_plan_v1",
          requiredServiceIds: ["service-1", "service-2"],
          primaryImplementations: [
            {
              title: "Core implementation",
              content: "Implementation details",
              rationale: "Primary plan outcome",
            },
          ],
          sessionTitle: "Startup Session",
          executionPlan: [],
          discrepancies: [],
          clarificationQuestions: [],
          decision: "improve",
        },
      }),
    );

    expect(parsed).toMatchObject({
      kind: "startup_plan_review",
      submission: {
        decision: "improve",
      },
    });
  });

  it("includes clarification answers entered in startup plan form data", () => {
    const parsed = parseRunConversationMessageSubmission(
      createUserMessage({
        "startup-plan-field-id": {
          responseType: "startup_plan_v1",
          requiredServiceIds: ["service-1", "service-2"],
          primaryImplementations: [
            {
              title: "Core implementation",
              content: "Implementation details",
              rationale: "Primary plan outcome",
            },
          ],
          sessionTitle: "Startup Session",
          executionPlan: [],
          discrepancies: [],
          clarificationQuestions: [
            {
              question: "Should we use notification.created?",
            },
            {
              question: "Where are preference flags persisted?",
            },
          ],
          questionAnswers: [
            {
              questionIndex: 0,
              answer: "  Yes, use notification.created.  ",
            },
            {
              questionIndex: 1,
              answer: "   ",
            },
          ],
        },
      }),
    );

    expect(parsed).toMatchObject({
      kind: "startup_plan_review",
      promptText:
        "### Plan approved\n\n#### Clarification answers\n1. _Should we use notification.created?_\n\n   Yes, use notification.created.",
      submission: {
        review: {
          questionAnswers: [
            {
              question: "Should we use notification.created?",
              answer: "Yes, use notification.created.",
            },
          ],
        },
      },
    });
  });

  it("uses original ordinals and omits empty sections in startup review prompt text", () => {
    const parsed = parseRunConversationMessageSubmission(
      createUserMessage({
        "startup-plan-field-id": {
          responseType: "startup_plan_v1",
          requiredServiceIds: ["service-1", "service-2"],
          primaryImplementations: [
            {
              title: "Core implementation",
              content: "Implementation details",
              rationale: "Primary plan outcome",
            },
          ],
          sessionTitle: "Startup Session",
          executionPlan: [
            {
              stepId: "step-1",
              title: "Step one",
              description: "First",
              references: [],
            },
            {
              stepId: "step-2",
              title: "Step two",
              description: "Second",
              references: [],
            },
            {
              stepId: "step-3",
              title: "Step three",
              description: "Third",
              references: [],
            },
          ],
          discrepancies: [
            {
              sourceRef: {
                sourceType: "task",
                sourceId: "task-1",
              },
              sourceExcerpt: "Excerpt",
              reasoning: "Reasoning",
              discrepancyText: "First discrepancy",
              severity: "low",
            },
          ],
          clarificationQuestions: [],
          decision: "improve",
          stepFeedback: [
            {
              stepId: "step-3",
              note: "We should update this first.",
            },
          ],
        },
      }),
    );

    expect(parsed).toMatchObject({
      kind: "startup_plan_review",
      promptText:
        "### Continue revising plan\n\n#### Plan steps\n3. _Step three_\n\n   We should update this first.",
    });
  });

  it("threads provider from the structured field value into the submission", () => {
    const parsed = parseRunConversationMessageSubmission(
      createUserMessage({
        "startup-plan-field-id": {
          responseType: "startup_plan_v1",
          requiredServiceIds: ["service-1", "service-2"],
          primaryImplementations: [
            {
              title: "Core implementation",
              content: "Implementation details",
              rationale: "Primary plan outcome",
            },
          ],
          sessionTitle: "Startup Session",
          executionPlan: [],
          discrepancies: [],
          clarificationQuestions: [],
          provider: "codex",
          model: "gpt-5.4",
          reasoningEffort: "medium",
          fastMode: false,
        },
      }),
    );

    expect(parsed).toMatchObject({
      kind: "startup_plan_review",
      submission: {
        provider: "codex",
        model: "gpt-5.4",
        reasoningEffort: "medium",
        fastMode: false,
      },
    });
  });

  it("returns null for unsupported payloads", () => {
    const parsed = parseRunConversationMessageSubmission(
      createUserMessage({
        unsupported: true,
      }),
    );

    expect(parsed).toBeNull();
  });

  it("rejects startup plans with empty required Service IDs", () => {
    const parsed = parseRunConversationMessageSubmission(
      createUserMessage({
        "startup-plan-field-id": {
          responseType: "startup_plan_v1",
          requiredServiceIds: [""],
          primaryImplementations: [
            {
              title: "Core implementation",
              content: "Implementation details",
              rationale: "Primary plan outcome",
            },
          ],
          sessionTitle: "Startup Session",
          executionPlan: [],
          discrepancies: [],
          clarificationQuestions: [],
        },
      }),
    );

    expect(parsed).toBeNull();
  });
});
