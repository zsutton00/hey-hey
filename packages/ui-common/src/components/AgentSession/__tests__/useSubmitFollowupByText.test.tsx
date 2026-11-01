import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { SessionMethodContext } from "../../../agents/coordination/types";
import { useSubmitFollowupByText } from "../useSubmitFollowupByText";

const workflowNode = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    data: { data: { currentNodeId: "feature-sync-analyze" } },
  }),
);
vi.mock("../../../clients/serviceClients", () => ({
  workflowsClient: { getConversationWorkflowNode: workflowNode },
}));
const submitFreeformViaPlatformMock = vi.fn();

const enabledAccess = {
  isDeviceEnabled: true as const,
  interactions: { startSession: vi.fn(), submitMessage: vi.fn() },
  unavailable: null,
};
const disabledAccess = {
  isDeviceEnabled: false as const,
  interactions: null,
  unavailable: {
    type: "machine_not_selected" as const,
    message: "Select an execution-ready machine before submitting local work.",
  },
};

vi.mock("../runtime/hooks/submitFreeformViaPlatform", () => ({
  submitFreeformViaPlatform: (...args: unknown[]) =>
    submitFreeformViaPlatformMock(...args),
}));

const buildSessionMethod = (
  method: SessionMethodContext["method"],
): SessionMethodContext => ({
  method,
  serviceIds: [],
  services: [],
});

const dispatchFollowup = async (
  sessionMethod: SessionMethodContext | undefined,
) => {
  submitFreeformViaPlatformMock.mockReset();
  submitFreeformViaPlatformMock.mockResolvedValue({
    ok: true,
    telemetry: { agentInvocation: null },
  });

  const setSubmissionError = vi.fn();
  const setSubmittingPrompt = vi.fn();
  const setSubmittingFollowupAction = vi.fn();
  const trackSubmitPromptTelemetry = vi.fn();
  const setPromptDraft = vi.fn();

  const { result } = renderHook(() =>
    useSubmitFollowupByText({
      runId: "run-1",
      providerRunId: "provider-run-1",
      provider: "codex",
      setSubmissionError,
      setSubmittingPrompt,
      setSubmittingFollowupAction,
      sessionMethod,
      interactionAccess: enabledAccess,
      organizationId: "org-1",
      agentSessionId: "cs-1",
      conversationId: "conv-1",
      projectId: "proj-1",
      trackSubmitPromptTelemetry,
      setPromptDraft,
    }),
  );

  await result.current({
    promptText: "next step please",
    clearDraftOnSuccess: false,
    actionName: "submitFollowupPrompt",
    followupAction: null,
  });

  expect(submitFreeformViaPlatformMock).toHaveBeenCalledTimes(1);
  return submitFreeformViaPlatformMock.mock.calls[0]![0] as Record<
    string,
    unknown
  >;
};

describe("useSubmitFollowupByText: workflow methods tag follow-ups WorkflowDefined", () => {
  it("dispatches localPromptType 'workflow-defined' when sessionMethod.method === 'plan'", async () => {
    const arg = await dispatchFollowup(buildSessionMethod("plan"));
    expect(arg.localPromptType).toBe("workflow-defined");
  });
});

describe("conversational planning replies", () => {
  it("sends normal planning feedback directly to the planner", async () => {
    workflowNode.mockResolvedValueOnce({
      data: { data: { currentNodeId: "feature-sync-coding-plan" } },
    });
    await dispatchFollowup(buildSessionMethod("plan"));
    expect(submitFreeformViaPlatformMock.mock.calls[0][0].localPromptType).toBe(
      "startup_session",
    );
  });
});

describe("useSubmitFollowupByText: handler methods use the mode-agnostic coding follow-up", () => {
  it("'open' → coding_freeform", async () => {
    const arg = await dispatchFollowup(buildSessionMethod("open"));
    expect(arg.localPromptType).toBe("coding_freeform");
  });

  it("'quick' → coding_freeform", async () => {
    const arg = await dispatchFollowup(buildSessionMethod("quick"));
    expect(arg.localPromptType).toBe("coding_freeform");
  });

  it("'debug' → coding_freeform", async () => {
    const arg = await dispatchFollowup(buildSessionMethod("debug"));
    expect(arg.localPromptType).toBe("coding_freeform");
  });

  it("'research' → coding_freeform", async () => {
    const arg = await dispatchFollowup(buildSessionMethod("research"));
    expect(arg.localPromptType).toBe("coding_freeform");
  });

  it("'split_by_function' → coding_freeform", async () => {
    const arg = await dispatchFollowup(buildSessionMethod("split_by_function"));
    expect(arg.localPromptType).toBe("coding_freeform");
  });

  it("'split_by_service' → coding_freeform", async () => {
    const arg = await dispatchFollowup(buildSessionMethod("split_by_service"));
    expect(arg.localPromptType).toBe("coding_freeform");
  });
});

describe("useSubmitFollowupByText: no-method legacy callers fall back to coding_freeform", () => {
  it("dispatches localPromptType 'coding_freeform' when sessionMethod is undefined", async () => {
    const arg = await dispatchFollowup(undefined);
    expect(arg.localPromptType).toBe("coding_freeform");
  });
});

describe("useSubmitFollowupByText: post failure propagation", () => {
  it("rejects with the submitFreeformViaPlatform error rather than only setting submissionError", async () => {
    submitFreeformViaPlatformMock.mockReset();
    submitFreeformViaPlatformMock.mockResolvedValue({
      ok: false,
      error: "Platform rejected the message",
    });

    const setSubmissionError = vi.fn();
    const setSubmittingPrompt = vi.fn();
    const setSubmittingFollowupAction = vi.fn();
    const trackSubmitPromptTelemetry = vi.fn();
    const setPromptDraft = vi.fn();

    const { result } = renderHook(() =>
      useSubmitFollowupByText({
        runId: "run-1",
        providerRunId: "provider-run-1",
        provider: "codex",
        setSubmissionError,
        setSubmittingPrompt,
        setSubmittingFollowupAction,
        sessionMethod: buildSessionMethod("split_by_service"),
        interactionAccess: enabledAccess,
        organizationId: "org-1",
        agentSessionId: "cs-1",
        conversationId: "conv-1",
        projectId: "proj-1",
        trackSubmitPromptTelemetry,
        setPromptDraft,
      }),
    );

    await expect(
      result.current({
        promptText: "next step please",
        clearDraftOnSuccess: false,
        actionName: "submitFollowupPrompt",
        followupAction: null,
      }),
    ).rejects.toThrow("Platform rejected the message");

    // The failure surfaces to the caller (the composer) instead of feeding
    // the page-level submission error.
    expect(setSubmissionError).not.toHaveBeenCalledWith(
      "Platform rejected the message",
    );
    // The in-flight flag is still cleared by the finally block.
    expect(setSubmittingPrompt).toHaveBeenLastCalledWith(false);
  });
});

describe("useSubmitFollowupByText: unavailable context", () => {
  it.each([
    ["run", null, "machine-1", "No active run available."],
    [
      "machine",
      "run-1",
      undefined,
      "Select an execution-ready machine before submitting local work.",
    ],
  ] as const)(
    "rejects when %s context is unavailable",
    async (_context, runId, machineId, expectedMessage) => {
      const { result } = renderHook(() =>
        useSubmitFollowupByText({
          runId,
          providerRunId: "provider-run-1",
          provider: "codex",
          setSubmissionError: vi.fn(),
          setSubmittingPrompt: vi.fn(),
          setSubmittingFollowupAction: vi.fn(),
          sessionMethod: buildSessionMethod("plan"),
          interactionAccess: machineId ? enabledAccess : disabledAccess,
          organizationId: "org-1",
          agentSessionId: "cs-1",
          conversationId: "conv-1",
          projectId: "proj-1",
          trackSubmitPromptTelemetry: vi.fn(),
          setPromptDraft: vi.fn(),
        }),
      );

      await expect(
        result.current({
          promptText: "keep this draft",
          clearDraftOnSuccess: false,
          actionName: "submitFollowupPrompt",
          followupAction: null,
        }),
      ).rejects.toThrow(expectedMessage);
      expect(submitFreeformViaPlatformMock).not.toHaveBeenCalled();
    },
  );
});

describe("useSubmitFollowupByText: helper input shape", () => {
  it("threads conversationId/projectId without forwarding a parentMessageId (helper sets null on the wire)", async () => {
    submitFreeformViaPlatformMock.mockReset();
    submitFreeformViaPlatformMock.mockResolvedValue({
      ok: true,
      telemetry: { agentInvocation: null },
    });

    const { result } = renderHook(() =>
      useSubmitFollowupByText({
        runId: "run-1",
        providerRunId: "provider-run-1",
        provider: "codex",
        setSubmissionError: vi.fn(),
        setSubmittingPrompt: vi.fn(),
        setSubmittingFollowupAction: vi.fn(),
        sessionMethod: buildSessionMethod("open"),
        interactionAccess: enabledAccess,
        organizationId: "org-1",
        agentSessionId: "cs-1",
        conversationId: "conv-1",
        projectId: "proj-1",
        trackSubmitPromptTelemetry: vi.fn(),
        setPromptDraft: vi.fn(),
      }),
    );

    await result.current({
      promptText: "hi",
      clearDraftOnSuccess: false,
      actionName: "submitFollowupPrompt",
      followupAction: null,
    });

    const arg = submitFreeformViaPlatformMock.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(arg.conversationId).toBe("conv-1");
    expect(arg.projectId).toBe("proj-1");
    // The helper's input contract has no parentMessageId field — the wire-
    // level `parentMessageId: null` (which the API treats as "append to
    // tail") is set inside submitFreeformViaPlatform itself, asserted by
    // the platformDispatch integration test.
    expect(arg).not.toHaveProperty("parentMessageId");
  });
});
