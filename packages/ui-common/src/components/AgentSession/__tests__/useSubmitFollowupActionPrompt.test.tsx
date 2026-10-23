import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  LocalPromptType,
  ConversationStartRunRequestDtoProviderEnum,
} from "../../../api";
import { useSubmitCodeReviewPrompt } from "../useSubmitCodeReviewPrompt";
import { useSubmitCommitPrompt } from "../useSubmitCommitPrompt";
import { CODE_REVIEW_DISPLAY_TEXT } from "../runtime/hooks/directTriggerInput";

const submitPromptForRunMock = vi.fn();

vi.mock("../runtime/hooks/usePromptRunSubmission", () => ({
  submitPromptForRun: (...args: unknown[]) => submitPromptForRunMock(...args),
}));

const buildHookInput = () => ({
  runId: "run-1",
  providerRunId: "provider-run-1",
  provider: ConversationStartRunRequestDtoProviderEnum.Codex,
  setSubmissionError: vi.fn(),
  setSubmittingPrompt: vi.fn(),
  setSubmittingFollowupAction: vi.fn(),
  organizationId: "org-1",
  projectId: "proj-1",
  conversationId: "conv-1",
  agentSessionId: "agent-session-1",
  interactionAccess: {
    isDeviceEnabled: true as const,
    interactions: { startSession: vi.fn(), submitMessage: vi.fn() },
    unavailable: null,
  },
  trackSubmitPromptTelemetry: vi.fn(),
});

const submitResult = {
  ok: true,
  notice: null,
  telemetry: { agentInvocation: null },
} as const;

describe("followup action submit hooks", () => {
  it("forwards code-review overrides with enabled Fast mode", async () => {
    submitPromptForRunMock.mockReset();
    submitPromptForRunMock.mockResolvedValue(submitResult);
    const input = buildHookInput();
    const { result } = renderHook(() => useSubmitCodeReviewPrompt(input));

    await result.current({
      additionalInstructions: " focus on tests ",
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5.4",
      reasoningEffort: "high",
      fastMode: true,
    });

    expect(submitPromptForRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        promptDraft: "focus on tests",
        displayText: `${CODE_REVIEW_DISPLAY_TEXT}\n\nfocus on tests`,
        localPromptType: LocalPromptType.CodeReview,
        agentOverride: {
          provider: ConversationStartRunRequestDtoProviderEnum.Codex,
          model: "gpt-5.4",
          reasoningEffort: "high",
          fastMode: true,
        },
      })
    );
  });

  it("forwards commit overrides with explicit disabled Fast mode", async () => {
    submitPromptForRunMock.mockReset();
    submitPromptForRunMock.mockResolvedValue(submitResult);
    const input = buildHookInput();
    const { result } = renderHook(() => useSubmitCommitPrompt(input));

    await result.current({
      additionalInstructions: undefined,
      provider: ConversationStartRunRequestDtoProviderEnum.Codex,
      model: "gpt-5.4",
      reasoningEffort: "medium",
      fastMode: false,
    });

    expect(submitPromptForRunMock).toHaveBeenCalledWith(
      expect.objectContaining({
        promptDraft: "",
        localPromptType: LocalPromptType.Commit,
        agentOverride: {
          provider: ConversationStartRunRequestDtoProviderEnum.Codex,
          model: "gpt-5.4",
          reasoningEffort: "medium",
          fastMode: false,
        },
      })
    );
  });

  it("omits Fast mode from an unsupported commit override", async () => {
    submitPromptForRunMock.mockReset();
    submitPromptForRunMock.mockResolvedValue(submitResult);
    const { result } = renderHook(() =>
      useSubmitCommitPrompt(buildHookInput())
    );

    await result.current({
      additionalInstructions: undefined,
      provider: ConversationStartRunRequestDtoProviderEnum.Opencode,
      model: "opencode-default",
      reasoningEffort: null,
    });

    expect(
      submitPromptForRunMock.mock.calls[0]?.[0].agentOverride
    ).not.toHaveProperty("fastMode");
  });
});
