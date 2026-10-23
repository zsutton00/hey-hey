import { describe, expect, it, vi } from "vitest";
import {
  LocalPromptType,
  ConversationStartRunRequestDtoProviderEnum,
} from "../../../../api";
import { CODE_REVIEW_DISPLAY_TEXT } from "./directTriggerInput";
import { submitPromptForRun } from "./usePromptRunSubmission";
import type { AgentSessionInteractions } from "../../operations/AgentOperationCoordinator";

const buildRun = () =>
  ({
    runId: "run-1",
    provider: "codex",
    providerRunId: "provider-run-1",
    status: "running",
  }) as const;

const buildInteractions = (
  submitMessage = vi.fn(async (input) => ({
    operationId: "operation-1",
    fingerprint: "a".repeat(64),
    kind: "submit_message" as const,
    state: "succeeded" as const,
    messageId: "message-1",
    triggerMessageId: "trigger-1",
    input,
  })),
): {
  interactions: AgentSessionInteractions;
  submitMessage: ReturnType<typeof vi.fn>;
} => ({
  interactions: {
    startSession: vi.fn(),
    submitMessage,
  },
  submitMessage,
});

describe("submitPromptForRun telemetry", () => {
  it("returns invocation telemetry on success", async () => {
    const run = buildRun();
    const { interactions, submitMessage } = buildInteractions();
    const result = await submitPromptForRun({
      interactions,
      run,
      organizationId: "org-1",
      projectId: "proj-1",
      conversationId: "conv-1",
      agentSessionId: "agent-session-1",
      promptDraft: "Ship telemetry integration",
      startupPrompt: null,
      localPromptType: LocalPromptType.StartupSession,
    });

    expect(result.ok).toBe(true);
    expect(result.telemetry.agentInvocation).toMatchObject({
      sessionId: "agent-session-1",
      invocationId: "run-1",
      status: "success",
      provider: "codex",
      errorCount: 0,
    });
    expect(submitMessage).toHaveBeenCalledWith(
      expect.objectContaining({ agentSessionId: "agent-session-1" }),
    );
  });

  it("threads code-review agent overrides into the platform message agentInput", async () => {
    const run = buildRun();
    const { interactions, submitMessage } = buildInteractions();

    await submitPromptForRun({
      interactions,
      run,
      organizationId: "org-1",
      projectId: "proj-1",
      conversationId: "conv-1",
      agentSessionId: "agent-session-1",
      promptDraft: "Focus on regressions",
      startupPrompt: null,
      localPromptType: LocalPromptType.CodeReview,
      agentOverride: {
        provider: ConversationStartRunRequestDtoProviderEnum.Claude,
        model: "claude-sonnet-4-6",
        reasoningEffort: "high",
        fastMode: false,
      },
    });

    expect(submitMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        intent: expect.objectContaining({
          data: expect.objectContaining({
            comment: `${CODE_REVIEW_DISPLAY_TEXT}\n\nFocus on regressions`,
            agentInput: expect.objectContaining({
              promptType: LocalPromptType.CodeReview,
              userMessage: "Focus on regressions",
              runtime: {
                provider: ConversationStartRunRequestDtoProviderEnum.Claude,
                model: "claude-sonnet-4-6",
                reasoningEffort: "high",
                fastMode: false,
              },
            }),
          }),
        }),
      }),
    );
  });

  it.each([
    {
      name: "empty instructions",
      promptDraft: "",
      expectedDisplayText: CODE_REVIEW_DISPLAY_TEXT,
      expectedAgentMessage: "",
    },
    {
      name: "whitespace-only instructions",
      promptDraft: " \n\t ",
      expectedDisplayText: CODE_REVIEW_DISPLAY_TEXT,
      expectedAgentMessage: "",
    },
    {
      name: "substantive instructions",
      promptDraft: "  Check the error handling.  ",
      expectedDisplayText: `${CODE_REVIEW_DISPLAY_TEXT}\n\nCheck the error handling.`,
      expectedAgentMessage: "Check the error handling.",
    },
  ])(
    "authors separate Review display and execution text for $name",
    async ({ promptDraft, expectedDisplayText, expectedAgentMessage }) => {
      const run = buildRun();
      const { interactions, submitMessage } = buildInteractions();

      await submitPromptForRun({
        interactions,
        run,
        organizationId: "org-1",
        projectId: "proj-1",
        conversationId: "conv-1",
        agentSessionId: "agent-session-1",
        promptDraft,
        startupPrompt: null,
        localPromptType: LocalPromptType.CodeReview,
      });

      const request = submitMessage.mock.calls[0]?.[0] as {
        intent: {
          data: {
            comment?: string;
            agentInput?: { userMessage?: string };
          };
        };
      };
      expect(request.intent.data.comment).toBe(expectedDisplayText);
      expect(request.intent.data.agentInput?.userMessage).toBe(
        expectedAgentMessage,
      );
    },
  );

  it("returns invocation failure telemetry when platform submission fails", async () => {
    const run = buildRun();
    const submitMessage = vi.fn().mockRejectedValue(new Error("submit failed"));
    const { interactions } = buildInteractions(submitMessage);
    const result = await submitPromptForRun({
      interactions,
      run,
      organizationId: "org-1",
      projectId: "proj-1",
      conversationId: "conv-1",
      agentSessionId: "agent-session-1",
      promptDraft: "Ship telemetry integration",
      startupPrompt: null,
      localPromptType: LocalPromptType.StartupSession,
    });

    expect(result.ok).toBe(false);
    expect(result.telemetry.agentInvocation).toMatchObject({
      sessionId: "agent-session-1",
      status: "failure",
      errorMessage: "submit failed",
    });
    expect(submitMessage).toHaveBeenCalledOnce();
  });
});
