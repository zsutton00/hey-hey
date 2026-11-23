import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  HostAffectingActionType,
  HostActionTargetKind,
  type ControllerAuthorizedActionSubmission,
  type MachineDto,
} from "../../../api";
import { apiClient } from "../../../clients/client";
import type { ControllerAuthorizedActionVariables } from "../useControllerAuthorizedAction";
import { useCompactRun } from "../useCompactRun";

const { authorize, machine } = vi.hoisted(() => ({
  authorize: vi.fn(),
  machine: {
    machineId: "machine-1",
    name: "Studio Mac",
    pairedAt: "2026-08-01T00:00:00.000Z",
    active: true,
    authorizationProtocolVersion: "V2",
    executionReadiness: "READY",
  } satisfies MachineDto,
}));

vi.mock("../../../clients/client", () => ({
  apiClient: { compactAgentSessionRun: vi.fn() },
}));
vi.mock("../useAgentSession", () => ({
  useAgentSession: () => ({ agentSession: { machineId: machine.machineId } }),
}));
vi.mock("../useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({ machines: [machine] }),
}));
vi.mock("../useControllerAuthorizedAction", () => ({
  useControllerAuthorizedAction: () => ({
    mutate: authorize,
    isPending: false,
  }),
}));

describe("useCompactRun", () => {
  it("authorizes and submits compact_run for the bound current Run", async () => {
    vi.mocked(apiClient.compactAgentSessionRun).mockResolvedValue({} as never);
    authorize.mockImplementation(
      async ({ submit }: ControllerAuthorizedActionVariables<unknown>) => ({
        outcome: "ADMITTED",
        data: await submit({
          authorization: { kind: "bounded_grant", grantId: "grant-1" },
        } satisfies ControllerAuthorizedActionSubmission),
      }),
    );
    const { result } = renderHook(() =>
      useCompactRun("org-1", "project-1", "agent-session-1", "conversation-1"),
    );

    await act(() => result.current());

    const action = authorize.mock.calls[0][0].action;
    expect(action).toMatchObject({
      actionType: HostAffectingActionType.ConversationControlCompactRun,
      targetKind: HostActionTargetKind.AgentSession,
      targetId: "agent-session-1",
      inputs: {
        kind: "CONTROL",
        body: {
          kind: "compact_run",
          agentSessionId: "agent-session-1",
          conversationId: "conversation-1",
          runId: "agent-session-1",
        },
      },
    });
    expect(apiClient.compactAgentSessionRun).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "agent-session-1",
      compactRunRequestDto: {
        authorization: { kind: "bounded_grant", grantId: "grant-1" },
      },
    });
  });

  it("rejects when controller authorization is denied", async () => {
    authorize.mockResolvedValue({ outcome: "DENIED", reason: "EXPIRED" });
    const { result } = renderHook(() =>
      useCompactRun("org-1", "project-1", "agent-session-1", "conversation-1"),
    );
    await expect(result.current()).rejects.toThrow(
      "Controller authorization denied: EXPIRED",
    );
  });
});
