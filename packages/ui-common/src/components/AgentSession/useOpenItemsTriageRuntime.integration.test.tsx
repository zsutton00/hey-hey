import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import {
  OpenItemsTriageMode,
  type AgentSessionDto,
  type MachineDto,
} from "../../api";
import { useOpenItemsTriageRuntime } from "./useOpenItemsTriageRuntime";

const mocks = vi.hoisted(() => ({
  bind: vi.fn(),
  start: vi.fn(),
  submit: vi.fn(),
  access: vi.fn(),
}));
const machine: MachineDto = {
  machineId: "machine",
  name: "Ready CLI",
  pairedAt: "2026-10-14T00:00:00Z",
  active: true,
  authorizationProtocolVersion: 2,
  executionReadiness: "READY",
  currentControllerEligibility: "ELIGIBLE",
  bindings: [],
};
vi.mock("../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({ machines: [machine], isReady: true }),
}));
vi.mock(
  "../InteractionComponent/bindGraphConversationAgentSessionMachine",
  () => ({ bindGraphConversationAgentSessionMachine: mocks.bind }),
);
vi.mock("./operations/useAgentSessionInteractionAccess", () => ({
  useAgentSessionInteractionAccess: () => ({
    isDeviceEnabled: true,
    interactions: { submitMessage: mocks.submit },
  }),
  useAgentSessionInteractionAccessResolver: () => ({ getAccess: mocks.access }),
}));
const session: AgentSessionDto = {
  id: "session",
  organizationId: "org",
  projectId: "project",
  userId: "user",
  conversationId: "conversation",
  machineId: null,
  status: "NOT_STARTED",
  currentState: "IDLE",
  type: "PROJECT_CONVERSATION",
  title: "Open Items triage",
  sessionDate: "2026-10-14",
  hasUnsyncedChanges: false,
  monitoringEnabled: false,
  autoDecide: false,
};
const chosen = {
  machineId: "machine",
  runtime: {
    provider: "codex" as const,
    model: "gpt-6-luna",
    reasoningEffort: "xhigh" as const,
    fastMode: false,
  },
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.bind.mockResolvedValue(undefined);
  mocks.access.mockReturnValue({
    isDeviceEnabled: true,
    interactions: { startSession: mocks.start },
  });
  mocks.start.mockResolvedValue({
    state: "accepted",
    triggerMessageId: "trigger",
  });
  mocks.submit.mockResolvedValue({ state: "succeeded", messageId: "message" });
});
it("binds before the real lifecycle authorizes a typed first run, then sends typed follow-ups", async () => {
  let completeBinding: (() => void) | undefined;
  mocks.bind.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        completeBinding = resolve;
      }),
  );
  const { result } = renderHook(() =>
    useOpenItemsTriageRuntime("org", "project", session, {
      ...chosen,
      mode: OpenItemsTriageMode.SpringCleaning,
      guidance: "Close stale bugs",
    }),
  );
  await waitFor(() => expect(result.current.ready).toBe(true));
  let sending: Promise<void> | undefined;
  act(() => {
    sending = result.current.send("freshPass", "");
  });
  expect(mocks.start).not.toHaveBeenCalled();
  expect(result.current.pending).toBe(true);
  await act(async () => {
    completeBinding?.();
    await sending;
  });
  expect(mocks.access).toHaveBeenCalledWith("machine");
  expect(mocks.start).toHaveBeenCalledWith(
    expect.objectContaining({
      agentSessionId: "session",
      conversationId: "conversation",
      intent: expect.objectContaining({
        attachments: [],
        handlerPromptType: "open_items_triage",
        ...chosen.runtime,
        payload: {
          promptType: "open_items_triage",
          projectId: "project",
          requestKind: "freshPass",
          mode: "springCleaning",
          userMessage: "Close stale bugs",
          entity: { entityType: "PROJECT", entityId: "project" },
        },
      }),
    }),
  );
  await act(async () => {
    await result.current.send("followUp", "Keep active work");
  });
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.submit).toHaveBeenCalledWith(
    expect.objectContaining({
      intent: expect.objectContaining({
        data: expect.objectContaining({
          agentInput: expect.objectContaining({
            requestKind: "followUp",
            mode: "springCleaning",
            userMessage: "Keep active work",
            guidance: "Close stale bugs",
          }),
        }),
      }),
    }),
  );
});
it.each([
  [
    "Fast mode turned on",
    {
      provider: "codex" as const,
      model: "gpt-6-luna",
      reasoningEffort: "max" as const,
      fastMode: true,
    },
    { reasoningEffort: "max", fastMode: true },
    [],
  ],
  [
    "a model with no effort levels",
    {
      provider: "opencode" as const,
      model: "opencode-default",
      reasoningEffort: null,
    },
    {},
    ["reasoningEffort", "fastMode"],
  ],
])(
  "starts the run on exactly the chosen runtime with %s",
  async (_case, runtime, sent, omitted) => {
    const { result } = renderHook(() =>
      useOpenItemsTriageRuntime("org", "project", session, {
        machineId: "machine",
        runtime,
        mode: OpenItemsTriageMode.TidyUp,
        guidance: "",
      }),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.send("freshPass", "");
    });
    const [{ intent }] = mocks.start.mock.calls[0];
    expect(intent).toMatchObject({
      provider: runtime.provider,
      model: runtime.model,
      ...sent,
    });
    for (const field of omitted) {
      expect(intent).not.toHaveProperty(field);
    }
    expect(mocks.access).toHaveBeenCalledWith("machine");
  },
);
it("surfaces an authorization failure and can retry the launch", async () => {
  mocks.start.mockResolvedValueOnce({
    state: "failed",
    message: "Authorization denied",
    code: "DENIED",
  });
  const { result } = renderHook(() =>
    useOpenItemsTriageRuntime("org", "project", session, {
      ...chosen,
      mode: OpenItemsTriageMode.SpringCleaning,
      guidance: "Close stale bugs",
    }),
  );
  await waitFor(() => expect(result.current.ready).toBe(true));
  await act(async () => {
    await expect(result.current.send("freshPass", "")).rejects.toThrow(
      "Authorization denied",
    );
  });
  expect(result.current.error).toBe("Authorization denied");
  expect(result.current.pending).toBe(false);
  await act(async () => {
    await result.current.send("freshPass", "");
  });
  expect(mocks.start).toHaveBeenCalledTimes(2);
  expect(mocks.start.mock.calls[1][0].intent).toMatchObject(chosen.runtime);
  expect(result.current.error).toBeNull();
});
