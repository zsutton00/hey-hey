import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentSessionContinuationMode,
  AgentSessionContinuationState,
} from "../../../api";

const status = vi.hoisted(() => vi.fn());

vi.mock("../../../data/hooks/useAgentSessionContinuationStatus", () => ({
  useAgentSessionContinuationStatus: status,
}));
vi.mock("../../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({
    machines: [
      { machineId: "m-a", name: "Mac A" },
      { machineId: "m-b", name: "Mac B" },
    ],
  }),
}));
vi.mock("../useAgentSessionContinuation", () => ({
  useAgentSessionContinuation: () => ({ phase: { kind: "idle" } }),
}));

import { useAgentSessionContinuationRecovery } from "../useAgentSessionContinuationRecovery";

const readOutcome = (boundMachineId: string) => {
  status.mockReturnValue({
    isLoading: false,
    error: null,
    data: {
      boundMachineId,
      sourceState: "SOURCE_ACTIVE",
      attempt: {
        state: AgentSessionContinuationState.Succeeded,
        mode: AgentSessionContinuationMode.SavedHistory,
        destinationMachineId: "m-a",
      },
    },
  });
  return renderHook(() =>
    useAgentSessionContinuationRecovery({
      organizationId: "o",
      projectId: "p",
      agentSessionId: "s",
      conversationId: "c",
      base: { type: "ready" } as never,
      enabled: true,
    }),
  ).result.current.outcome;
};

describe("continuation outcome", () => {
  beforeEach(() => status.mockReset());

  it("shows the outcome while the session is still bound to the destination", () => {
    expect(readOutcome("m-a")).toEqual({
      mode: AgentSessionContinuationMode.SavedHistory,
      machineName: "Mac A",
    });
  });

  it("drops the outcome once the session has moved to another computer", () => {
    expect(readOutcome("m-b")).toBeNull();
  });
});
