import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OpenItemsTriageMode,
  type AgentSessionDto,
  type MachineDto,
} from "../../api";
import { useOpenItemsTriageRuntime } from "./useOpenItemsTriageRuntime";

const mocks = vi.hoisted(() => ({
  bind: vi.fn(),
  send: vi.fn(),
  machines: [] as MachineDto[],
  lifecycleInput: vi.fn(),
}));

vi.mock(
  "../InteractionComponent/bindGraphConversationAgentSessionMachine",
  () => ({
    bindGraphConversationAgentSessionMachine: mocks.bind,
  }),
);
vi.mock("../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({ machines: mocks.machines, isReady: true }),
}));
vi.mock("./runtime/hooks/useCliRequired", () => ({
  useCliRequired: () => {
    throw new Error("Unbound startup cannot depend on conversation CLI status");
  },
}));
vi.mock("./useLaunchRunOrchestration", () => ({
  useLaunchRunOrchestration: () => ({}),
}));
vi.mock("./useAgentRunLifecycle", () => ({
  useAgentRunLifecycle: (input: unknown) => {
    mocks.lifecycleInput(input);
    return {
      sendUserMessage: mocks.send,
      stopRun: vi.fn(),
      stoppingRun: false,
    };
  },
}));

const session: AgentSessionDto = {
  id: "session-1",
  organizationId: "org-1",
  projectId: "project-1",
  userId: "user-1",
  conversationId: "conversation-1",
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

const tidyUp = { mode: OpenItemsTriageMode.TidyUp, guidance: "" };

describe("useOpenItemsTriageRuntime machine binding", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bind.mockResolvedValue(session);
    mocks.send.mockResolvedValue({ ok: true, messageId: "message-1" });
    mocks.machines = [
      {
        machineId: "machine-1",
        name: "Ready CLI",
        pairedAt: "2026-10-14T00:00:00Z",
        active: true,
        authorizationProtocolVersion: 2,
        executionReadiness: "READY",
        currentControllerEligibility: "ELIGIBLE",
        bindings: [],
      },
    ];
  });

  it("waits for the ready machine binding before dispatching the first pass", async () => {
    let finishBinding: (() => void) | undefined;
    mocks.bind.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishBinding = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useOpenItemsTriageRuntime("org-1", "project-1", session, tidyUp),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(mocks.lifecycleInput).toHaveBeenLastCalledWith(
      expect.objectContaining({ machineId: "machine-1" }),
    );
    let request: Promise<{ messageId: string } | null> | undefined;
    act(() => {
      request = result.current.send("freshPass", "");
    });
    expect(mocks.bind).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      machineId: "machine-1",
    });
    expect(result.current.pending).toBe(true);
    expect(mocks.send).not.toHaveBeenCalled();
    await act(async () => {
      finishBinding?.();
      await expect(request).resolves.toEqual({ messageId: "message-1" });
    });
    expect(mocks.send).toHaveBeenCalledWith("", undefined, []);
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("surfaces binding failure without dispatch and permits retry", async () => {
    mocks.bind.mockRejectedValueOnce(new Error("Binding denied"));
    const { result } = renderHook(() =>
      useOpenItemsTriageRuntime("org-1", "project-1", session, tidyUp),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await expect(result.current.send("freshPass", "")).rejects.toThrow(
        "Binding denied",
      );
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(result.current.error).toBe("Binding denied");
    expect(result.current.pending).toBe(false);
    await act(async () => {
      await result.current.send("freshPass", "");
    });
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(result.current.error).toBeNull();
  });

  it("resumes an already bound session without rebinding", async () => {
    const { result } = renderHook(() =>
      useOpenItemsTriageRuntime(
        "org-1",
        "project-1",
        {
          ...session,
          machineId: "machine-1",
          status: "IN_PROGRESS",
        },
        tidyUp,
      ),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.send("followUp", "Keep this item");
    });
    expect(mocks.bind).not.toHaveBeenCalled();
    expect(mocks.send).toHaveBeenCalledWith("Keep this item", undefined, []);
  });

  it("rejects dispatch when no CLI machine is ready", async () => {
    mocks.machines = [];
    const { result } = renderHook(() =>
      useOpenItemsTriageRuntime("org-1", "project-1", session, tidyUp),
    );
    await act(async () => {
      await expect(result.current.send("freshPass", "")).rejects.toThrow(
        "ready CLI machine",
      );
    });
    expect(mocks.bind).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
    expect(result.current.pending).toBe(false);
  });

  it("requires a choice among ready machines before binding and starting", async () => {
    mocks.machines.push({
      ...mocks.machines[0],
      machineId: "machine-2",
      name: "Second CLI",
    });
    const { result } = renderHook(() =>
      useOpenItemsTriageRuntime("org-1", "project-1", session, tidyUp),
    );
    expect(result.current.ready).toBe(false);
    expect(mocks.bind).not.toHaveBeenCalled();
    act(() => result.current.machines.setSelectedMachineId("machine-2"));
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.send("freshPass", "");
    });
    expect(mocks.bind).toHaveBeenCalledWith(
      expect.objectContaining({ machineId: "machine-2" }),
    );
    expect(mocks.lifecycleInput).toHaveBeenLastCalledWith(
      expect.objectContaining({ machineId: "machine-2" }),
    );
    expect(mocks.send).toHaveBeenCalledOnce();
  });
});

describe("useOpenItemsTriageRuntime mode and guidance", () => {
  const lastTurn = (text: string) => {
    const input = mocks.lifecycleInput.mock.calls.at(-1)?.[0] as {
      buildHandlerTurn: (text: string) => unknown;
    };
    return input.buildHandlerTurn(text);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.bind.mockResolvedValue(session);
    mocks.send.mockResolvedValue({ ok: true, messageId: "message-1" });
    mocks.machines = [
      {
        machineId: "machine-1",
        name: "Ready CLI",
        pairedAt: "2026-10-14T00:00:00Z",
        active: true,
        authorizationProtocolVersion: 2,
        executionReadiness: "READY",
        currentControllerEligibility: "ELIGIBLE",
        bindings: [],
      },
    ];
  });

  it.each([OpenItemsTriageMode.TidyUp, OpenItemsTriageMode.SpringCleaning])(
    "sends %s with the guidance as the message on a fresh pass",
    async (mode) => {
      const { result } = renderHook(() =>
        useOpenItemsTriageRuntime("org-1", "project-1", session, {
          mode,
          guidance: "  Focus on stale bugs  ",
        }),
      );
      await waitFor(() => expect(result.current.ready).toBe(true));
      await act(async () => {
        await result.current.send("freshPass", "");
      });
      expect(lastTurn("")).toEqual({
        promptType: "open_items_triage",
        projectId: "project-1",
        requestKind: "freshPass",
        mode,
        userMessage: "Focus on stale bugs",
        entity: { entityType: "PROJECT", entityId: "project-1" },
      });
    },
  );

  it("accepts a fresh pass without guidance", async () => {
    const { result } = renderHook(() =>
      useOpenItemsTriageRuntime("org-1", "project-1", session, {
        mode: OpenItemsTriageMode.SpringCleaning,
        guidance: "",
      }),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.send("freshPass", "");
    });
    expect(lastTurn("")).toEqual(
      expect.objectContaining({
        requestKind: "freshPass",
        mode: OpenItemsTriageMode.SpringCleaning,
        userMessage: "",
      }),
    );
    expect(lastTurn("")).not.toHaveProperty("guidance");
  });

  it("keeps the mode and sends guidance separately on a follow-up", async () => {
    const { result } = renderHook(() =>
      useOpenItemsTriageRuntime("org-1", "project-1", session, {
        mode: OpenItemsTriageMode.SpringCleaning,
        guidance: "Focus on stale bugs",
      }),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.send("followUp", "Keep this item");
    });
    expect(lastTurn("Keep this item")).toEqual({
      promptType: "open_items_triage",
      projectId: "project-1",
      requestKind: "followUp",
      mode: OpenItemsTriageMode.SpringCleaning,
      userMessage: "Keep this item",
      guidance: "Focus on stale bugs",
      entity: { entityType: "PROJECT", entityId: "project-1" },
    });
  });

  it("omits guidance on a follow-up when the review started without any", async () => {
    const { result } = renderHook(() =>
      useOpenItemsTriageRuntime("org-1", "project-1", session, tidyUp),
    );
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => {
      await result.current.send("followUp", "Keep this item");
    });
    expect(lastTurn("Keep this item")).not.toHaveProperty("guidance");
  });
});
