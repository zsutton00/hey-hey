import { beforeEach, describe, expect, it, vi } from "vitest";

const { updateAgentSessionMock } = vi.hoisted(() => ({
  updateAgentSessionMock: vi.fn(),
}));

vi.mock("../../../clients", () => ({
  agentSessionsClient: {
    updateAgentSession:
      updateAgentSessionMock,
  },
}));

import { bindGraphConversationAgentSessionMachine } from "../bindGraphConversationAgentSessionMachine";

describe("bindGraphConversationAgentSessionMachine", () => {
  beforeEach(() => {
    updateAgentSessionMock.mockReset();
  });

  it("persists the selected machine as the Agent Session authorization binding", async () => {
    updateAgentSessionMock.mockResolvedValue({
      data: {
        data: {
          id: "session-1",
          machineId: "machine-1",
        },
      },
    });

    await expect(
      bindGraphConversationAgentSessionMachine({
        organizationId: "org-1",
        projectId: "project-1",
        agentSessionId: "session-1",
        machineId: "machine-1",
      })
    ).resolves.toEqual({ id: "session-1", machineId: "machine-1" });

    expect(updateAgentSessionMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      agentSessionId: "session-1",
      updateAgentSessionDto: { machineId: "machine-1" },
    });
  });

  it("fails before authorization when the machine binding response is empty", async () => {
    updateAgentSessionMock.mockResolvedValue({ data: { data: undefined } });

    await expect(
      bindGraphConversationAgentSessionMachine({
        organizationId: "org-1",
        projectId: "project-1",
        agentSessionId: "session-1",
        machineId: "machine-1",
      })
    ).rejects.toThrow(
      "The Agent Session was not returned after binding the selected machine."
    );
  });
});
