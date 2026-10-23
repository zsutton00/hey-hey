import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionStatus,
  MessageType,
  type RunCreatePayloadOpenItemsTriage,
} from "../../../api";

const { submitMessageMock } = vi.hoisted(() => ({
  submitMessageMock: vi.fn(),
}));

vi.mock("../operations/useAgentSessionInteractionAccess", () => ({
  useAgentSessionInteractionAccess: () => ({
    isDeviceEnabled: true,
    interactions: { startSession: vi.fn(), submitMessage: submitMessageMock },
    unavailable: null,
  }),
}));

import { useAgentRunLifecycle } from "../useAgentRunLifecycle";

const buildApiClient = () => ({
  stopAgentSessionRun: vi.fn().mockResolvedValue(undefined),
  postMessage: vi.fn().mockResolvedValue(undefined),
});

const startRunOk = vi.fn().mockResolvedValue({
  ok: true,
  dispatched: true,
  triggerMessageId: "trig-1",
});

const baseInput = (
  apiClient: ReturnType<typeof buildApiClient>,
  overrides: Record<string, unknown> = {},
) => ({
  apiClient,
  enabled: true,
  organizationId: "org-1",
  projectId: "proj-1",
  agentSessionId: "agent-session-1",
  agentSessionStatus: AgentSessionStatus.NotStarted,
  agentSessionConversationId: "conv-1",
  context: { projectId: "proj-1" } as never,
  contextMetadata: {} as never,
  launch: { startRun: startRunOk },
  machineId: "machine-1",
  arm: {
    kind: "handler" as const,
    promptType: "entity_conversation",
    payload: {
      payloadVersion: 1,
      promptType: "entity_conversation",
      userMessage: "",
    } as never,
  },
  // Deferred (runless) launch — no run fires on open. Every dispatch flows
  // through sendUserMessage instead.
  deferInitialDispatch: true,
  ...overrides,
});

describe("useAgentRunLifecycle.sendUserMessage (centralized run-exists decision)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    submitMessageMock.mockResolvedValue({
      operationId: "operation-1",
      fingerprint: "a".repeat(64),
      kind: "submit_message",
      state: "succeeded",
      messageId: "message-1",
      triggerMessageId: "trigger-1",
    });
    startRunOk.mockResolvedValue({
      ok: true,
      dispatched: true,
      triggerMessageId: "trig-1",
    });
  });

  it("passes starting-message attachments through the with-message boundary", async () => {
    const { result } = renderHook(() =>
      useAgentRunLifecycle(baseInput(buildApiClient())),
    );
    const attachments = [
      {
        attachmentId: "f7a198de-03a6-47aa-b0bf-830cde418ddb",
        fileName: "notes.txt",
      },
    ];
    await act(async () => {
      await result.current.dispatchStartRunWithMessage(
        { role: MessageType.User },
        "  unchanged\n",
        undefined,
        attachments,
      );
    });
    expect(startRunOk).toHaveBeenLastCalledWith(
      expect.objectContaining({
        kind: "handler",
        attachments,
        payload: expect.objectContaining({ userMessage: "  unchanged\n" }),
      }),
    );
    await act(async () => {
      await result.current.dispatchStartRunWithMessage(
        { role: MessageType.User },
        "no files",
      );
    });
    expect(startRunOk).toHaveBeenLastCalledWith(
      expect.objectContaining({ attachments: [] }),
    );
  });

  it("carries distinct typed triage requests through both initial launch and follow-up rails", async () => {
    let requestKind: "freshPass" | "followUp" = "freshPass";
    const buildHandlerTurn = (
      text: string,
    ): RunCreatePayloadOpenItemsTriage => ({
      promptType: "open_items_triage",
      requestKind,
      projectId: "proj-1",
      entity: { entityType: "PROJECT", entityId: "proj-1" },
      userMessage: text,
    });
    const apiClient = buildApiClient();
    const { result } = renderHook(() =>
      useAgentRunLifecycle(
        baseInput(apiClient, {
          arm: {
            kind: "handler",
            promptType: "open_items_triage",
            payload: buildHandlerTurn(""),
          },
          buildHandlerTurn,
        }),
      ),
    );
    expect(startRunOk).not.toHaveBeenCalled();
    expect(submitMessageMock).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.sendUserMessage("");
    });
    expect(startRunOk.mock.calls[0][0].payload).toEqual(buildHandlerTurn(""));
    requestKind = "followUp";
    await act(async () => {
      await result.current.sendUserMessage("Keep the active work", undefined, [
        {
          attachmentId: "f7a198de-03a6-47aa-b0bf-830cde418ddb",
          fileName: "notes.txt",
        },
      ]);
    });
    expect(submitMessageMock.mock.calls[0][0].intent.data.agentInput).toEqual(
      buildHandlerTurn("Keep the active work"),
    );
    expect(submitMessageMock.mock.calls[0][0].intent.data.attachments).toEqual([
      {
        attachmentId: "f7a198de-03a6-47aa-b0bf-830cde418ddb",
        fileName: "notes.txt",
      },
    ]);
    requestKind = "freshPass";
    await act(async () => {
      await result.current.sendUserMessage("");
    });
    expect(submitMessageMock.mock.calls[1][0].intent.data.agentInput).toEqual(
      buildHandlerTurn(""),
    );
    expect(submitMessageMock.mock.calls[1][0].intent.data.attachments).toEqual(
      [],
    );
    expect(apiClient.postMessage).not.toHaveBeenCalled();
  });

  it("does not fire a start-run on open for a deferred (runless) launch", async () => {
    const apiClient = buildApiClient();
    renderHook(() => useAgentRunLifecycle(baseInput(apiClient)));

    await act(async () => {
      await Promise.resolve();
    });

    // No run materialized on open: neither a start-run nor a follow-up post.
    expect(startRunOk).not.toHaveBeenCalled();
    expect(submitMessageMock).not.toHaveBeenCalled();
  });

  it("first reply (no live run) fires one start-run with a USER initialMessage, then later replies post follow-ups", async () => {
    const apiClient = buildApiClient();
    const { result } = renderHook(() =>
      useAgentRunLifecycle(baseInput(apiClient)),
    );

    // First reply: no run yet → start-run kickoff carrying a USER initialMessage.
    await act(async () => {
      const res = await result.current.sendUserMessage("hello");
      // A launching send correlates through the start-run trigger row.
      expect(res).toEqual({ ok: true, messageId: "trig-1" });
    });

    expect(startRunOk).toHaveBeenCalledTimes(1);
    const startArg = startRunOk.mock.calls[0]![0] as Record<string, unknown>;
    expect(startArg.initialMessage).toEqual({ role: MessageType.User });
    expect(startArg.promptType).toBe("entity_conversation");
    // The kickoff is a single write — no separate follow-up post.
    expect(submitMessageMock).not.toHaveBeenCalled();

    // Second reply: the run is now live → ordinary follow-up POST, no start-run.
    await act(async () => {
      const res = await result.current.sendUserMessage("again");
      // A follow-up correlates through its accepted USER row.
      expect(res).toEqual({ ok: true, messageId: "message-1" });
    });

    expect(startRunOk).toHaveBeenCalledTimes(1);
    await waitFor(() => {
      expect(submitMessageMock).toHaveBeenCalledTimes(1);
    });
    const {
      organizationId: orgId,
      projectId,
      intent,
    } = submitMessageMock.mock.calls[0]![0];
    expect(orgId).toBe("org-1");
    expect(projectId).toBe("proj-1");
    const agentInput = intent.data.agentInput as Record<string, unknown>;
    expect(agentInput.userMessage).toBe("again");
    expect(agentInput.promptType).toBe("entity_conversation");
  });

  it("carries the durable Service context into a deferred first-turn start-run", async () => {
    const apiClient = buildApiClient();
    const { result } = renderHook(() =>
      useAgentRunLifecycle(
        baseInput(apiClient, {
          serviceIds: ["service-1"],
          launchServiceId: "service-1",
        }),
      ),
    );

    await act(async () => {
      await result.current.sendUserMessage("use the repository");
    });

    const startArg = startRunOk.mock.calls[0]![0] as Record<string, unknown>;
    expect(startArg).toEqual(
      expect.objectContaining({
        serviceIds: ["service-1"],
        launchServiceId: "service-1",
      }),
    );
  });

  it("rejects a deferred user message when the handler payload has no userMessage field", async () => {
    const apiClient = buildApiClient();
    const { result } = renderHook(() =>
      useAgentRunLifecycle(
        baseInput(apiClient, {
          arm: {
            kind: "handler",
            promptType: "plan_shaping_finalize",
            payload: {
              entity: {
                entityType: "PLAN",
                entityId: "11111111-1111-4111-8111-111111111111",
              },
              promptType: "plan_shaping_finalize",
            },
          },
        }),
      ),
    );

    await act(async () => {
      const response = await result.current.sendUserMessage("hello");
      expect(response).toEqual({
        ok: false,
        error: "Cannot attach a user message to plan_shaping_finalize.",
      });
    });

    expect(startRunOk).not.toHaveBeenCalled();
    expect(submitMessageMock).not.toHaveBeenCalled();
  });

  it("a resumed/in-progress session posts follow-ups directly, never a start-run", async () => {
    const apiClient = buildApiClient();
    const { result } = renderHook(() =>
      useAgentRunLifecycle(
        baseInput(apiClient, {
          agentSessionStatus: AgentSessionStatus.InProgress,
        }),
      ),
    );

    await act(async () => {
      const res = await result.current.sendUserMessage("resume reply");
      expect(res.ok).toBe(true);
    });

    expect(startRunOk).not.toHaveBeenCalled();
    await waitFor(() => {
      expect(submitMessageMock).toHaveBeenCalledTimes(1);
    });
    const data = submitMessageMock.mock.calls[0]![0].intent.data as Record<
      string,
      unknown
    >;
    expect((data.agentInput as Record<string, unknown>).userMessage).toBe(
      "resume reply",
    );
  });
});
