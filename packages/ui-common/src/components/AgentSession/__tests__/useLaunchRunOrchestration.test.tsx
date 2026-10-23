import React from "react";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MessageType, WorkflowName } from "../../../api/index";
import type { RunContextMetadata } from "../../../api";
import { agentSessionKeys } from "../../../data/collections/agentSessions";
import type { PlatformMessagePoster } from "../runtime/hooks/submitFreeformViaPlatform";
import type { PendingTaskContext } from "../runtime";
import { useLaunchRunOrchestration } from "../useLaunchRunOrchestration";

type LaunchPlatformClient = PlatformMessagePoster;

const { startSessionMock, submitControllerAuthorizedWorkflowAnswerMock } =
  vi.hoisted(() => ({
    startSessionMock: vi.fn(),
    submitControllerAuthorizedWorkflowAnswerMock: vi.fn(),
  }));

vi.mock("../operations/useAgentSessionInteractionAccess", () => ({
  useAgentSessionInteractionAccessResolver: () => ({
    getAccess: () => ({
      isDeviceEnabled: true,
      interactions: {
        startSession: startSessionMock,
        submitMessage: vi.fn(),
      },
      unavailable: null,
    }),
  }),
}));

vi.mock("../../../data/hooks/submitControllerAuthorizedWorkflowAnswer", () => ({
  submitControllerAuthorizedWorkflowAnswer: (input: Record<string, unknown>) =>
    submitControllerAuthorizedWorkflowAnswerMock(input),
}));

const buildPlatformClient = (): {
  apiClient: LaunchPlatformClient;
  postMessage: ReturnType<typeof vi.fn>;
} => {
  const postMessage = vi.fn().mockResolvedValue(undefined);
  return {
    apiClient: { postMessage },
    postMessage,
  };
};

const renderLaunch = (
  overrides: {
    apiClient?: LaunchPlatformClient;
    projectId?: string;
    agentSessionId?: string;
    conversationId?: string;
    organizationId?: string | null;
    workflowName?: WorkflowName;
    queryClient?: QueryClient;
  } = {}
) => {
  const apiClient = overrides.apiClient;
  const queryClient = overrides.queryClient ?? new QueryClient();
  const { result } = renderHook(() =>
    useLaunchRunOrchestration({
      organizationId: overrides.organizationId ?? "org-1",
      ...(apiClient ? { apiClient } : {}),
      projectId: overrides.projectId ?? "proj-1",
      agentSessionId: overrides.agentSessionId ?? "as-1",
      conversationId: overrides.conversationId ?? "conv-1",
      workflowName: overrides.workflowName ?? WorkflowName.FeatureSync,
    }),
    {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      ),
    }
  );
  return { launch: result.current };
};

const buildStartRunInput = () => {
  const context: PendingTaskContext = { projectId: "proj-1" };
  const contextMetadata: RunContextMetadata = {
    capturedAt: "2026-05-27T00:00:00.000Z",
    organizationId: "org-1",
    projectId: "proj-1",
    agentSessionId: "as-1",
    userComments: [],
    fileReferences: { resolved: [], unresolved: [] },
  };
  return {
    kind: "handler" as const,
    context,
    contextMetadata,
    conversationId: "conv-1",
    machineId: "machine-1",
    serviceIds: ["svc-1"],
    launchServiceId: "svc-1",
    provider: "claude" as const,
    promptType: "startup_session" as const,
    payload: { foo: "bar" } as never,
    model: "claude-opus-4-7",
    reasoningEffort: "medium" as const,
  };
};

describe("useLaunchRunOrchestration.startRun (platform start-run)", () => {
  beforeEach(() => {
    startSessionMock.mockReset();
    startSessionMock.mockResolvedValue({
      operationId: "operation-1",
      fingerprint: "fingerprint-1",
      kind: "start_run",
      state: "succeeded",
      messageId: "message-1",
      triggerMessageId: "msg-1",
    });
    submitControllerAuthorizedWorkflowAnswerMock.mockReset();
    submitControllerAuthorizedWorkflowAnswerMock.mockResolvedValue(undefined);
  });

  it("passes a ConversationStartRunRequestDto to durable operation dispatch and returns the ack", async () => {
    const { apiClient } = buildPlatformClient();
    const { launch } = renderLaunch({ apiClient });

    const out = await launch.startRun(buildStartRunInput());

    expect(out).toEqual({
      ok: true,
      dispatched: true,
      triggerMessageId: "msg-1",
    });
    expect(startSessionMock).toHaveBeenCalledTimes(1);
    expect(startSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        conversationId: "conv-1",
        agentSessionId: "as-1",
        intent: expect.objectContaining({
          handlerPromptType: "startup_session",
          attachments: [],
          model: "claude-opus-4-7",
          reasoningEffort: "medium",
          provider: "claude",
          serviceIds: ["svc-1"],
          launchServiceId: "svc-1",
          contextMetadata: expect.objectContaining({ agentSessionId: "as-1" }),
        }),
      })
    );
  });

  it("preserves supplied file references in the launch operation intent", async () => {
    const { apiClient } = buildPlatformClient();
    const { launch } = renderLaunch({ apiClient });
    const attachments = [{ attachmentId: "11111111-1111-4111-8111-111111111111", fileName: "notes.md" }];
    await launch.startRun({ ...buildStartRunInput(), attachments });
    expect(startSessionMock).toHaveBeenCalledWith(expect.objectContaining({
      intent: expect.objectContaining({ attachments }),
    }));
  });

  it("forwards the exact entity-scoped workflow materialization request", async () => {
    const { apiClient } = buildPlatformClient();
    const { launch } = renderLaunch({ apiClient });
    const input = buildStartRunInput();

    const out = await launch.startRun({
      attachments: [],
      kind: "workflow",
      context: input.context,
      contextMetadata: input.contextMetadata,
      conversationId: input.conversationId,
      machineId: input.machineId,
      serviceIds: input.serviceIds,
      launchServiceId: input.launchServiceId,
      provider: input.provider,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      workflowName: WorkflowName.FeatureSync,
      payload: {
        promptType: "workflow_kickoff",
        entity: {
          entityType: "TASK",
          entityId: "11111111-1111-4111-8111-111111111111",
        },
        userMessage: "Plan this task",
      },
    });

    expect(out.ok).toBe(true);
    expect(startSessionMock.mock.calls[0][0].intent).toEqual({
      workflowName: WorkflowName.FeatureSync,
      payload: {
        promptType: "workflow_kickoff",
        entity: {
          entityType: "TASK",
          entityId: "11111111-1111-4111-8111-111111111111",
        },
        userMessage: "Plan this task",
      },
      model: "claude-opus-4-7",
      reasoningEffort: "medium",
      provider: "claude",
      contextMetadata: input.contextMetadata,
      serviceIds: ["svc-1"],
      launchServiceId: "svc-1",
    });
    expect(startSessionMock.mock.calls[0][0]).toEqual(
      expect.objectContaining({ agentSessionId: "as-1" })
    );
    expect(startSessionMock.mock.calls[0][0]).not.toHaveProperty("machineId");
  });

  it("keeps an explicitly unscoped workflow materialization request unscoped", async () => {
    const { apiClient } = buildPlatformClient();
    const { launch } = renderLaunch({ apiClient });
    const input = buildStartRunInput();

    const out = await launch.startRun({
      attachments: [],
      kind: "workflow",
      context: input.context,
      contextMetadata: input.contextMetadata,
      conversationId: input.conversationId,
      machineId: input.machineId,
      serviceIds: input.serviceIds,
      launchServiceId: input.launchServiceId,
      provider: input.provider,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      workflowName: WorkflowName.FeatureSync,
      payload: {
        promptType: "workflow_kickoff",
        userMessage: "Start without an entity",
      },
    });

    expect(out.ok).toBe(true);
    const request = startSessionMock.mock.calls[0][0].intent;
    expect(request.payload).toEqual({
      promptType: "workflow_kickoff",
      userMessage: "Start without an entity",
    });
    expect(request.payload).not.toHaveProperty("entity");
    expect(request.contextMetadata).toEqual(input.contextMetadata);
  });

  it("preserves a bind-only workflow launch without fabricating a kickoff payload", async () => {
    const { apiClient } = buildPlatformClient();
    const { launch } = renderLaunch({ apiClient });
    const input = buildStartRunInput();

    const out = await launch.startRun({
      attachments: [],
      kind: "workflow",
      context: input.context,
      contextMetadata: input.contextMetadata,
      conversationId: input.conversationId,
      machineId: input.machineId,
      serviceIds: input.serviceIds,
      launchServiceId: input.launchServiceId,
      provider: input.provider,
      model: input.model,
      reasoningEffort: input.reasoningEffort,
      workflowName: WorkflowName.PlanFromDesignDoc,
    });

    expect(out.ok).toBe(true);
    const request = startSessionMock.mock.calls[0][0].intent;
    expect(request.workflowName).toBe(WorkflowName.PlanFromDesignDoc);
    expect(request).not.toHaveProperty("handlerPromptType");
    expect(request).not.toHaveProperty("payload");
    expect(request.contextMetadata).toEqual(input.contextMetadata);
  });

  it("returns ok:false with the error message when the platform call rejects", async () => {
    const { apiClient } = buildPlatformClient();
    startSessionMock.mockResolvedValueOnce({
      operationId: "operation-1",
      fingerprint: "fingerprint-1",
      kind: "start_run",
      state: "failed",
      code: "FAILED",
      message: "boom",
    });
    const { launch } = renderLaunch({ apiClient });

    const out = await launch.startRun(buildStartRunInput());
    expect(out).toEqual({ ok: false, error: "boom", code: "FAILED" });
  });

  it("propagates the structured NO_CLI_CONNECTION code from the 400 error body", async () => {
    const { apiClient } = buildPlatformClient();
    startSessionMock.mockResolvedValueOnce({
      operationId: "operation-1",
      fingerprint: "fingerprint-1",
      kind: "start_run",
      state: "failed",
      code: "NO_CLI_CONNECTION",
      message: "Conversation owner has no active CLI websocket connection",
    });
    const { launch } = renderLaunch({ apiClient });

    const out = await launch.startRun(buildStartRunInput());
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.code).toBe("NO_CLI_CONNECTION");
    }
  });

  it("returns ok:false when the platform client is not wired in", async () => {
    const { launch } = renderLaunch({});

    const out = await launch.startRun(buildStartRunInput());
    expect(out.ok).toBe(true);
  });

  it("returns ok:false with a missing-fields error when required DTO fields are absent", async () => {
    const { apiClient } = buildPlatformClient();
    const { launch } = renderLaunch({ apiClient });

    const input = buildStartRunInput();
    // Drop the required model field to exercise the runtime guard.
    delete (input as { model?: string }).model;

    const out = await launch.startRun(input);
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/required fields missing.*model/);
    }
    expect(startSessionMock).not.toHaveBeenCalled();
  });

  it("forwards a USER initialMessage (coding kickoff seed) onto the DTO", async () => {
    const { apiClient } = buildPlatformClient();
    const { launch } = renderLaunch({ apiClient });

    const out = await launch.startRun({
      ...buildStartRunInput(),
      initialMessage: { role: MessageType.User },
    });

    expect(out.ok).toBe(true);
    const request = startSessionMock.mock.calls[0][0].intent;
    expect(request.initialMessage).toEqual({
      role: MessageType.User,
    });
  });

  it("forwards a SYSTEM initialMessage (refiner greeting seed) onto the DTO", async () => {
    const { apiClient } = buildPlatformClient();
    const { launch } = renderLaunch({ apiClient });

    const out = await launch.startRun({
      ...buildStartRunInput(),
      initialMessage: {
        role: MessageType.System,
        text: 'How can I help you refine "Ship it"?',
      },
    });

    expect(out.ok).toBe(true);
    const request = startSessionMock.mock.calls[0][0].intent;
    expect(request.initialMessage).toEqual({
      role: MessageType.System,
      text: 'How can I help you refine "Ship it"?',
    });
  });

  it("omits initialMessage from the DTO when no seed is supplied", async () => {
    const { apiClient } = buildPlatformClient();
    const { launch } = renderLaunch({ apiClient });

    const out = await launch.startRun(buildStartRunInput());

    expect(out.ok).toBe(true);
    const request = startSessionMock.mock.calls[0][0].intent;
    expect(request).not.toHaveProperty("initialMessage");
  });

  it("preserves explicit Fast mode booleans and omission on the start-run DTO", async () => {
    const { apiClient } = buildPlatformClient();
    const { launch } = renderLaunch({ apiClient });

    await launch.startRun({ ...buildStartRunInput(), fastMode: true });
    await launch.startRun({ ...buildStartRunInput(), fastMode: false });
    await launch.startRun(buildStartRunInput());

    expect(startSessionMock.mock.calls[0][0].intent.fastMode).toBe(true);
    expect(startSessionMock.mock.calls[1][0].intent.fastMode).toBe(false);
    expect(startSessionMock.mock.calls[2][0].intent).not.toHaveProperty(
      "fastMode"
    );
  });

  it("forwards the selected worktree branch onto the start-run DTO", async () => {
    const { apiClient } = buildPlatformClient();
    const { launch } = renderLaunch({ apiClient });

    const out = await launch.startRun({
      ...buildStartRunInput(),
      worktree: { enabled: true, branch: "feature/worktree" },
    });

    expect(out.ok).toBe(true);
    const request = startSessionMock.mock.calls[0][0].intent;
    expect(request.worktree).toEqual({
      enabled: true,
      branch: "feature/worktree",
    });
  });

  it("starts a run successfully when reasoningEffort is not provided (OpenCode)", async () => {
    const { apiClient } = buildPlatformClient();
    const { launch } = renderLaunch({ apiClient });

    const input = buildStartRunInput();
    // Delete reasoningEffort to simulate providers like OpenCode that don't support it
    delete (input as { reasoningEffort?: string }).reasoningEffort;

    const out = await launch.startRun(input);
    expect(out.ok).toBe(true);
    expect(startSessionMock).toHaveBeenCalledTimes(1);
    const request = startSessionMock.mock.calls[0][0].intent;
    // Verify reasoningEffort has a default value and is still sent to the platform
    expect(request).toHaveProperty("reasoningEffort");
    // Verify other required fields are still present
    expect(request.model).toBe("claude-opus-4-7");
    expect(request.provider).toBe("claude");
  });

  it("does NOT mark the AgentSession query stale when the dispatch is unacknowledged", async () => {
    const queryClient = new QueryClient();
    const detailKey = agentSessionKeys.detail("org-1", "proj-1", "as-other");
    queryClient.setQueryData(detailKey, { id: "as-other" });

    const { apiClient } = buildPlatformClient();
    startSessionMock.mockResolvedValueOnce({
      operationId: "operation-1",
      fingerprint: "fingerprint-1",
      kind: "start_run",
      state: "failed",
      code: "DISPATCH_PENDING",
      message: "The CLI did not acknowledge the operation.",
    });
    const { launch } = renderLaunch({
      apiClient,
      agentSessionId: "as-other",
      queryClient,
    });

    await launch.startRun(buildStartRunInput());

    expect(queryClient.getQueryState(detailKey)?.isInvalidated).toBe(false);
  });

  it("starts a run and omits service fields for non-coding sessions (refiner / entity conversation)", async () => {
    const { apiClient } = buildPlatformClient();
    const { launch } = renderLaunch({ apiClient });

    const input = buildStartRunInput();
    // Refiners carry no service — they operate on the task's text, not a repo —
    // so serviceIds + launchServiceId are omitted entirely rather than sent as
    // an empty array or empty string.
    delete (input as { serviceIds?: string[] }).serviceIds;
    delete (input as { launchServiceId?: string }).launchServiceId;

    const out = await launch.startRun(input);
    expect(out.ok).toBe(true);
    expect(startSessionMock).toHaveBeenCalledTimes(1);
    const request = startSessionMock.mock.calls[0][0].intent;
    expect(request).not.toHaveProperty("serviceIds");
    expect(request).not.toHaveProperty("launchServiceId");
  });
});

describe("useLaunchRunOrchestration.submitNodeDecision (workflow answers)", () => {
  it("submits an authorized workflow answer for Approve", async () => {
    const { apiClient } = buildPlatformClient();
    const { launch } = renderLaunch({ apiClient });

    const requiredServiceIds = ["service-1", "service-2"];
    const userMessageData = {
      stage: "startup-plan",
      requiredServiceIds,
      workflowAnswerNodeId: "node-1",
      workflowAnswerParentMessageId: "message-1",
    };
    const out = await launch.submitNodeDecision(
      "run-1",
      "APPROVED",
      userMessageData
    );

    expect(out).toEqual({ ok: true });
    expect(submitControllerAuthorizedWorkflowAnswerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        agentSessionId: "as-1",
        conversationId: "conv-1",
        workflowName: WorkflowName.FeatureSync,
        nodeId: "node-1",
        parentMessageId: "message-1",
        action: "APPROVED",
        payload: userMessageData,
      })
    );
  });

  it("submits an authorized workflow answer for Reject with evidence", async () => {
    const { apiClient } = buildPlatformClient();
    const { launch } = renderLaunch({ apiClient });

    const out = await launch.submitNodeDecision(
      "run-2",
      "REJECTED",
      {
        stage: "startup-plan",
        workflowAnswerNodeId: "node-2",
        workflowAnswerParentMessageId: "message-2",
      },
      "please tweak the second stage"
    );

    expect(out).toEqual({ ok: true });
    expect(submitControllerAuthorizedWorkflowAnswerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        nodeId: "node-2",
        parentMessageId: "message-2",
        action: "REJECTED",
        payload: {
          stage: "startup-plan",
          workflowAnswerNodeId: "node-2",
          workflowAnswerParentMessageId: "message-2",
        },
        evidence: { comment: "please tweak the second stage" },
      })
    );
  });

  it("omits comment when empty string", async () => {
    const { apiClient } = buildPlatformClient();
    const { launch } = renderLaunch({ apiClient });

    await launch.submitNodeDecision(
      "run-3",
      "APPROVED",
      {
        workflowAnswerNodeId: "node-3",
        workflowAnswerParentMessageId: "message-3",
      },
      ""
    );

    expect(
      submitControllerAuthorizedWorkflowAnswerMock.mock.calls[0]![0]
    ).not.toHaveProperty("evidence");
  });

  it("returns ok:false with the error message when workflow answer submission throws", async () => {
    const { apiClient } = buildPlatformClient();
    submitControllerAuthorizedWorkflowAnswerMock.mockRejectedValueOnce(
      new Error("boom")
    );
    const { launch } = renderLaunch({ apiClient });

    const out = await launch.submitNodeDecision("run-4", "APPROVED", {
      workflowAnswerNodeId: "node-4",
      workflowAnswerParentMessageId: "message-4",
    });
    expect(out).toEqual({ ok: false, error: "boom" });
  });

  it("returns ok:false when the platform client is not wired in", async () => {
    const { launch } = renderLaunch({});

    const out = await launch.submitNodeDecision("run-5", "APPROVED", {});
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/Platform messaging context/);
    }
  });
});
