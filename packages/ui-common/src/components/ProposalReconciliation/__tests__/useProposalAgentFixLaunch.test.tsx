import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProposalResponseDto } from "../../../api";
import { proposalsClient } from "../../../clients/serviceClients";
import { useProposalAgentFixLaunch } from "../useProposalAgentFixLaunch";

const { startSession, getAccess, bindMachine } = vi.hoisted(() => ({
  startSession: vi.fn(),
  getAccess: vi.fn(),
  bindMachine: vi.fn(),
}));
vi.mock(
  "../../InteractionComponent/bindGraphConversationAgentSessionMachine",
  () => ({ bindGraphConversationAgentSessionMachine: bindMachine }),
);
vi.mock(
  "../../AgentSession/operations/useAgentSessionInteractionAccess",
  () => ({
    useAgentSessionInteractionAccessResolver: () => ({ getAccess }),
  }),
);
vi.mock("../../../clients/serviceClients", () => ({
  proposalsClient: { createProposalAgentFixRequest: vi.fn() },
}));
vi.mock("../../../data/agentLaunchReconciliation", () => ({
  reconcileAcceptedAgentLaunch: vi.fn(),
}));

const proposal = {
  id: "proposal",
  organizationId: "org",
  projectId: "project",
} as ProposalResponseDto;
const payload = {
  promptType: "proposal_refiner",
  entity: { entityType: "PROPOSAL", entityId: "proposal" },
  payloadVersion: 1,
  userMessage: "Reconcile",
  proposal: {
    id: "proposal",
    action: "UPDATE",
    status: "PENDING",
    targetEntityId: "task",
    targetEntityType: "TASK",
    updates: {},
  },
};
const recorded = {
  proposalId: "proposal",
  organizationId: "org",
  projectId: "project",
  agentSessionId: "session",
  conversationId: "conversation",
  payload,
  createdAt: "2026-10-23T00:00:00.000Z",
};
const selection = {
  machineId: "machine",
  provider: "claude",
  model: "model",
  reasoningEffort: "high",
} as const;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(proposalsClient.createProposalAgentFixRequest).mockResolvedValue({
    data: { data: recorded },
  } as never);
  getAccess.mockReturnValue({
    isDeviceEnabled: true,
    interactions: { startSession },
  });
});

describe("useProposalAgentFixLaunch", () => {
  it("records the request, then starts it on the chosen machine with the recorded input", async () => {
    startSession.mockResolvedValue({ state: "accepted" });
    const { result } = renderHook(() => useProposalAgentFixLaunch());
    let launched: unknown;
    await act(async () => {
      launched = await result.current.launch(proposal, selection);
    });
    expect(launched).toEqual(recorded);
    expect(bindMachine).toHaveBeenCalledWith({
      organizationId: "org",
      projectId: "project",
      agentSessionId: "session",
      machineId: "machine",
    });
    expect(bindMachine.mock.invocationCallOrder[0]).toBeLessThan(
      startSession.mock.invocationCallOrder[0]!,
    );
    expect(getAccess).toHaveBeenCalledWith("machine");
    const start = startSession.mock.calls[0]![0];
    expect(start).toMatchObject({
      agentSessionId: "session",
      conversationId: "conversation",
      intent: {
        handlerPromptType: "proposal_refiner",
        payload,
        provider: "claude",
        model: "model",
        reasoningEffort: "high",
      },
    });
    expect(start.intent).not.toHaveProperty("serviceIds");
    expect(result.current.error).toBeNull();
  });

  it("shows a rejected launch and retries against the same record with the same operation", async () => {
    startSession
      .mockResolvedValueOnce({
        state: "rejected",
        message: "No CLI picked it up",
      })
      .mockResolvedValueOnce({ state: "accepted" });
    const { result } = renderHook(() => useProposalAgentFixLaunch());
    await act(async () => {
      expect(await result.current.launch(proposal, selection)).toBeNull();
    });
    expect(result.current.error).toBe("No CLI picked it up");
    await act(async () => {
      expect(await result.current.launch(proposal, selection)).toEqual(
        recorded,
      );
    });
    expect(result.current.error).toBeNull();
    const [first, second] = startSession.mock.calls.map((call) => call[0]);
    expect(second.agentSessionId).toBe(first.agentSessionId);
    expect(second.operationId).toBe(first.operationId);
  });

  it("does not record or start anything when the machine is unavailable", async () => {
    getAccess.mockReturnValue({
      isDeviceEnabled: false,
      unavailable: { message: "This machine is offline." },
    });
    const { result } = renderHook(() => useProposalAgentFixLaunch());
    await act(async () => {
      await result.current.launch(proposal, selection);
    });
    expect(result.current.error).toBe("This machine is offline.");
    expect(
      proposalsClient.createProposalAgentFixRequest,
    ).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
  });
});
