import { describe, expect, it, vi } from "vitest";
import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  MachineExecutionReadinessState,
  type MachineDto,
} from "../../../../api";
import {
  DefaultAgentOperationCoordinator,
  type AgentOperationDependencies,
} from "../AgentOperationCoordinator";

const dependencies = (): AgentOperationDependencies => ({
  fingerprintStart: vi.fn().mockResolvedValue("a".repeat(64)),
  fingerprintMessage: vi.fn().mockResolvedValue("b".repeat(64)),
  startSession: vi.fn(async ({ operationId, fingerprint }) => ({
    operationId,
    fingerprint,
    kind: "start_run" as const,
    state: "succeeded" as const,
    messageId: "message",
    triggerMessageId: "trigger",
  })),
  submitMessage: vi.fn(async ({ operationId, fingerprint }) => ({
    operationId,
    fingerprint,
    kind: "submit_message" as const,
    state: "succeeded" as const,
    messageId: "message",
    triggerMessageId: "trigger",
  })),
  reconcile: vi.fn(),
  requestSubagent: vi.fn().mockResolvedValue(undefined),
});

const machine = (
  currentControllerEligibility: MachineDto["currentControllerEligibility"]
): MachineDto => ({
  machineId: "bound-machine",
  name: "Studio Mac",
  pairedAt: "2026-08-27T00:00:00.000Z",
  active: true,
  authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
  executionReadiness: MachineExecutionReadinessState.Ready,
  currentControllerEligibility,
  bindings: [],
});

describe("DefaultAgentOperationCoordinator", () => {
  it("publishes the same session-bound operation from pending dispatch to acceptance", async () => {
    vi.useFakeTimers();
    try {
      const deps = dependencies();
      deps.startSession = vi.fn(async ({ operationId, fingerprint }) => ({
        operationId, fingerprint, kind: "start_run", state: "dispatch_pending",
      }));
      deps.reconcile = vi.fn(async (operationId) => ({
        operationId, fingerprint: "a".repeat(64), kind: "start_run", state: "succeeded",
        messageId: "message", triggerMessageId: "trigger",
      }));
      const coordinator = new DefaultAgentOperationCoordinator(deps);
      const scope = { organizationId: "org", projectId: "project", agentSessionId: "session", conversationId: "conversation" };
      const listener = vi.fn();
      const unsubscribe = coordinator.launches.subscribe(listener);
      const result = coordinator.startSession({ ...scope, machineId: "machine", intent: {} });
      await vi.advanceTimersByTimeAsync(0);
      const pending = coordinator.launches.get(scope);
      expect(pending).toMatchObject({ phase: "dispatching", operation: { state: "dispatch_pending" } });
      expect(coordinator.launches.get({ ...scope, conversationId: "other" })).toBeNull();
      unsubscribe();
      await vi.advanceTimersByTimeAsync(500);
      await result;
      expect(coordinator.launches.get(scope)).toMatchObject({
        phase: "accepted", operation: { operationId: pending?.operation?.operationId, state: "succeeded" },
      });
      expect(deps.startSession).toHaveBeenCalledTimes(1);
      expect(deps.reconcile).toHaveBeenCalledWith(pending?.operation?.operationId);
      expect(listener).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retains a server-reserved operation identity across coordinator remounts", async () => {
    const deps = dependencies();
    const input = { organizationId: "org", projectId: "project", agentSessionId: "session", conversationId: "conversation", machineId: "machine", intent: {}, operationId: "persisted-routing-operation" };
    await new DefaultAgentOperationCoordinator(deps).startSession(input);
    await new DefaultAgentOperationCoordinator(deps).startSession(input);
    expect(deps.startSession).toHaveBeenCalledTimes(2);
    for (const [call] of vi.mocked(deps.startSession).mock.calls) {
      expect(call.operationId).toBe(input.operationId);
      expect(call.fingerprint).toBe("a".repeat(64));
    }
  });
  it("exposes only machine-bound interactions for the eligible controller device", async () => {
    const deps = dependencies();
    const coordinator = new DefaultAgentOperationCoordinator(deps);
    const access = coordinator.accessForMachine(
      machine(CurrentControllerMachineEligibilityState.Eligible)
    );

    expect(access.isDeviceEnabled).toBe(true);
    if (!access.isDeviceEnabled) throw new Error("Expected enabled access.");
    expect(Object.keys(access.interactions).sort()).toEqual([
      "requestSubagent",
      "startSession",
      "submitMessage",
    ]);
    await access.interactions.submitMessage({
      organizationId: "org",
      projectId: "project",
      agentSessionId: "session",
      conversationId: "conversation",
      intent: {
        projectId: "project",
        conversationId: "conversation",
        parentMessageId: null,
        data: {},
      },
    });

    expect(deps.submitMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({ machineId: "bound-machine" }),
      })
    );

    await access.interactions.requestSubagent({
      organizationId: "org",
      projectId: "project",
      agentSessionId: "session",
      runId: "session",
      interactionId: "interaction",
      intent: {
        kind: "subagent",
        mode: "background",
        capability: "research",
        objective: "Inspect",
      },
      serviceIds: [],
    });
    // Child work is authorized on the same current-device machine.
    expect(deps.requestSubagent).toHaveBeenCalledWith(
      expect.objectContaining({
        agentSessionId: "session",
        machine: expect.objectContaining({ machineId: "bound-machine" }),
      })
    );
  });

  it.each([
    null,
    CurrentControllerMachineEligibilityState.NotEnrolled,
    CurrentControllerMachineEligibilityState.Revoked,
  ])("exposes no executable interactions for %s eligibility", (eligibility) => {
    const coordinator = new DefaultAgentOperationCoordinator(dependencies());
    expect(coordinator.accessForMachine(machine(eligibility))).toMatchObject({
      isDeviceEnabled: false,
      interactions: null,
      unavailable: { type: "machine_not_ready" },
    });
  });
  it("creates a fresh operation identity for each user gesture", async () => {
    const deps = dependencies();
    const coordinator = new DefaultAgentOperationCoordinator(deps);
    const input = {
      organizationId: "org",
      projectId: "project",
      agentSessionId: "session",
      conversationId: "conversation",
      machineId: "machine",
      intent: {},
    };
    const first = await coordinator.startSession(input);
    const second = await coordinator.startSession(input);
    expect(first.operationId).not.toBe(second.operationId);
    expect(deps.startSession).toHaveBeenCalledTimes(2);
    expect(coordinator.observe(first.operationId)).toEqual(first);
  });

  it("closes a failed operation instead of retrying semantic work", async () => {
    const deps = dependencies();
    vi.mocked(deps.startSession).mockRejectedValueOnce(
      new Error("transport failed")
    );
    const coordinator = new DefaultAgentOperationCoordinator(deps);
    const result = await coordinator.startSession({
      organizationId: "org",
      projectId: "project",
      agentSessionId: "session",
      conversationId: "conversation",
      machineId: "machine",
      intent: {},
    });
    expect(result.state).toBe("failed");
    expect(deps.startSession).toHaveBeenCalledTimes(1);
  });

  it("reconciles the same identity after an ambiguous transport failure", async () => {
    const deps = dependencies();
    vi.mocked(deps.startSession).mockRejectedValueOnce(
      new Error("transport timed out")
    );
    vi.mocked(deps.reconcile).mockImplementationOnce(async (operationId) => ({
      operationId,
      fingerprint: "a".repeat(64),
      kind: "start_run",
      state: "succeeded",
      messageId: "message",
      triggerMessageId: "trigger",
    }));
    const coordinator = new DefaultAgentOperationCoordinator(deps);

    const result = await coordinator.startSession({
      organizationId: "org",
      projectId: "project",
      agentSessionId: "session",
      conversationId: "conversation",
      machineId: "machine",
      intent: {},
    });

    expect(result.state).toBe("succeeded");
    expect(deps.reconcile).toHaveBeenCalledWith(result.operationId);
    expect(deps.startSession).toHaveBeenCalledTimes(1);
  });

  it("keeps dispatch-pending work live and reconciles the prepared identity", async () => {
    vi.useFakeTimers();
    try {
      const deps = dependencies();
      vi.mocked(deps.submitMessage).mockImplementationOnce(
        async ({ operationId, fingerprint }) => ({
          operationId,
          fingerprint,
          kind: "submit_message",
          state: "dispatch_pending",
        })
      );
      vi.mocked(deps.reconcile).mockImplementationOnce(async (operationId) => ({
        operationId,
        fingerprint: "b".repeat(64),
        kind: "submit_message",
        state: "succeeded",
        messageId: "message",
        triggerMessageId: "trigger",
      }));
      const coordinator = new DefaultAgentOperationCoordinator(deps);
      const resultPromise = coordinator.submitMessage({
        organizationId: "org",
        projectId: "project",
        agentSessionId: "session",
        conversationId: "conversation",
        machineId: "machine",
        intent: {
          projectId: "project",
          conversationId: "conversation",
          parentMessageId: null,
          data: {},
        },
      });

      await vi.advanceTimersByTimeAsync(500);
      await expect(resultPromise).resolves.toMatchObject({
        state: "succeeded",
      });
      expect(deps.reconcile).toHaveBeenCalledTimes(1);
      expect(deps.submitMessage).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps committed work live through transient reconciliation failures", async () => {
    vi.useFakeTimers();
    try {
      const deps = dependencies();
      vi.mocked(deps.submitMessage).mockImplementationOnce(
        async ({ operationId, fingerprint }) => ({
          operationId,
          fingerprint,
          kind: "submit_message",
          state: "dispatch_pending",
        })
      );
      vi.mocked(deps.reconcile)
        .mockRejectedValueOnce(new Error("temporary network failure"))
        .mockRejectedValueOnce(new Error("temporary network failure"))
        .mockImplementationOnce(async (operationId) => ({
          operationId,
          fingerprint: "b".repeat(64),
          kind: "submit_message",
          state: "succeeded",
          messageId: "message",
          triggerMessageId: "trigger",
        }));
      const coordinator = new DefaultAgentOperationCoordinator(deps);
      const resultPromise = coordinator.submitMessage({
        organizationId: "org",
        projectId: "project",
        agentSessionId: "session",
        conversationId: "conversation",
        machineId: "machine",
        intent: {
          projectId: "project",
          conversationId: "conversation",
          parentMessageId: null,
          data: {},
        },
      });

      await vi.advanceTimersByTimeAsync(1_500);
      await expect(resultPromise).resolves.toMatchObject({
        state: "succeeded",
      });
      expect(deps.reconcile).toHaveBeenCalledTimes(3);
      expect(deps.submitMessage).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
