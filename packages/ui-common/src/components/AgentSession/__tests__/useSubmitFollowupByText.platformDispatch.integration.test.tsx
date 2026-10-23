import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MessageType } from "../../../api/index";
import type { SessionMethodContext } from "../../../agents/coordination/types";
import { useSubmitFollowupByText } from "../useSubmitFollowupByText";

// Stub the prompt-recording network call so the helper can run end-to-end
// without hitting the codingPrompts client. We're asserting the wire choice
// (platform vs. local-agent), not the prompt registry.
vi.mock("../runtime/coding/record-coding-prompt.js", () => ({
  recordCodingPrompt: vi.fn().mockResolvedValue({
    ok: true,
    promptId: "prompt-1",
    deduplicated: false,
  }),
}));

const submitMessageMock = vi.hoisted(() => vi.fn());
vi.mock("../operations/useAgentSessionInteractionAccess", () => ({
  useAgentSessionInteractionAccess: () => ({
    isDeviceEnabled: true,
    interactions: { startSession: vi.fn(), submitMessage: submitMessageMock },
    unavailable: null,
  }),
}));

const sessionMethod: SessionMethodContext = {
  method: "open",
  serviceIds: [],
  services: [],
};

describe("useSubmitFollowupByText: freeform follow-up writes to platform, never to LocalAgentApi", () => {
  it.each([
    { attachments: [] },
    {
      attachments: [
        {
          attachmentId: "f7a198de-03a6-47aa-b0bf-830cde418ddb",
          fileName: "notes.txt",
        },
      ],
    },
  ])(
    "carries attachment references through the coding follow-up into the platform message: %j",
    async ({ attachments }) => {
      submitMessageMock.mockClear();
      submitMessageMock.mockResolvedValue({
        state: "succeeded",
        operationId: "operation-1",
        fingerprint: "a".repeat(64),
        kind: "submit_message",
        messageId: "message-1",
        triggerMessageId: "trigger-1",
      });

      // Stub the local-agent rail. Any invocation would mean the freeform path
      // regressed back to the CLI WebSocket/HTTP wire we just retired.
      const localAgentSendMessage = vi.fn().mockResolvedValue(undefined);

      const { result } = renderHook(() =>
        useSubmitFollowupByText({
          runId: "run-1",
          providerRunId: "provider-run-1",
          provider: "codex",
          setSubmissionError: vi.fn(),
          setSubmittingPrompt: vi.fn(),
          setSubmittingFollowupAction: vi.fn(),
          sessionMethod,
          interactionAccess: {
            isDeviceEnabled: true,
            interactions: {
              startSession: vi.fn(),
              submitMessage: submitMessageMock,
            },
            unavailable: null,
          },
          organizationId: "org-1",
          agentSessionId: "cs-1",
          conversationId: "conv-1",
          projectId: "proj-1",
          trackSubmitPromptTelemetry: vi.fn(),
          setPromptDraft: vi.fn(),
        })
      );

      await result.current({
        promptText: "  follow-up text\n",
        attachments,
        clearDraftOnSuccess: true,
        actionName: "submitFollowupPrompt",
        followupAction: null,
      });

      expect(submitMessageMock).toHaveBeenCalledTimes(1);
      const {
        organizationId: orgIdArg,
        projectId: projectIdArg,
        intent: messageArg,
      } = submitMessageMock.mock.calls[0]![0];
      expect(orgIdArg).toBe("org-1");
      expect(projectIdArg).toBe("proj-1");
      expect(messageArg.type).toBe(MessageType.User);
      expect(messageArg.conversationId).toBe("conv-1");
      expect(messageArg.projectId).toBe("proj-1");
      // Explicit null parentMessageId — the API's CreateMessageDto treats null
      // as "append to conversation tail" (task b657c4c6).
      expect(messageArg.parentMessageId).toBeNull();
      // The dispatch instruction rides the nested `agentInput` envelope: the
      // mode-agnostic coding follow-up `promptType` and the
      // user's text on `agentInput.userMessage`. No `data.triggersAgent`.
      expect(messageArg.data.agentInput).toEqual({
        promptType: "coding_freeform",
        userMessage: "  follow-up text\n",
      });
      expect(messageArg.data.triggersAgent).toBeUndefined();
      expect(messageArg.data.attachments).toEqual(attachments);

      expect(localAgentSendMessage).not.toHaveBeenCalled();
    }
  );
});
